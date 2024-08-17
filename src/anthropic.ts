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

export type TextStream = AsyncGenerator<string, void, unknown>;

// Streaming function
export async function* streamText(prompt: string): TextStream {
  // console.debug(prompt)
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