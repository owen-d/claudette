import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { TextBlock } from '@anthropic-ai/sdk/resources/messages.mjs';
import { Tool } from './tool';
import { Action, cancel, fail, lift, pure } from './action';
import { promptUserTool } from './navigation';



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

const baseOpts = {
  model: 'claude-3-5-sonnet-20240620',
  max_tokens: 1000,
  temperature: 0.7,
  system: SYSTEM_PROMPT,
};

export type TextStream = AsyncGenerator<string, void, unknown>;

// Streaming function
export async function* streamText(prompt: string): TextStream {
  // console.debug(prompt)
  try {
    const stream = await anthropic.messages.create({
      ...baseOpts,
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: true,
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

type UnwrapTool<T> = T extends Tool<infer I, infer O> ? { tool: Tool<I, O>, input: I; output: O } : never;

export function decideTool<T extends Tool<any, any>[]>(
  prompt: string,
  interactive: boolean,
  ...tools: [...T]
): Action<UnwrapTool<T[number]>> {

  // Inspired by the following example
  // -------------------------------
  // type Wrapper<T> = { val: T };

  // type UnwrapWrapper<T> = T extends Wrapper<infer U> ? U : never;

  // function foo<T extends Wrapper<any>[]>(...xs: [...T]): Wrapper<UnwrapWrapper<T[number]>> {
  //   const randomIndex = Math.floor(Math.random() * xs.length);
  //   return xs[randomIndex];
  // }

  // function bar() {
  //   let res = foo(
  //     { val: 1 },
  //     { val: "a" },
  //   );
  // }
  // -------------------------------


  return lift(async () => {
    try {
      return await anthropic.messages.create({
        ...baseOpts,
        messages: [
          { role: 'user', content: prompt }
        ],
        tool_choice: {
          type: 'any'
        },
        tools: tools.map(t => ({
          name: t.name,
          description: t.descriptionWithExamples().join('\n'),
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        }))
      });
    } catch (error) {
      console.error('Error deciding tool:', error);
      throw error;
    }
  })
    .bind(({ content }) => {
      const output = content.reduce<{ text: Anthropic.Messages.TextBlock[], toolUse: Anthropic.Messages.ToolUseBlock[] }>(
        (acc, cur) => {
          if (cur.type === 'text') {
            acc.text.push(cur);
          } else {
            acc.toolUse.push(cur);
          }
          return acc;
        },
        { text: [], toolUse: [] },
      );

      const call = output.toolUse[0];
      if (!call) {
        return fail('No tool was chosen');
      }

      const chosen = tools.find(t => t.name === call.name);
      if (!chosen) {
        return fail(`Chosen tool ${call.name} not found in provided tools`);
      }

      let execute = (input: any) => chosen.action(input)
        .map(output => ({
          input,
          tool: chosen,
          output,
        }) as UnwrapTool<T[number]>);


      if (interactive) {
        return approve<any, UnwrapTool<T[number]>>(
          call.input,
          input => ({ tool: chosen.name, input, }),
          execute,
          ({ output }) => ({ tool: chosen.name, output }),
        );
      }
      return execute(call.input);
    });
}


// prompt the user if they want to coninue based on the result
function approve<I, O>(
  input: I,
  // used to format the tool input into something more manageable
  fmtI: (_: I) => any,
  f: (_: I) => Action<O>,
  // used to format the tool resp into something more manageable
  fmtO: (_: O) => any,
): Action<O> {

  // subroutine
  const requestApproval = (
    x: any,
    fmt: (_: any) => any,
    msg?: string,
  ) => lift(async () => {
    // Show the result in a buffer
    await vscode.window.showTextDocument(vscode.Uri.parse(`untitled:result.json`), { preview: false })
      .then(editor =>
        editor.edit(editBuilder => {
          // to show the str forms of enums
          editBuilder.insert(
            new vscode.Position(0, 0),
            JSON.stringify(
              {
                value: fmt(x),
                msg,
              },
              null, 2,
            ),
          );
        })
      );
  }).bind(() => promptUserTool.action({
    prompt: `Operation completed. Continue? escape cancels, enter accepts`,
    placeHolder: 'ret',
  })).map(() => x);

  return requestApproval(input, fmtI, "input") // approve input
    .bind(f) // run
    .bind(o => requestApproval(o, fmtO, "output").map(() => o)); // approve output
}