import { Action, lift, pure } from "./action";
import { decideTool } from "./anthropic";
import { dirCtxTool, nextProblemTool, referencesTool, surroundingContextTool, symbolHierarchyTool } from "./navigation";
import { createToolPrompt } from "./prompt";
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
  private messageHistory: any[];
  private plan: string = '';

  private constructor(opts: AgentOpts) {
    this.goal = opts.goal;
    this.rounds = 0;
    this.maxRounds = opts.maxRounds ?? 10;
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

  private prompt(): string {
    return createToolPrompt({
      type: 'tool',
      goal: this.goal,
      tools: this.toolkit(),
    });
  }

  step(): Action<void> {
    // first we check if there's been too many steps
    return pure(() => {
      this.rounds++;
      if (this.rounds > this.maxRounds) {
        return Action.fail("Max rounds reached");
      }
    })
      .bind(() => decideTool(
        this.prompt(),
        ...this.toolkit(),
      ))
      .bind(({ tool, input, output: { type, val } }) => {
        if (type === StepType.Finished) {
          // done?
          return pure(undefined);
        }

        // do smtn with intermediate step?
        return pure(undefined);

      });
  }

}

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