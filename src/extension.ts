import * as vscode from 'vscode';
import { Action, pure, liftEditor, cancel, sequence, success, fail } from './action';
import { CompletionType, createPrompt, PromptInput } from './prompt';
import { streamText, TextStream } from './anthropic';
import * as langs from './lang/lib';

// default surrounding lines in each direction
const DEFAULT_SURROUNDING_LINES = 25;

const getCursor: Action<vscode.Position> =
	liftEditor(async (editor) => editor.selection.active);

const getSelection: Action<vscode.Selection> =
	liftEditor(async (editor) => editor.selection);

function clampPosition(position: vscode.Position, document: vscode.TextDocument): vscode.Position {
	// Clamp line number
	const lineCount = document.lineCount;
	const clampedLine = Math.max(0, Math.min(position.line, lineCount - 1));

	// Clamp character number
	const lineLength = document.lineAt(clampedLine).text.length;
	const clampedCharacter = Math.max(0, Math.min(position.character, lineLength));

	return new vscode.Position(clampedLine, clampedCharacter);
}

const getSurroundingLines = (target: Action<vscode.Range>, n: number): Action<[string, string]> =>
	target.bind(
		r =>
			liftEditor(async (editor) => {
				const startLine = Math.max(0, r.start.line - n);
				const endLine = Math.min(editor.document.lineCount - 1, r.start.line + n);

				const from = new vscode.Position(startLine, 0);
				const to = new vscode.Position(endLine, editor.document.lineAt(endLine).text.length);

				const clampedFrom = clampPosition(from, editor.document);
				const clampedTo = clampPosition(to, editor.document);

				return [
					editor.document.getText(new vscode.Range(clampedFrom, r.start)),
					editor.document.getText(new vscode.Range(r.end, clampedTo)),
				];
			})
	);


// Updated getAllLines function to adhere to [before, after] cursor semantics
const getAllLines = (target: Action<vscode.Range>): Action<[string, string]> =>
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

// Updated utility function to get either all lines or recent lines based on a parameter
const getLines = (ty: CompletionType, contextLines: number | null): Action<[string, string]> => {
	let base: Action<vscode.Range> = getCursor.map(c => new vscode.Range(c, c));
	if (ty === 'selection') {
		base = getSelection.map(s => new vscode.Range(s.anchor, s.end));
	}

	if (contextLines === null) {
		return getAllLines(base);
	} else {
		return getSurroundingLines(base, contextLines);
	}
};

const promptUser = (opts: vscode.InputBoxOptions) =>
	liftEditor(
		async (editor) => vscode.window.showInputBox(opts)
	).bind(x => x === undefined ? cancel<string>() : pure(x));


const instructionPrompt = promptUser({
	prompt: 'Enter refactoring instructions',
	placeHolder: 'e.g., Optimize this code for performance',
});

const dispatchPrompt = (input: PromptInput) => {
	const prompt = createPrompt(input);
	console.log(prompt);
	return pure(streamText(prompt));
};

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

const languageDirContext = liftEditor(async editor => editor.document.languageId)
	.bind(lang => {
		const resolver = langs.actions?.[lang].dirCtx;
		if (resolver === undefined) {
			throw new Error(`language ${lang} unsupported for context lookups`);
		}
		return resolver;
	});

// ------------- Exposed functions -------------

const completeAtCursorDefinedContext = (contextLines: number | null) =>
	sequence(
		getLines('cursor', contextLines),
		languageDirContext,
	)
		.bind(
			([[before, after], context]) => dispatchPrompt({
				type: 'cursor',
				beforeCursor: before,
				afterCursor: after,
				context,
			}),
		).bind(streamAppend);

const replaceSelectionDefinedContext = (contextLines: number | null) =>
	sequence(
		instructionPrompt,
		getLines('selection', contextLines),
		liftEditor(async (editor) => (s: vscode.Selection) => editor.document.getText(s)).apply(getSelection),
		languageDirContext,
	).bind(
		([instruction, [before, after], selection, context]) => dispatchPrompt({
			type: 'selection',
			beforeSelection: before,
			selection: selection,
			afterSelection: after,
			instruction,
			context,
		})
	).bind(streamReplace);

export function activate(context: vscode.ExtensionContext) {
	// Register commands
	const commands = [
		// completion
		{ name: 'complete', action: completeAtCursorDefinedContext(10) },
		{ name: 'completeFullContext', action: completeAtCursorDefinedContext(null) },

		// refactoring
		{ name: 'replace', action: replaceSelectionDefinedContext(20) },
		{ name: 'replaceFullContext', action: replaceSelectionDefinedContext(null) },

		...langs.languages.flatMap(l => l.commands),
	];

	commands.forEach(cmd => {
		context.subscriptions.push(
			vscode.commands.registerCommand('claudette.' + cmd.name, async () => {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const result = await cmd.action.execute(editor);
					if (result.type === 'cancelled') {
						vscode.window.showInformationMessage('Operation was cancelled');
					}
				}
			})
		);
	});
}

