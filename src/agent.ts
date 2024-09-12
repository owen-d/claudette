import * as vscode from 'vscode';
import { Action, cancel, lift, liftEditor, pure } from "./action";
import { decideTool } from "./anthropic";
import { cursorLocationTool, dirCtxTool, nextProblemTool, referencesTool, surroundingContextTool, symbolHierarchyTool } from "./navigation";
import { createObjectSchema, createStringSchema, detectSchema, Tool } from "./tool";

/** File for multi-round, agentic reasoning
 *
 * The goal of this package is to wrap a set of (goal, context, history, tools)
 * in order to facilitate LLM-driven decisionmaking that can be multi-faceted.
 * As an example:
 *
 * "Refactor this method to add an optional `shouldRetry(err) bool` callback".
 * Conceptually, this may do a few things:
 * 1) Get the location information for the desired function (file, offset)
 * 2) Get the surrounding context via multipl(prev 50 lines through post 50 lines, available function signatures)
 * 3) With the above context; refactor & replace the current function
 * 4) Find all references to the function [(file, offset)...]
 * 5) For each reference, refactor the function to account for new argument
 * 6) Return done() with a summary of the step you've taken
 */



export type AgentOpts = {
  goal: string,
  maxRounds?: number,
};

export class Agent {
  private goal: string;
  private rounds: number;
  private maxRounds: number;
  private messageHistory: Message[];
  private plan: string = '';

  private constructor(opts: AgentOpts) {
    this.goal = opts.goal;
    this.rounds = 0;
    this.maxRounds = opts.maxRounds ?? 4;
    this.messageHistory = [];
  }

  static create(opts: AgentOpts): Agent {
    return new Agent(opts);
  }


  // Maps a set of tools to return Step<O> instead of O
  static _stepMap<T extends Tool<any, any>[]>(
    type: StepType,
    ...tools: [...T]
  ) {
    // Return type 
    type MapToStep<T> = {
      [K in keyof T]: T[K] extends Tool<infer I, infer O> ? Tool<I, Step<O>> : never
    };

    return tools.map(
      tool => tool.map(
        val => ({
          type,
          val,
        })
      )
    ) as MapToStep<T>;
  }

  // toolkit returns all the provided tools plus a few extras (planning, finishing)
  private toolkit() {
    const intermediates = Agent._stepMap(
      StepType.Intermediate,
      cursorLocationTool,
      symbolHierarchyTool,
      referencesTool,
      nextProblemTool,
      surroundingContextTool,
      dirCtxTool,
      // internal tools 
      setPlanTool.sideEffect(
        ({ plan }) => {
          this.plan = plan;
        }
      ),
    );

    const finalSteps = Agent._stepMap(
      StepType.Finished,
      // internal tools
      finishTool.debug('Finished tool'),
    );

    return [...intermediates, ...finalSteps];
  }

  /** 
   * Creates a prompt with the following information:
   * Preamble, explaining it's a code assistant & it's task is to build a plan and ultimately solve an arbitrary goal with a set of tools
   * the goal (if present)
   * the plan (if present)
   * Directory context (resolved via dirCtx tool)
   * The past 6 message from history
   * Detailed instructions for how to proceed:
   * Build a plan -> follow it & continually update the plan
   */
  private prompt(): Action<string> {
    return dirCtxTool.action()
      .map(dirCtx => {
        const preamble = `<preamble>You are an AI code assistant. Your task is to build a plan and solve an arbitrary goal using the provided tools.</preamble>`;

        const goalSection = this.goal ? `<goal>${this.goal}</goal>` : '';
        const planSection = this.plan ? `<plan>${this.plan}</plan>` : '';

        // const dirContextSection = `<context>Following is the dirContext block containing all the function signatures in the current folder:
        // <dirContext>${dirCtx}</dirContext></context>`;

        const historySection = `<history>${this.messageHistory.slice(-6).map(msg => `<message user="${msg.user}">${msg.msg}</message>`).join('')}</history>`;

        const instructions = `<instructions>
1. Review the goal and current plan (if any).
2. If no plan exists, create one to achieve the goal.
3. Follow the plan, updating it as needed.
4. Use the provided tools to gather information and make changes.
5. Continually reassess and adjust the plan based on new information.
6. When the goal is achieved, use the finish tool to complete the task.
7. Remember to account for tool input & output schemas. They're often meant to be used together, for instance the 'cursorLocationTool' returns the location at the cursor, whose output can be sent to the 'symbolHierarchyTool' to lookup the symbols the cursor is within.
</instructions>`;


        const res = `${preamble}
${goalSection}
${planSection}
${historySection}
${instructions}`;

        console.log(`sending prompt: ${res}`);
        return res;
      });

  }

  step() {
    // first we check if there's been too many steps
    return pure(() => {
      this.rounds++;
      if (this.rounds > this.maxRounds) {
        return Action.fail("Max rounds reached");
      }
    })
      .bind(() => this.prompt())
      .bind(prompt => decideTool(
        prompt,
        ...this.toolkit(),
      ))
      .sideEffect(({ tool, input, output }) => {
        this.messageHistory.push(
          {
            user: 'user',
            msg: JSON.stringify(input),
          },
          {
            user: 'assistant',
            tool: tool.name,
            msg: JSON.stringify(output)
          },
        );
      });
  }

  private recurse(): Action<void> {
    const a = this.step().map(
      ({ tool, input, output: { type, val } }) => ({
        type,
        tool: tool.name,
        input,
        val,
      }),
    );
    return continueAction(a)
      .bind(({ type }) => {
        if (type === StepType.Finished) {
          return pure(undefined);
        } else {
          console.log('recursing');
          return this.recurse();
        }
      });
  }

  static run(): Action<void> {
    return promptUserTool.action({
      prompt: 'Enter goal',
      placeHolder: 'e.g., Add an optional argument & update dependencies',
    })
      .bind(goal => {
        let agent = Agent.create({ goal, });
        return agent.recurse()
          .sideEffect(() => {
            console.log("finished!");
            console.log(agent.goal);
            console.log(agent.messageHistory);
          });
      });
  }
}


// prompt the user if they want to coninue based on the result
function continueAction<A extends Step<any>>(a: Action<A>): Action<A> {
  return a.bind(result =>
    lift(async () => {
      // Show the result in a buffer
      await vscode.window.showTextDocument(vscode.Uri.parse(`untitled:result.json`), { preview: false })
        .then(editor =>
          editor.edit(editBuilder => {
            // to show the str forms of enums
            const mapped = {
              ...result,
              type: StepType[result.type],
            };
            editBuilder.insert(new vscode.Position(0, 0), JSON.stringify(mapped, null, 2));
          })
        );
    }).bind(() =>
      promptUserTool.action({
        prompt: `Operation completed. Continue?`,
        placeHolder: 'yes/no, y/n ',
      }).map(answer => answer.toLowerCase().startsWith('y'))
    ).bind(shouldContinue =>
      shouldContinue ? pure(result) : cancel<A>()
    )
  );
}



type Message = {
  tool?: string,
  user: 'system' | 'user' | 'assistant',
  msg: string,
};

type Step<T> = {
  type: StepType,
  val: T,
};

enum StepType {
  Intermediate,
  Finished,
}

type Plan = {
  plan: string,
};

type FinishToolInput = {
  summary?: string
};

// a tool whose calling indicates the completion of an agent's work
const finishTool = Tool.create<FinishToolInput, Step<string | undefined>>(
  'finish',
  'Indicate that the agent has completed its task',
  createObjectSchema()
    .property('summary', createStringSchema().build())
    .build(),
  x => pure({
    type: StepType.Finished,
    val: x.summary,
  }),
);

// a tool for setting or updating a plan
const setPlanTool = Tool.create<Plan, Plan>(
  'setPlan',
  'Set (create|update) a plan of steps to accomplish the given goal',
  detectSchema({
    plan: "To get the square of double the input, first multiply it by two then multiply that by itself.",
  }),
  pure,
);

export const promptUserTool = Tool.create<vscode.InputBoxOptions, string>(
  'promptUser',
  'Prompt the user for input',
  createObjectSchema()
    .property('prompt', createStringSchema().build())
    .property('placeHolder', createStringSchema().build())
    .build(),
  opts => liftEditor(
    async (editor) => vscode.window.showInputBox(opts)
  ).bind(x => x === undefined ? cancel<string>() : pure(x))
);


// spare todo for later (DO NOT IMPLEMENT YET):
// 
// plan stage: build a plan for how to execute
// multi tool call in single round (e.g. surrounding lines, dirCtx)
// done() function
// max history, max rounds?
// undo all
// accept plan stage for manual approving
// Refactor plan w/ input
// tool for reading conversation history