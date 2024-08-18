import * as vscode from 'vscode';
import { Action, pure, liftEditor, cancel, sequence, success, fail } from './action';
import { CompletionType, createPrompt } from './prompt';
import { streamText, TextStream } from './anthropic';


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


const promptUser = (opts: vscode.InputBoxOptions) =>
	liftEditor(
		async (editor) => vscode.window.showInputBox(opts)
	).bind(x => x === undefined ? cancel<string>() : pure(x));

const dispatchPrompt = (ctx: string, code: string, ty: CompletionType, instruction?: string) =>
	pure(streamText(createPrompt(ctx, code, ty, instruction)));

const getStaticLinesAndCompletionContext = (contextLines: number | null, ty: CompletionType, instruction?: string) =>
	sequence(getLines(contextLines), completionContext)
		.bind(([ctx, code]) => dispatchPrompt(ctx, code, ty, instruction));

const getDynamicLinesAndCompletionContext = (ty: CompletionType, instruction?: string) =>
	sequence(
		promptUser({
			prompt: 'Enter the number of preceding lines for context',
			placeHolder: 'e.g., 10',
			value: '10',
		}),
		completionContext,
	)
		.bind(([lineCount, code]) => {
			const contextLines = parseInt(lineCount, 10);
			if (isNaN(contextLines) || contextLines < 0) {
				throw new Error(`invalid lines: ${contextLines}`); // Cancel if invalid input
			}
			return getLines(contextLines).bind(ctx => dispatchPrompt(ctx, code, 'cursor'));
		});

const instructionPrompt = promptUser({
	prompt: 'Enter refactoring instructions',
	placeHolder: 'e.g., Optimize this code for performance',
});

const streamAppend = (stream: TextStream) => liftEditor(
	async editor => {
		for await (const chk of stream) {
			await editor.edit(editBuilder => {
				const pos = editor.selection.active;
				editBuilder.insert(pos, chk);
			});
		}
	}
);

const streamReplace = (stream: TextStream) => liftEditor(
	async editor => {
		let replacementText = '';
		for await (const chk of stream) {
			replacementText += chk;
			await editor.edit(editBuilder => {
				editBuilder.replace(editor.selection, replacementText);
			});
		}
	}
);

// ------------- Exposed functions -------------

const completeAtCursorDefinedContext = (contextLines: number | null) =>
	getStaticLinesAndCompletionContext(contextLines, 'cursor')
		.bind(streamAppend);

// completeAtCursorDynamicContext prompts the user for the number of preceding lines
// to inject in the context. It should look very similar to `completeAtCursorDefinedContext`,
// but instead of using a fixed number of preceding context lines, it prompts the user for that value.
const completeAtCursorDynamicContext =
	getDynamicLinesAndCompletionContext('cursor')
		.bind(streamAppend);


const replaceSelectionDefinedContext = (contextLines: number | null) =>
	instructionPrompt
		.bind(instruction => getStaticLinesAndCompletionContext(contextLines, 'selection', instruction))
		.bind(streamReplace);

const replaceSelectionDynamicContext = instructionPrompt
	.bind(instruction => getDynamicLinesAndCompletionContext('selection', instruction))
	.bind(streamReplace);


export function activate(context: vscode.ExtensionContext) {
	// Register commands
	const commands = [
		{ name: 'claudette.complete', action: completeAtCursorDefinedContext(10) },
		{ name: 'claudette.completeFullContext', action: completeAtCursorDefinedContext(null) },
		{ name: 'claudette.completeDynamicContext', action: completeAtCursorDynamicContext },

		{ name: 'claudette.replace', action: replaceSelectionDefinedContext(20) },
		{ name: 'claudette.replaceFullContext', action: replaceSelectionDefinedContext(null) },
		{ name: 'claudette.replaceDynamicContext', action: replaceSelectionDynamicContext },
	];

	commands.forEach(cmd => {
		context.subscriptions.push(
			vscode.commands.registerCommand(cmd.name, async () => {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const result = await cmd.action.execute(editor);
					const message = result.type === 'cancelled' ? 'Operation was cancelled' : 'Code completion finished';
					vscode.window.showInformationMessage(message);
				}
			})
		);
	});
}
