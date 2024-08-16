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
const getLines = (contextLines: number | null) =>
	contextLines === null ? getAllLines : getRecentLines(contextLines);

// completionLines (used for completing the current target) is always passed the recent 5 lines
const completionContext = getRecentLines(5);


const promptUser = (prompt: string, placeHolder?: string) =>
	liftEditor(
		async (editor) => vscode.window.showInputBox({
			prompt,
			placeHolder,
		})
	).bind(x => x === undefined ? cancel<string>() : pure(x));

const dispatchPrompt = (ctx: string, code: string, ty: CompletionType, instruction?: string) =>
	pure(streamText(createPrompt(ctx, code, ty, instruction)));

const completeAtCursorDefinedContext = (contextLines: number | null) => {
	return sequence([getLines(contextLines), completionContext])
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

const replaceSelectionDefinedContext = (contextLines: number | null) => {
	return sequence([
		getLines(contextLines),
		completionContext,
		promptUser('Enter refactoring instructions', 'e.g., Optimize this code for performance'),
	])
		.bind(([ctx, code, instruction]) => dispatchPrompt(ctx, code, 'cursor', instruction))
		.bind((stream) => liftEditor(
			async editor => {
				let replacementText = '';
				for await (const chk of stream) {
					replacementText += chk;
					await editor.edit(editBuilder => {
						editBuilder.replace(editor.selection, replacementText);
					});
				}
			}
		));
}

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

	context.subscriptions.push(
		vscode.commands.registerCommand('claudette.refactorSelection', async () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const result = await replaceSelectionDefinedContext(20).execute(editor);
				if (result.type === 'cancelled') {
					vscode.window.showInformationMessage('Operation was cancelled');
				} else {
					vscode.window.showInformationMessage('Code completion finished');
				}
			}
		})
	);
}