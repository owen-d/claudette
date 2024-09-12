import * as vscode from 'vscode';
import { Action, liftEditor, ActionResult, cancellation, success, traverse, lift, sequence, pure } from "./action";
import { Codec, createNumberSchema, createObjectSchema, detectSchema, detectSchemaTyped, nullSchema, Tool } from './tool';
import * as langs from './lang/lib';

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
export const currentDoc: Action<vscode.TextDocument> = liftEditor(e => e.document);

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

/**
 * Location class represents a position in a file
 * We enforce static methods because Location is used in tool I/O
 * and tools just send data, not class instantiations. While we could
 * handle this, I'm preferring to treat classes like
 * these as coupled data-type + associated functions.
 */
class Location {
  constructor(public uri: string, public range: { start: { line: number, character: number }, end: { line: number, character: number } }) { }

  static fromVSCodeLocation(location: vscode.Location): Location {
    return new Location(
      location.uri.fsPath,
      {
        start: { line: location.range.start.line, character: location.range.start.character },
        end: { line: location.range.end.line, character: location.range.end.character }
      }
    );
  }

  static toVSCodeLocation(location: Location): vscode.Location {
    return new vscode.Location(
      vscode.Uri.file(location.uri),
      new vscode.Range(
        new vscode.Position(location.range.start.line, location.range.start.character),
        new vscode.Position(location.range.end.line, location.range.end.character)
      )
    );
  }
}

/**
 * SymbolInformation class represents a symbol in the code
 */
class SymbolInformation {
  constructor(public name: string, public kind: vscode.SymbolKind, public location: Location) { }

  static fromVSCodeSymbolInformation(symbol: vscode.SymbolInformation): SymbolInformation {
    return new SymbolInformation(
      symbol.name,
      symbol.kind,
      Location.fromVSCodeLocation(symbol.location)
    );
  }

  static toVSCodeSymbolInformation(s: SymbolInformation): vscode.SymbolInformation {
    return new vscode.SymbolInformation(
      s.name,
      s.kind,
      "",
      Location.toVSCodeLocation(s.location),
    );
  }
}

export type SymbolHierarchyInput = {
  uris: string[],
};

// Update symbolHierarchyTool to use wrapped types
export const symbolsInFile = Tool.create<SymbolHierarchyInput, SymbolInformation[][]>(
  "symbols_list",
  "For each location, find and return the symbols in said location's file. This tool helps to understand the structure and organization of symbols (such as functions, classes, and variables) in the codebase, providing valuable context for code analysis and navigation. Locations must be known to use this tool.",
  detectSchemaTyped<SymbolHierarchyInput>({
    uris: ['file:///usr/home'],
  }),
  ({ uris, }) =>
    traverse(uris, uri =>
      fileSymbols(vscode.Uri.file(uri))
        .map(symbols =>
          symbols.map(SymbolInformation.fromVSCodeSymbolInformation)
        )
    )
);

//  Locations must be known to use this tool.
export const referencesTool: Tool<Location, Location[]> =
  Tool.create<Location, Location[]>(
    "references",
    "Finds and returns all references to a symbol at a given location in the codebase. This tool is useful for understanding how a particular symbol (such as a function, variable, or class) is used throughout the project, aiding in code analysis, refactoring, and dependency tracking. The location must be known to use this tool.",
    detectSchema(Location.fromVSCodeLocation(new vscode.Location(vscode.Uri.parse('file:///usr/home'), new vscode.Position(0, 0)))),
    (location) => liftEditor(async (editor) => {

      const loc = Location.toVSCodeLocation(location);
      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        loc.uri,
        loc.range.start
      );
      return references?.map(Location.fromVSCodeLocation) || [];
    })
  );


export const nextProblemTool = Tool.create<void, DiagnosticContext>(
  "next_problem",
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
  "surrounding_ctx",
  "Extracts the surrounding context of a given location",
  detectSchema({
    surroundingLines: 10,
    location: Location.fromVSCodeLocation(new vscode.Location(vscode.Uri.parse('file:///usr/home'), new vscode.Position(10, 50))),
  }),
  ({ surroundingLines, location }) => {
    const loc = Location.toVSCodeLocation(location);
    return getDoc(loc.uri).bind(d => getSurroundingLines(d, loc.range, surroundingLines));
  }
);

// Function to get language-specific directory context
// Returns an Action that resolves to a context string based on the current document's language
export const languageDirContext = liftEditor(async editor => editor.document.languageId)
  .bind(lang => {
    const resolver = langs.actions?.[lang].dirCtx;
    if (resolver === undefined) {
      throw new Error(`language ${lang} unsupported for context lookups`);
    }
    return resolver;
  })
  .or(pure(""));

// tool to show types & signatures in cwd
export const dirCtxTool = Tool.create<void, string>(
  "directory_ctx",
  "Provides language-specific directory context for the current workspace. This includes information about available types, function signatures, and other relevant language elements in the current working directory.",
  nullSchema,
  () => languageDirContext
);

export const cursorLocationTool = Tool.create<void, Location>(
  "cursor_location",
  "Retrieves the current cursor position within the active text editor. This tool returns a Location object containing the file URI and the precise cursor position (line and character).",
  nullSchema,
  () => sequence(getCursor, currentDoc).map(
    ([cursor, doc]) => Location.fromVSCodeLocation(
      new vscode.Location(doc.uri, cursor),
    ),
  )
);

// For both line and character, TranslateCursorInput accepts
// an optional (none = no translation) `delta` (move by delta) or `value` (set to value)
export type TranslateCursorInput = {
  lineDelta?: number,
  characterDelta?: number,
  lineValue?: number,
  characterValue?: number,
};

// translateCursorTool uses vscode's Position.translate to move the cursor
// by providing line & character deltas
export const translateCursorTool = Tool.create<TranslateCursorInput, Location>(
  "translate_cursor",
  "Moves the cursor position based on provided deltas or absolute values for line and character.",
  createObjectSchema()
    .property("lineDelta", createNumberSchema().build())
    .property("characterDelta", createNumberSchema().build())
    .property("lineValue", createNumberSchema().build())
    .property("characterValue", createNumberSchema().build())
    .build(),
  ({ lineDelta, characterDelta, lineValue, characterValue }) =>
    sequence(getCursor, currentDoc).map(([cursor, doc]) => {
      let newPosition = cursor;
      if (lineDelta !== undefined || characterDelta !== undefined) {
        newPosition = newPosition.translate(lineDelta || 0, characterDelta || 0);
      }
      if (lineValue !== undefined) {
        newPosition = new vscode.Position(lineValue, newPosition.character);
      }
      if (characterValue !== undefined) {
        newPosition = new vscode.Position(newPosition.line, characterValue);
      }
      return Location.fromVSCodeLocation(new vscode.Location(doc.uri, newPosition));
    })
);