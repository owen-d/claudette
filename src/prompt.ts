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
  return `Given the following xml sections, output code and comments for injection at the cursor. Here's a legend for some of the sections:
<code/>: The code from the file we're editing. This likely contains lines before and after the cursor position.
<cursor/>: The cursor position within <code/>. This is where code itself will be injected.
${opts.context ? '<context/>: Additional context for reference. This can be types, functions, & comments from the current pkg, etc.' : ''}
${opts.instruction ? '<instruction/>: Additional instructions to follow' : ''}
Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Don't go overboard -- only complete the current context (function, block, etc). Function definitions should include comments.
Generate code based on the following inputs, but remember to ONLY output code & relevant comments. No additional formatting.

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeCursor}<cursor/>${opts.afterCursor}</code>
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

${opts.context ? `<context>${opts.context}</context>` : ''}
${opts.instruction ? `<instruction>${opts.instruction}</instruction>` : ''}
<code>${opts.beforeSelection}<selection>${opts.selection}</selection>${opts.afterSelection}</code>
`;
};