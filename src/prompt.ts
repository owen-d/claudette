
export type CompletionType = "selection" | "cursor";

export function createPrompt(context: string, code: string, actionType: CompletionType): string {
  const actionInstructions = {
    selection: "refactor the selected <code/> block",
    cursor: "continue the <code/> block but DO NOT repeat its contents"
  };

  const instruction = actionInstructions[actionType] || (() => { throw new Error("Invalid action type"); })();

  return `Given the following blocks, ${instruction}. You may use elements from the original code if appropriate.
<context>${context}</context>
<code>${code}</code>
Remember, focus solely on code generation; do NOT engage in conversation, spurious explanations, or examples.
Generate code based on the above context, but remember to ONLY output code & relevant comments:`;
}