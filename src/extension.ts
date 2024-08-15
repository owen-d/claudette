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
	apiKey: ANTHROPIC_API_KEY, // Replace with your actual API key
});


async function generateText(prompt: string): Promise<string> {
	try {
		const userPrompt = `Complete the following code, but do NOT repeat the provided code:

${prompt}

Continue the code from here:`;

		const message = await anthropic.messages.create({
			model: 'claude-3-5-sonnet-20240620',
			max_tokens: 1000,
			temperature: 0.7,
			system: SYSTEM_PROMPT,
			messages: [
				{ role: 'user', content: userPrompt }
			]
		});

		let first = message.content[0] as TextBlock;
		console.debug(JSON.stringify(first, null, 2));
		return first.text;
	} catch (error) {
		console.error('Error calling Claude API:', error);
		if (error instanceof Error) {
			throw new Error(JSON.stringify({
				message: error.message,
				name: error.name,
				// Add any other relevant error properties here
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

		const position = editor.selection.active;
		const document = editor.document;
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		try {
			const generatedText = await generateText(textBeforeCursor);

			await editor.edit(editBuilder => {
				editBuilder.insert(position, generatedText);
			});

			vscode.window.showInformationMessage('Text generated successfully');
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