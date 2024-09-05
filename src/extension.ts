import * as vscode from 'vscode';

import {
	Action,
	cancel,
	fail,
	lift,
	liftEditor,
	pure,
	sequence
} from './action';
import { TextStream, streamText } from './anthropic';
import * as langs from './lang/lib';
import {
	diagnosticContextToPrompt,
	doc,
	getAllLines,
	getCursor,
	getSelection,
	getSurroundingLineRanges,
	getSurroundingLines,
	nextProblemTool,
	showSymbolHierarchiesAtCursor,
	SurroundingText,
	symbolHierarchy,
} from './navigation';
import { CompletionType, PromptInput, createPrompt } from './prompt';
import { Command } from './types';


// Updated utility function to get either all lines or recent lines based on a parameter
const getLines = (ty: CompletionType, contextLines: number | null): Action<SurroundingText> => {
	let base: Action<vscode.Range> = getCursor.map(c => new vscode.Range(c, c));
	if (ty === 'selection') {
		base = getSelection.map(s => new vscode.Range(s.anchor, s.end));
	}

	if (contextLines === null) {
		return getAllLines(doc, base);
	} else {
		return getSurroundingLines(doc, base, contextLines);
	}
};

// Utility function to prompt the user for input
// Returns an Action that resolves to the user's input string or cancels if input is undefined
const promptUser = (opts: vscode.InputBoxOptions) =>
	liftEditor(
		async (editor) => vscode.window.showInputBox(opts)
	).bind(x => x === undefined ? cancel<string>() : pure(x));

// Utility function to prompt the user for refactoring instructions
// Returns an Action that resolves to the user's input or cancels if no input is provided
const instructionPrompt = promptUser({
	prompt: 'Enter refactoring instructions',
	placeHolder: 'e.g., Optimize this code for performance',
});

const dispatchPrompt = (input: PromptInput) => {
	const prompt = createPrompt(input);
	console.log(prompt);
	return pure(streamText(prompt));
};

// Function to append a stream of text at the current cursor position
// Uses liftEditor to perform the insertion operation asynchronously
// Iterates through the stream chunks and inserts each at the active selection
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

// Function to replace selected text with a stream of text, updating the selection as new content is added
// This provides a more dynamic, real-time replacement experience compared to bufferReplace
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
				editor.selection = currentSelection;
			}
		})
	);

// Function to get language-specific directory context
// Returns an Action that resolves to a context string based on the current document's language
const languageDirContext = liftEditor(async editor => editor.document.languageId)
	.bind(lang => {
		const resolver = langs.actions?.[lang].dirCtx;
		if (resolver === undefined) {
			throw new Error(`language ${lang} unsupported for context lookups`);
		}
		return resolver;
	})
	.or(pure(""));

// ------------- Exposed functions -------------

/**
 * Completes text at cursor position with defined context
 * @param {number | null} contextLines - Number of context lines or null
 * @returns {Action<void>} An Action that completes text at the cursor position
 */
const completeAtCursorDefinedContext = (contextLines: number | null) =>
	sequence(
		getLines('cursor', contextLines),
		languageDirContext,
	)
		.bind(
			([{ before, after }, context]) => dispatchPrompt({
				type: 'cursor',
				beforeCursor: before,
				afterCursor: after,
				context,
			}),
		).bind(streamAppend);

/**
 * Creates a comment for the current code context
 * @param {number | null} contextLines Number of context lines or null
 * @returns {Action<void>} An Action that creates and appends a comment
 */
const completeCommentAtCursorDefinedContext = (contextLines: number | null) =>
	sequence(
		getLines('cursor', contextLines),
		languageDirContext,
	)
		.bind(
			([{ before, after }, context]) => dispatchPrompt({
				type: 'comment',
				beforeCursor: before,
				afterCursor: after,
				context,
			}),
		)
		.bind(streamAppend);

/**
 * Replaces selection with defined context
 * @param {number | null} contextLines - Number of context lines or null
 * @returns {Action<void>} An Action that replaces the selected text
 */
const replaceSelectionDefinedContext = (contextLines: number | null) =>
	sequence(
		instructionPrompt,
		getLines('selection', contextLines),
		languageDirContext,
	).bind(
		([instruction, { before, target, after }, context]) => dispatchPrompt({
			type: 'selection',
			beforeSelection: before,
			selection: target,
			afterSelection: after,
			instruction,
			context,
		})
	).bind(stream => streamReplace(getSelection, pure(stream)));

// an action which resolves the next problem then passes the surrounding 50 lines in either direction as a refactor context with additional isntructions derived from the DiagnosticContext.
const fixNextProblem = (contextLines: number) =>
	nextProblemTool.run().bind(
		diagnostic =>
			// take diagnostic and resolve the n lines before and after as a range to be later used in replacement
			getSurroundingLineRanges(doc, pure(new vscode.Range(diagnostic.pos, diagnostic.pos)), contextLines)
				.bind(({ before, after }) => liftEditor(
					async (editor) => {
						const combined = before.union(after);
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



// Class representing the main application
// Implements the Singleton pattern to ensure only one instance exists
class App {
	private static instance: App;
	private commandHistory: Command[] = [];
	private maxHistorySize: number = 10;  // Adjust as needed

	// repeat replays the last action via history
	private repeat: Action<void> = lift(() => {
		const lastCommand = this.commandHistory[0];
		if (lastCommand) {
			return lastCommand.action;
		} else {
			return fail<void>("No previous command to repeat");
		}
	}).bind(a => a);

	private constructor() { }

	// Private constructor to enforce singleton pattern
	// Prevents direct instantiation of the App class
	static getInstance(): App {
		if (!App.instance) {
			App.instance = new App();
		}
		return App.instance;
	}


	// Method to wrap a command action with tracking functionality
	// Adds the command to the history and handles any errors
	trackCommand(command: Command) {
		this.commandHistory.unshift(command);
		if (this.commandHistory.length > this.maxHistorySize) {
			this.commandHistory.pop();
		}
	}

	// Returns a copy of the command history
	// This method ensures that the original array is not modified
	getCommandHistory(): Command[] {
		return [...this.commandHistory];
	}


	// Define the commands available in the application
	// Returns an array of command objects, each containing a name and an associated Action
	commands(): Array<Command> {
		return [
			// completion
			{ name: 'cursor', action: completeAtCursorDefinedContext(50) },

			// comment,
			{ name: 'comment', action: completeCommentAtCursorDefinedContext(50) },

			// refactoring
			{ name: 'refactor', action: replaceSelectionDefinedContext(50) },

			// fix
			{ name: 'fix', action: fixNextProblem(50) },

			// repeat
			{ name: 'repeat', action: this.repeat },

			// development
			{ name: 'wip', action: showSymbolHierarchiesAtCursor },

			...langs.languages.flatMap(l => l.commands),
		];
	}

}

// Export the activate function
// This function is called when the extension is activated
// It registers all commands defined in the App instance with VS Code
export function activate(context: vscode.ExtensionContext) {
	const app = App.getInstance();
	app.commands().forEach(cmd => {
		context.subscriptions.push(
			vscode.commands.registerCommand('claudette.' + cmd.name, async () => {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const result = await cmd.action.execute(editor);
					if (result.type === 'cancelled') {
						vscode.window.showInformationMessage('Operation was cancelled');
					}
					app.trackCommand(cmd);
				}
			})
		);
	});
}