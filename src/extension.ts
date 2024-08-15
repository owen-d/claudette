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

async function* streamText(prompt: string): AsyncGenerator<string, void, unknown> {
	const userPrompt = `Complete the following code, but do NOT repeat the provided code:

${prompt}

Continue the code from here:`;

	try {
		const stream = await anthropic.messages.create({
			model: 'claude-3-5-sonnet-20240620',
			max_tokens: 1000,
			temperature: 0.7,
			system: SYSTEM_PROMPT,
			messages: [
				{ role: 'user', content: userPrompt }
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
		if (error instanceof Error) {
			throw new Error(JSON.stringify({
				message: error.message,
				name: error.name,
			}, null, 2));
		}
		throw error;
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Activating claudette extension');

	let disposable = vscode.commands.registerCommand('claudette.generateTextAtCursor', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active text editor');
			return;
		}

		const document = editor.document;
		const position = editor.selection.active;
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		try {
			const textStream = streamText(textBeforeCursor);
			let fullText = '';

			for await (const textChunk of textStream) {
				fullText += textChunk;
				await editor.edit(editBuilder => {
					const position = editor.selection.active;
					editBuilder.insert(position, textChunk);
				});
			}

			vscode.window.showInformationMessage('Text generation completed');
		} catch (error) {
			let errorMessage = 'Failed to generate text';
			if (error instanceof Error) {
				errorMessage += ': ' + error.message;
			}
			vscode.window.showErrorMessage(errorMessage);
		}
	});

	context.subscriptions.push(disposable);

	console.log('Commands registered');
}

export function deactivate() { }