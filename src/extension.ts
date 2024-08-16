import * as vscode from 'vscode';
import { Action, pure, liftEditor, cancel, sequence, success } from './action';
import { CompletionType, createPrompt } from './prompt';
import { streamText } from './anthropic';


const getSelectedCode: Action<string> =
	liftEditor(async (editor) => editor.document.getText(editor.selection));

const getCursor: Action<vscode.Position> =
	liftEditor(async (editor) => editor.selection.active);

const getAllLines = liftEditor(async (editor) => editor.document.getText());
const getRecentLines = (n: number): Action<string> =>
	getCursor.bind(pos => {
		const lineDelta = Math.min(n, pos.line);
		const from = pos.translate(-lineDelta, undefined).with(undefined, 0);
		return liftEditor(async (editor) => editor.document.getText(new vscode.Range(from, pos)));
	});

// completionLines (used for completing the current target) is always passed the recent 5 lines
const completionContext = getRecentLines(5);


const promptUser = (prompt: string, placeHolder?: string) =>
	liftEditor(
		async (editor) => vscode.window.showInputBox({
			prompt,
			placeHolder,
		})
	).bind(x => x === undefined ? cancel() : pure(x));

const dispatchPrompt = (ctx: string, code: string, ty: CompletionType) =>
	pure(streamText(createPrompt(ctx, code, ty)));

const completeAtCursorDefinedContext = (contextLines: number | null) => {
	let ctx = contextLines === null ? getAllLines : getRecentLines(contextLines);
	return sequence([ctx, completionContext])
		.bind(([ctx, code]) => dispatchPrompt(ctx, code, 'cursor'))
		.bind((stream) => liftEditor(
			async editor => {
				for await (const chk of stream) {
					await editor.edit(editBuilder => {
						const pos = editor.selection.active;
						editBuilder.insert(pos, chk);
					});
				}
				vscode.window.showInformationMessage('Text generation completed');
			}
		));
};

// activations
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('claudette.completeAtCursor', async () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const result = await completeAtCursorDefinedContext(20).execute(editor);
				if (result.type === 'cancelled') {
					vscode.window.showInformationMessage('Operation was cancelled');
				} else {
					vscode.window.showInformationMessage('Code completion finished');
				}
			}
		})
	);
}