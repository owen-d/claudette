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
7. Focus solely on code generation; do not engage in conversation or provide spurious explanations or examples.

Encode responses into an <completion/> and <misc/> xml tags where 'completion' is the code to be added and 'misc' can include any miscellaneous information like examples/etc. This 'misc' section is not advised to be used, but available if necessary.

Here's an example:
<completion>function add(num1, num2) {
  return num1 + num2;
}</completion>
<misc>// Example usage
console.log(addNumbers(5, 7)); // Output: 12</misc>
`;



// Initialize the Anthropic client
const anthropic = new Anthropic({
	apiKey: ANTHROPIC_API_KEY, // Replace with your actual API key
});

// Define the ParsedCompletion type
type ParsedCompletion = {
	completion: string;
	misc?: string;
};

class ParserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ParserError';
	}
}

function parseResponse(response: string): ParsedCompletion {
	// Regular expressions to match the completion and misc blocks
	const completionRegex = /<completion>([\s\S]*?)<\/completion>/;
	const miscRegex = /<misc>([\s\S]*?)<\/misc>/;

	// Extract completion block
	const completionMatch = response.match(completionRegex);
	if (!completionMatch || !completionMatch[1]) {
		throw new ParserError('No <completion> block found in the response');
	}

	const result: ParsedCompletion = {
		completion: completionMatch[1].trim()
	};

	// Extract misc block (optional)
	const miscMatch = response.match(miscRegex);
	if (miscMatch && miscMatch[1]) {
		result.misc = miscMatch[1].trim();
	}

	return result;
}

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
		let resp = parseResponse(first.text);
		console.debug(JSON.stringify(resp, null, 2));
		return resp.completion;
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