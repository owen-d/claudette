import * as vscode from 'vscode';
import { Action, liftEditor, ActionResult, cancellation, success, traverse, lift, sequence, pure } from "./action";
import { Codec, detectSchema, nullSchema, Tool } from './tool';

/*
---------------------- Navigation utilities for moving around vscode ----------------------
*/

/**
 * Retrieves the current cursor position in the active text editor
 * @returns {Action<vscode.Position>} An Action that resolves to the current cursor position
 */
export const getCursor: Action<vscode.Position> =
  liftEditor((editor) => editor.selection.active);

/**
 * Retrieves the current selection in the active text editor
 * @returns {Action<vscode.Selection>} An Action that resolves to the current selection
 */
export const getSelection: Action<vscode.Selection> =
  liftEditor((editor) => editor.selection);

/**
* Clamps a given position within the bounds of a document
* @param {vscode.Position} position - The position to clamp
* @param {vscode.TextDocument} document - The document to clamp within
* @returns {vscode.Position} The clamped position
*/
export function clampPosition(position: vscode.Position, document: vscode.TextDocument): vscode.Position {
  // Clamp line number
  const lineCount = document.lineCount;
  const clampedLine = Math.max(0, Math.min(position.line, lineCount - 1));

  // Clamp character number
  const lineLength = document.lineAt(clampedLine).text.length;
  const clampedCharacter = Math.max(0, Math.min(position.character, lineLength));

  return new vscode.Position(clampedLine, clampedCharacter);
}

// alias to the selected doc
export const doc: Action<vscode.TextDocument> = liftEditor(e => e.document);

// lookup a specific doc
export const getDoc = (uri: vscode.Uri) => lift(async () => vscode.workspace.openTextDocument(uri));

// Define the SurroundingRanges type
export type SurroundingRanges = {
  before: vscode.Range;
  target: vscode.Range;
  after: vscode.Range;
};

// Define the SurroundingText type
export type SurroundingText = {
  before: string;
  target: string;
  after: string;
};

export const getSurroundingLineRanges = (doc: vscode.TextDocument, range: vscode.Range, n: number): Action<SurroundingRanges> =>
  liftEditor(() => {
    const startLine = Math.max(0, range.start.line - n);
    const endLine = Math.min(doc.lineCount - 1, range.start.line + n);

    const from = new vscode.Position(startLine, 0);
    const to = new vscode.Position(endLine, doc.lineAt(endLine).text.length);

    const clampedFrom = clampPosition(from, doc);
    const clampedTo = clampPosition(to, doc);

    return {
      before: new vscode.Range(clampedFrom, range.start),
      target: range,
      after: new vscode.Range(range.end, clampedTo)
    };
  });

// Resolves the ranges to text content
export const resolveSurroundingLines = (ranges: SurroundingRanges): Action<SurroundingText> =>
  liftEditor(editor => ({
    before: editor.document.getText(ranges.before),
    target: editor.document.getText(ranges.target),
    after: editor.document.getText(ranges.after)
  }));

// change signature to (document: vscode.TextDocument, target: vscode.Range, n: number): Action<SurroundingText>
// Combines the two functions to get surrounding lines
export const getSurroundingLines = (document: vscode.TextDocument, target: vscode.Range, n: number): Action<SurroundingText> =>
  getSurroundingLineRanges(document, target, n).bind(resolveSurroundingLines);

// Updated getAllLines function to adhere to {before, target, after} semantics
export const getAllLines = (document: Action<vscode.TextDocument>, target: Action<vscode.Range>): Action<SurroundingText> =>
  document.and(target).map(([doc, r]) => {
    const firstLine = 0;
    const lastLine = doc.lineCount - 1;

    const startPos = new vscode.Position(firstLine, 0);
    const endPos = new vscode.Position(lastLine, doc.lineAt(lastLine).text.length);

    return {
      before: doc.getText(new vscode.Range(startPos, r.start)),
      target: doc.getText(r),
      after: doc.getText(new vscode.Range(r.end, endPos)),
    };
  });

// Define a type for the diagnostic context
export type DiagnosticContext = {
  pos: vscode.Position
  message: string;
  severity: vscode.DiagnosticSeverity;
  code?: string | number;
  source?: string;
  relatedInformation?: vscode.DiagnosticRelatedInformation[];
};

// Function to convert a diagnostic context to a prompt string.
export function diagnosticContextToPrompt(context: DiagnosticContext): string {
  let prompt = `Resolve the following issue:\n`;
  prompt += `Message: ${context.message}\n`;
  prompt += `Severity: ${vscode.DiagnosticSeverity[context.severity]}\n`;

  if (context.code) {
    prompt += `Code: ${context.code}\n`;
  }

  if (context.relatedInformation && context.relatedInformation.length > 0) {
    prompt += `Related Information:\n`;
    context.relatedInformation.forEach(info => {
      prompt += `- ${info.message}\n`;
    });
  }

  return prompt;
}

export const fileSymbols = (uri: vscode.Uri): Action<vscode.SymbolInformation[]> =>
  lift(
    async () => {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeDocumentSymbolProvider',
        uri,
      );
      return symbols;
    },
  );

// symbolHierarchy retrieves all the symbols overlapping the current location (generally the cursor)
// and returns an array of symbols in that file which overlap it, sorted (ascending) by the starting offset.
// In practice this returns a hierarchy of parent symbols encapsulating a target one.
export const symbolHierarchy = (loc: vscode.Location) => fileSymbols(loc.uri)
  .map(
    (symbols) => symbols
      .filter(s => s.location.range.contains(loc.range))
      .sort((a, b) => a.location.range.start.compareTo(b.location.range.start)),
  );

/**
 * Location class represents a position in a file
 * @property {string} uri - The file path
 * @property {Object} range - The range in the file
 * @property {Object} range.start - Start position
 * @property {number} range.start.line - Start line number
 * @property {number} range.start.character - Start character number
 * @property {Object} range.end - End position
 * @property {number} range.end.line - End line number
 * @property {number} range.end.character - End character number
 */
class Location {
  constructor(public uri: string, public range: { start: { line: number, character: number }, end: { line: number, character: number } }) { }

  /**
 * Provides a codec for bidirectional conversion between vscode.Location and Location
 * @returns {Codec<vscode.Location, Location>} A codec object with encode and decode methods
 */
  static codec(): Codec<vscode.Location, Location> {
    return Codec.from(
      (vscodeLocation: vscode.Location) => Location.fromVSCodeLocation(vscodeLocation),
      (location: Location) => location.toVSCodeLocation()
    );
  }

  static fromVSCodeLocation(location: vscode.Location): Location {
    return new Location(
      location.uri.fsPath,
      {
        start: { line: location.range.start.line, character: location.range.start.character },
        end: { line: location.range.end.line, character: location.range.end.character }
      }
    );
  }

  toVSCodeLocation(): vscode.Location {
    return new vscode.Location(
      vscode.Uri.file(this.uri),
      new vscode.Range(
        new vscode.Position(this.range.start.line, this.range.start.character),
        new vscode.Position(this.range.end.line, this.range.end.character)
      )
    );
  }
}

/**
 * SymbolInformation class represents a symbol in the code
 * @property {string} name - The name of the symbol
 * @property {vscode.SymbolKind} kind - The kind of symbol (e.g., function, variable)
 * @property {Location} location - The location of the symbol in the file
 */
class SymbolInformation {
  constructor(public name: string, public kind: vscode.SymbolKind, public location: Location) { }

  static codec(): Codec<vscode.SymbolInformation, SymbolInformation> {
    return Codec.from(
      (vscodeSymbol: vscode.SymbolInformation) => SymbolInformation.fromVSCodeSymbolInformation(vscodeSymbol),
      (symbol: SymbolInformation) => symbol.toVSCodeSymbolInformation()
    );
  };

  static fromVSCodeSymbolInformation(symbol: vscode.SymbolInformation): SymbolInformation {
    return new SymbolInformation(
      symbol.name,
      symbol.kind,
      Location.fromVSCodeLocation(symbol.location)
    );
  }

  toVSCodeSymbolInformation(): vscode.SymbolInformation {
    return new vscode.SymbolInformation(
      this.name,
      this.kind,
      "",
      this.location.toVSCodeLocation(),
    );
  }
}

// Update symbolHierarchyTool to use wrapped types
export const symbolHierarchyTool = Tool.create<Location[], SymbolInformation[][]>(
  "Symbol Hierarchy",
  "Finds the symbol hierarchy for one or more locations in the code",
  detectSchema(Location.fromVSCodeLocation(new vscode.Location(vscode.Uri.parse('file:///usr/home'), new vscode.Position(0, 0)))),
  (locations) => traverse(locations, (loc) => symbolHierarchy(loc.toVSCodeLocation()).map(symbols => symbols.map(SymbolInformation.fromVSCodeSymbolInformation)))
);

export const showSymbolHierarchiesAtCursor: Action<void> = sequence(doc, getCursor)
  .bind(([d, c]) => symbolHierarchyTool.action(
    [Location.fromVSCodeLocation(new vscode.Location(d.uri, c))]
  ))
  .map(hierarchies => {
    // Display the hierarchies in a new editor
    const content = JSON.stringify(hierarchies, null, 2);
    vscode.workspace.openTextDocument({ content, language: 'plaintext' })
      .then(doc => vscode.window.showTextDocument(doc, { preview: false }));
  });


export const referencesTool: Tool<vscode.Location, vscode.Location[]> =
  Tool.wrap(
    Tool.create<Location, Location[]>(
      "References",
      "Finds all references to a symbol at a given location",
      detectSchema(Location.fromVSCodeLocation(new vscode.Location(vscode.Uri.parse('file:///usr/home'), new vscode.Position(0, 0)))),
      (location) => liftEditor(async (editor) => {
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          location.toVSCodeLocation().uri,
          location.toVSCodeLocation().range.start
        );
        return references?.map(Location.fromVSCodeLocation) || [];
      })
    ),
    Location.codec(),
    Codec.array(Location.codec().flip()),
  );

export const nextProblemTool = Tool.create<void, DiagnosticContext>(
  "Next Problem",
  "Moves to the next problem in the editor and extracts its context",
  nullSchema,
  () => new Action(
    async (editor: vscode.TextEditor): Promise<ActionResult<DiagnosticContext>> => {
      // Move to next problem
      await vscode.commands.executeCommand('editor.action.marker.next');

      const pos = editor.selection.active;
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      const currentDiagnostic = diagnostics.find(d => d.range.contains(pos));

      if (currentDiagnostic) {
        const context: DiagnosticContext = {
          pos,
          message: currentDiagnostic.message,
          severity: currentDiagnostic.severity,
          code: currentDiagnostic.code instanceof Object ? currentDiagnostic.code.value : currentDiagnostic.code,
          source: currentDiagnostic.source,
          relatedInformation: currentDiagnostic.relatedInformation,
        };
        return success(context);
      }

      return cancellation();
    }
  )
);

export type SurroundingContextInput = {
  surroundingLines: number,
  location: Location,
};

// Tool to resolve the surrounding `n` lines from a location.
export const surroundingContextTool = Tool.create<SurroundingContextInput, SurroundingText>(
  "Surrounding Context",
  "Extracts the surrounding context of a given location",
  detectSchema({
    surroundingLines: 10,
    location: Location.fromVSCodeLocation(new vscode.Location(vscode.Uri.parse('file:///usr/home'), new vscode.Position(10, 50))),
  }),
  ({ surroundingLines, location }) => {
    const loc = location.toVSCodeLocation();
    return getDoc(loc.uri).bind(d => getSurroundingLines(d, loc.range, surroundingLines));
  }
);