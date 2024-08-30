import * as vscode from 'vscode';

import {
	Action,
	cancel,
	liftEditor,
	pure,
	sequence
} from './action';
import { TextStream, streamText } from './anthropic';
import * as langs from './lang/lib';
import {
	diagnosticContextToPrompt,
	getAllLines,
	getCursor,
	getSelection,
	getSurroundingLineRanges,
	getSurroundingLines,
	resolveNextProblem
} from './navigation';
import { CompletionType, PromptInput, createPrompt } from './prompt';


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

// Replaces the selected text with a stream of text
const bufferReplace = (actionSelection: Action<vscode.Selection>, actionStream: Action<TextStream>) =>
	sequence(
		actionSelection,
		actionStream
	).bind(([selection, data]) =>
		liftEditor(async editor => {
			let replacementText = '';
			for await (const chk of data) {
				replacementText += chk;
			}
			await editor.edit(editBuilder => {
				editBuilder.replace(selection, replacementText);
			});
		})
	);

const streamReplace = (actionSelection: Action<vscode.Selection>, actionStream: Action<TextStream>): Action<void> =>
	sequence(actionSelection, actionStream).bind(([initialSelection, stream]) =>
		liftEditor(async editor => {
			let currentSelection = initialSelection;
			let replacementText = '';

			for await (const chunk of stream) {
				replacementText += chunk;

				await editor.edit(
					editBuilder => {
						editBuilder.replace(currentSelection, replacementText);
					}
				);

				// Calculate the new end position
				const newEnd = editor.document.positionAt(
					editor.document.offsetAt(initialSelection.start) + replacementText.length
				);

				// Update the current selection
				currentSelection = new vscode.Selection(initialSelection.start, newEnd);
			}
		})
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

/**
 * Completes text at cursor position with defined context
 * @param contextLines Number of context lines or null
 */
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

/**
 * Replaces selection with defined context
 * @param contextLines Number of context lines or null
 */
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
	).bind(stream => streamReplace(getSelection, pure(stream)));

// an action which resolves the next problem then passes the surrounding 50 lines in either direction as a refactor context with additional isntructions derived from the DiagnosticContext.
const fixNextProblem = (contextLines: number) =>
	resolveNextProblem.bind(
		diagnostic =>
			// take diagnostic and resolve the n lines before and after as a range to be later used in replacement
			getSurroundingLineRanges(pure(new vscode.Range(diagnostic.pos, diagnostic.pos)), contextLines)
				.bind(([a, b]) => liftEditor(
					async (editor) => {
						const combined = a.union(b);
						const sel = new vscode.Selection(combined.start, combined.end);
						const text = editor.document.getText(combined);
						return { diagnostic, text, sel };
					},
				))
	).bind(
		({ diagnostic, text, sel }) => {
			const stream = dispatchPrompt({
				type: 'selection',
				beforeSelection: '',
				afterSelection: '',
				selection: text,
				instruction: diagnosticContextToPrompt(diagnostic),
			});
			return bufferReplace(pure(sel), stream);
		}
	);


export function activate(context: vscode.ExtensionContext) {
	// Register commands
	const commands = [
		// completion
		{ name: 'cursor', action: completeAtCursorDefinedContext(50) },

		// refactoring
		{ name: 'refactor', action: replaceSelectionDefinedContext(50) },

		// fix
		{ name: 'fix', action: fixNextProblem(50) },

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

