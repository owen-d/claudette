import * as vscode from 'vscode';
import { Action, ActionResult, cancellation, success } from "./action";


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

