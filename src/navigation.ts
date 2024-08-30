import * as vscode from 'vscode';
import { Action, liftEditor, ActionResult, cancellation, success } from "./action";

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

// Extracts the surrounding line ranges based on the target range and number of lines
export const getSurroundingLineRanges = (target: Action<vscode.Range>, n: number): Action<[vscode.Range, vscode.Range]> =>
  target.bind(r => liftEditor(async (editor) => {
    const startLine = Math.max(0, r.start.line - n);
    const endLine = Math.min(editor.document.lineCount - 1, r.start.line + n);

    const from = new vscode.Position(startLine, 0);
    const to = new vscode.Position(endLine, editor.document.lineAt(endLine).text.length);

    const clampedFrom = clampPosition(from, editor.document);
    const clampedTo = clampPosition(to, editor.document);

    return [
      new vscode.Range(clampedFrom, r.start),
      new vscode.Range(r.end, clampedTo)
    ];
  }));

// Resolves the ranges to text content
export const resolveSurroundingLines = (ranges: Action<[vscode.Range, vscode.Range]>): Action<[string, string]> =>
  ranges.bind(([beforeRange, afterRange]) =>
    liftEditor(async (editor) => [
      editor.document.getText(beforeRange),
      editor.document.getText(afterRange)
    ])
  );

// Combines the two functions to get surrounding lines
export const getSurroundingLines = (target: Action<vscode.Range>, n: number): Action<[string, string]> =>
  resolveSurroundingLines(getSurroundingLineRanges(target, n));


// Updated getAllLines function to adhere to [before, after] cursor semantics
export const getAllLines = (target: Action<vscode.Range>): Action<[string, string]> =>
  target.bind(
    r =>
      liftEditor(async (editor) => {
        const firstLine = 0;
        const lastLine = editor.document.lineCount - 1;

        const startPos = new vscode.Position(firstLine, 0);
        const endPos = new vscode.Position(lastLine, editor.document.lineAt(lastLine).text.length);

        return [
          editor.document.getText(new vscode.Range(startPos, r.start)),
          editor.document.getText(new vscode.Range(r.end, endPos)),
        ];
      })
  );

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

