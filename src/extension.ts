import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { TextBlock } from '@anthropic-ai/sdk/resources/messages.mjs';

// Claude API configuration
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
const SYSTEM_PROMPT = `You are an AI coding assistant integrated into a VS Code extension named Claudette. Your role is to help developers by generating code completions and suggestions. Follow these guidelines:

1. Analyze the provided code context carefully.
2. Generate code that seamlessly continues from the given context.
3. Match the coding style, indentation, and conventions visible in the existing code.
4. Provide concise, efficient, and idiomatic code solutions.
5. If the context is unclear, generate a sensible continuation that a developer might expect.
6. You may include code comments, but they should be relevant, add value, and use correct code-commented syntax.
7. Focus solely on code generation; do not engage in conversation or provide spurious explanations or examples.`;

// Initialize the Anthropic client
const anthropic = new Anthropic({
	apiKey: ANTHROPIC_API_KEY,
});

type LineDelta = number | 'all';
type ActionType = 'selection' | 'cursor';

// context may or may not include 
function getContext(editor: vscode.TextEditor, lines: LineDelta): string {
	const document = editor.document;
	const pos = editor.selection.active;
	if (lines === 'all') {
		return document.getText();
	}
	const lineDelta = Math.min(lines, pos.line);
	const from = pos.translate(-lineDelta, undefined).with(undefined, 0);
	return document.getText(new vscode.Range(from, pos));
}

function getCodeToModify(editor: vscode.TextEditor, variant: ActionType): string {
	const document = editor.document;
	if (variant === 'selection') {
		return document.getText(editor.selection);
	}

	// otherwise, default to recent 5 lines
	return getContext(editor, 5);
}

// // Function to create a prompt based on context and code
// function createPrompt(context: string, code: string, variant: ActionType): string {
// 	return `Given the following blocks, complete or refactor the <code/> block. You may use elements from the original code if appropriate.
// 	If variant is 'selection', refactor the selection. If variant is 'cursor', continue the code but DO NOT repeat it's contents.

// <context>${context}</context>
// <variant>${variant}</variant>
// <code>${code}</code>
// Generate code based on the above context, but remember to ONLY output code & code comments:`;
// }

// Function to create a prompt based on context and code
function createPrompt(context: string, code: string, actiontype: ActionType): string {
	if (actiontype === "selection") {
		return `Given the following blocks, refactor the selected code. You may use elements from the original code if appropriate.
<context>${context}</context>
<code>${code}</code>
Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Generate code based on the above context, but remember to ONLY output code & relevant comments:`;
	} else if (actiontype === "cursor") {
		return `Given the following blocks, continue the code but DO NOT repeat its contents.
<context>${context}</context>
<code>${code}</code>
Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Generate code based on the above context, but remember to ONLY output code & relevant comments:`;
	} else {
		throw new Error("Invalid action type");
	}
}

// Function to stream text from Claude API
async function* streamText(prompt: string): AsyncGenerator<string, void, unknown> {
	try {
		const stream = await anthropic.messages.create({
			model: 'claude-3-5-sonnet-20240620',
			max_tokens: 1000,
			temperature: 0.7,
			system: SYSTEM_PROMPT,
			messages: [
				{ role: 'user', content: prompt }
			],
			stream: true
		});

		for await (const chunk of stream) {
			if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
				yield chunk.delta.text;
			}
		}
	} catch (error) {
		console.error('Error streaming from Claude API:', error);
		throw error;
	}
}

// Function to generate and insert/replace code
async function generateAndInsertCode(editor: vscode.TextEditor, history: LineDelta, mode: ActionType) {
	const context = getContext(editor, history);
	const codeToModify = getCodeToModify(editor, mode);
	const prompt = createPrompt(context, codeToModify, mode);
	console.debug(prompt);

	try {
		const textStream = streamText(prompt);
		let generatedText = '';

		for await (const textChunk of textStream) {
			generatedText += textChunk;
		}

		await editor.edit(editBuilder => {
			if (mode === 'selection' && !editor.selection.isEmpty) {
				editBuilder.replace(editor.selection, generatedText);
			} else {
				editBuilder.insert(editor.selection.active, generatedText);
			}
		});

		vscode.window.showInformationMessage('Code generation completed');
	} catch (error) {
		let errorMessage = 'Failed to generate code';
		if (error instanceof Error) {
			errorMessage += ': ' + error.message;
		}
		vscode.window.showErrorMessage(errorMessage);
	}
}

// Create commands for each combination
const contextOptions: LineDelta[] = [20, 50, 100, 'all'];
const modeOptions: ActionType[] = ['cursor', 'selection'];

export function activate(context: vscode.ExtensionContext) {
	console.log('Activating claudette extension');

	for (const lineCount of contextOptions) {
		for (const mode of modeOptions) {
			const prefix = mode === 'cursor' ? 'generate' : 'refactor';
			const commandId = `claudette.${prefix}With${lineCount.toString().charAt(0).toUpperCase() + lineCount.toString().slice(1)}LinesContext`;
			const commandHandler = vscode.commands.registerCommand(commandId, async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					vscode.window.showErrorMessage('No active text editor');
					return;
				}

				await generateAndInsertCode(editor, lineCount, mode);
			});

			context.subscriptions.push(commandHandler);
		}
	}

	console.log('Commands registered');
}

export function deactivate() { }
