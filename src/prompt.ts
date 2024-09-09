import { Tool } from "./tool";

export type CompletionType = "selection" | "cursor" | "comment";

type CursorPrompt = {
   type: 'cursor';
   beforeCursor: string;
   afterCursor: string;
   context?: string;
   instruction?: string;
};

type RefactorPrompt = {
   type: 'selection';
   beforeSelection: string
   selection: string,
   afterSelection: string,
   context?: string;
   instruction?: string;
};

type CommentPrompt = {
   type: 'comment';
   beforeCursor: string;
   afterCursor: string;
   context?: string;
   instruction?: string;
};

type ToolPrompt = {
   type: 'tool',
   tools: Tool<any, any>[],
   goal: string,
};

export type PromptInput = CursorPrompt | RefactorPrompt | CommentPrompt;

export function createPrompt(input: PromptInput): string {
   if (input.type === 'cursor') {
      return createCursorPrompt(input);
   } else if (input.type === 'selection') {
      return createRefactorPrompt(input);
   } else {
      return createCommentPrompt(input);
   }
}

function createCursorPrompt(opts: CursorPrompt): string {
   return `As an AI coding assistant, your task is to provide code completion at the cursor position. Follow these guidelines strictly:

1. Output Format: Provide ONLY code or comments to be inserted at <cursor/>. No explanations or markdown.

2. Scope: Complete ONLY the immediate next logical step or chunk of code. Do not implement entire functions or related functionality unless explicitly requested.

3. Context Awareness: 
   - Respect existing code structure and style.
   - If completing a function, focus solely on that function's implementation.
   - Pay attention to comments, they often provide crucial hints.

4. Commenting:
   - Add comments for function definitions or complex logic.
   - Do not add comments unless necessary for understanding the new code.

5. Precision:
   - Start exactly at <cursor/> without repeating any existing code.
   - Only add the minimum required to complete the next logical chunk (e.g., a single statement, condition, or small block).

6. Restraint:
   - Do not create additional functions or implement related functionality.
   - If a function is partially defined or commented, complete only that specific function.

Example:
Given <code>function example(x: number) {<cursor/>}</code>
A good response would be: "return x * 2;"

This example demonstrates adding only the necessary code to complete the function, without any extraneous content.

Here's the context for your task:

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeCursor}<cursor/>${opts.afterCursor}</code>

Your response should begin exactly where <cursor/> is placed, providing only the next logical piece of code or necessary comment.`;
}

function createRefactorPrompt(opts: RefactorPrompt): string {
   return `As an AI coding assistant, your task is to refactor the selected code. Follow these guidelines strictly:

1. Output Format: Provide ONLY the refactored code and necessary comments to replace the <selection/> block. No explanations or markdown.

2. Scope: Refactor ONLY the code within <selection/>. Do not modify or repeat code outside this block.

3. Context Awareness: 
   - Respect the existing code structure and style.
   - You may use elements from the original code if appropriate.
   - Pay attention to the surrounding code and any provided context.

4. Refactoring Goals:
   - Improve code clarity, efficiency, or maintainability.
   - Ensure the refactored code maintains the original functionality.
   - Follow any specific instructions provided for the refactoring task.

5. Commenting:
   - Include comments for function definitions or complex logic in the refactored code.
   - Do not add comments unless necessary for understanding the refactored code.

6. Precision:
   - Start and end your refactored code exactly where the <selection/> block is placed.
   - Ensure the refactored code integrates seamlessly with the surrounding code.

7. Restraint:
   - Don't go overboard - focus on meaningful improvements within the selected context.
   - Avoid introducing unnecessary complexity.

Example:
Given
<code>function example(x: number) {<selection>return x + 1;</selection>}</code>
<instruction>instead of incrementing, double</instruction>
A good response would be: "return x * 2;"

This example demonstrates refactoring the selected code according to the specific instruction, while maintaining the function's overall structure.

Here's the context for your task:

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeSelection}<selection>${opts.selection}</selection>${opts.afterSelection}</code>

Your response should contain only the refactored code to replace the content within <selection/>.`;
}

function createCommentPrompt(opts: CommentPrompt): string {
   return `As an AI coding assistant, your task is to provide comments at the cursor position. Follow these guidelines strictly:

1. Output Format: Provide ONLY comments to be inserted at <cursor/>. No explanations or markdown.

2. Scope: Add comments ONLY for the immediate context around the cursor. Do not comment on entire functions or unrelated code unless explicitly requested.

3. Context Awareness:
   - Respect existing code structure and style.
   - If commenting within a function, focus solely on that function's relevant parts.
   - Pay attention to existing comments and code complexity.

4. Commenting:
   - Add concise, informative comments that explain non-obvious aspects of the code.
   - For functions, describe parameters, return values, and side effects if applicable.
   - Do not state the obvious or repeat information clearly visible in the code.

5. Enrichment
   - Take hints from surrounding context and follow existing code conventions
   - Prefer enriched comments when possible, e.g. including JSDoc syntax for js/ts, rustdoc conventions for rust, etc

6. Precision:
   - Start exactly at <cursor/> without repeating any existing code or comments.
   - Only add the minimum comments required to explain the immediate context.

7. Restraint:
   - Do not create comments for code that is self-explanatory.
   - If a section is already well-commented, add comments only if they provide significant additional value.

Example 1:
Given <code>function example(x: number) {<cursor/>return x * 2;}</code>
A good response would be: "// Doubles the input number"

Example 2:
Given <code><cursor/>
function example(x: number) {<cursor/>return x * 2;}</code>
A good response would be: "/**
 * Example function demonstrating refactoring with JSDoc
 * @param {number} x - The input number
 * @returns {number} The doubled value of the input
 */"

This example demonstrates adding only the necessary comment to explain the function's purpose, without any extraneous content.

Here's the context for your task:

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeCursor}<cursor/>${opts.afterCursor}</code>

Your response should begin exactly where <cursor/> is placed, providing only the necessary comments for the immediate context.`;
}

// Create a prompt for tool based function calling.
// Each tool is explained via it's description, inputSchema,
// and any examples are included as input->output mapping pairs.
export function createToolPrompt(opts: ToolPrompt): string {
   return `You are an AI assistant with access to the following tools:

${opts.tools.map((tool, index) => `Tool ${index + 1}: ${tool.name}
Description: ${tool.description}
Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}
${tool.examples && tool.examples.length > 0 ? `Examples:
${tool.examples.map((example, exIndex) => `  Example ${exIndex + 1}:
    Input: ${JSON.stringify(example.input)}
    Output: ${JSON.stringify(example.output)}`).join('\n')}` : ''}
`).join('\n')}
Your goal is: ${opts.goal}

Call them most likely tool to help you achieve your goal.
Do not reflect on the quality of the returned search results in your response.`;
}

