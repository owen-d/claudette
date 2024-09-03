export type CompletionType = "selection" | "cursor";

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

export type PromptInput = CursorPrompt | RefactorPrompt;

export function createPrompt(input: PromptInput): string {
  if (input.type === 'cursor') {
    return createCursorPrompt(input);
  } else {
    return createRefactorPrompt(input);
  }
}

function createCursorPrompt(opts: CursorPrompt): string {
  return `Given the following xml sections, output ONLY new code and comments to be inserted at <cursor/>. Do not repeat any existing code.

Here's a legend for some of the sections:
<code/>: The code from the file we're editing. This contains lines before and after the cursor position.
<cursor/>: The cursor position within <code/>. This is where your new code should be inserted.
${opts.context ? '<context/>: Additional context for reference. This can be types, functions, & comments from the current pkg, etc.' : ''}
${opts.instruction ? '<instruction/>: Additional instructions to follow' : ''}

Important rules:
1. Focus solely on generating new code; do NOT engage in conversation, explanations, or examples.
2. Do not repeat any code that appears before <cursor/>.
3. Only complete the current context (function, block, etc). Don't add entire new functions unless explicitly instructed.
4. Include comments for function definitions or complex logic.
5. Generate only code and relevant comments. No additional formatting or markdown.

Example:
Given <code>function example(x: number) {<cursor/>}</code>
A good response would be: "return x * 2;"

Your task:

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeCursor}<cursor/>${opts.afterCursor}</code>

Remember: Start your response exactly where <cursor/> is placed, without repeating any existing code.
`;
}

function createRefactorPrompt(opts: RefactorPrompt): string {
  return `Given the following xml sections, refactor the <selection/> block alone; DO NOT repeat anything outside of it. You may use elements from the original code if appropriate.

Here's a legend for some of the sections:
<code/>: The entire code snippet, including content before and after the selection.
<selection/>: The selected code to be refactored. This is where your changes should focus.
${opts.context ? '<context/>: Additional context for reference. This can be types, functions, & comments from the current package, etc.' : ''}
${opts.instruction ? '<instruction/>: Additional instructions to follow for the refactoring task.' : ''}

Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Don't go overboard -- only refactor the selected context. Function definitions should include comments.
Generate code based on the following inputs, but remember to ONLY output code & relevant comments. No additional formatting.

Example:
Given <code>function example(x: number) {<selection>return x + 1;</selection>}</code>
A good response would be: "return x * 2;"

Your task:

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeSelection}<selection>${opts.selection}</selection>${opts.afterSelection}</code>

Remember: Focus solely on refactoring the code within <selection/>, without repeating any code outside of it.
`;
};