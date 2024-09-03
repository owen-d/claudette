import * as vscode from 'vscode';
import { Action, liftEditor, ActionResult, cancellation, success, traverse, lift, sequence, pure } from "./action";

// Navigation utilities for moving around vscode

export const getCursor: Action<vscode.Position> =
  liftEditor((editor) => editor.selection.active);

export const getSelection: Action<vscode.Selection> =
  liftEditor((editor) => editor.selection);

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

// Extracts the surrounding line ranges based on the target range and number of lines
export const getSurroundingLineRanges = (doc: Action<vscode.TextDocument>, target: Action<vscode.Range>, n: number): Action<SurroundingRanges> =>
  doc.and(target).map(([doc, r]) => {
    const startLine = Math.max(0, r.start.line - n);
    const endLine = Math.min(doc.lineCount - 1, r.start.line + n);

    const from = new vscode.Position(startLine, 0);
    const to = new vscode.Position(endLine, doc.lineAt(endLine).text.length);

    const clampedFrom = clampPosition(from, doc);
    const clampedTo = clampPosition(to, doc);

    return {
      before: new vscode.Range(clampedFrom, r.start),
      target: r,
      after: new vscode.Range(r.end, clampedTo)
    };
  });

// Resolves the ranges to text content
export const resolveSurroundingLines = (ranges: Action<SurroundingRanges>): Action<SurroundingText> =>
  ranges.bind((ranges) =>
    liftEditor(async (editor) => ({
      before: editor.document.getText(ranges.before),
      target: editor.document.getText(ranges.target),
      after: editor.document.getText(ranges.after)
    }))
  );

// Combines the two functions to get surrounding lines
export const getSurroundingLines = (document: Action<vscode.TextDocument>, target: Action<vscode.Range>, n: number): Action<SurroundingText> =>
  resolveSurroundingLines(getSurroundingLineRanges(document, target, n));

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


// Action to move to the next problem and extract context
export const resolveNextProblem: Action<DiagnosticContext> = new Action(
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
);



// Action to find references
export const getReferences: Action<vscode.Location[]> = liftEditor(async (editor) => {
  const position = editor.selection.active;
  const references = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    editor.document.uri,
    position
  );
  return references;
});

export const getReferenceSnippets = getReferences.bind((locs) =>
  traverse(locs, (loc) =>
    getSurroundingLines(getDoc(loc.uri), pure(loc.range), 10) // 10 lines before/after
      .map(({ before, after, target }) => before + after + target)
  )
    .sideEffect(x => console.log(JSON.stringify(x, null, 2)))
);

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

export const symbolHierarchyAtCursor = sequence(doc, getCursor)
  .bind(([d, c]) => symbolHierarchy(new vscode.Location(d.uri, c)))
  .sideEffect(x => console.log(JSON.stringify(x, null, 2)));


