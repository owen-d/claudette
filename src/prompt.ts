
export type CompletionType = "selection" | "cursor";

export function createPrompt(context: string, code: string, actionType: CompletionType, instruction?: string): string {
  const actionInstructions = {
    selection: "refactor the selected <code/> block",
    cursor: "continue the <code/> block but DO NOT repeat its contents"
  };

  const command = actionInstructions[actionType] || (() => { throw new Error("Invalid action type"); })();

  return `Given the following blocks, ${command}. You may use elements from the original code if appropriate.
<context>${context}</context>
${instruction !== undefined && instruction !== '' ? `<additional_instructions>${instruction}</additional_instructions>` : ''}
<code>${code}</code>
Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Don't go overboard -- only complete the current context (function, block, etc).
Generate code based on the above context, but remember to ONLY output code & relevant comments:`;
}