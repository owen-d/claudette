
export type CompletionType = "selection" | "cursor";

export function createPrompt(context: string, code: string, actionType: CompletionType, instruction?: string): string {
  const actionInstructions = {
    selection: "Refactor the <code/> block alone; DO NOT repeat anything outside of it",
    cursor: "Continue the <code/> block but DO NOT repeat its contents"
  };

  const command = actionInstructions[actionType] || (() => { throw new Error("Invalid action type"); })();

  return `Given the following xml sections, ${command}. You may use elements from the original code if appropriate.
<context>${context}</context>
${instruction !== undefined && instruction !== '' ? `<additional_instructions>${instruction}</additional_instructions>` : ''}
<code>${code}</code>
Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Don't go overboard -- only complete the current context (function, block, etc). Function definitions should include comments.
Generate code based on the above context, but remember to ONLY output code & relevant comments. No additional formatting.`;
}
