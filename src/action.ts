import * as vscode from 'vscode';

// Custom type to represent the result of an action
export type ActionResult<A> = { type: 'success'; value: A } | { type: 'cancelled' };

export function cancel<A>(): Action<A> {
  return new Action(async () => cancellation());
}

export function cancellation<A>(): ActionResult<A> {
  return { type: 'cancelled' };
}

export function success<A>(a: A): ActionResult<A> {
  return { type: 'success', value: a };
}


export class Action<A> {
  constructor(private readonly run: (editor: vscode.TextEditor) => Promise<ActionResult<A>>) { }

  // Execute the action
  async execute(editor: vscode.TextEditor): Promise<ActionResult<A>> {
    return this.run(editor);
  }

  // Monadic bind operation (>>=) with cancellation support
  bind<B>(f: (a: A) => Action<B>): Action<B> {
    return new Action<B>(async (editor) => {
      const result = await this.run(editor);
      if (result.type === 'cancelled') { return { type: 'cancelled' }; }
      return f(result.value).execute(editor);
    });
  }

  // Functor map operation (fmap) with cancellation support
  map<B>(f: (a: A) => B): Action<B> {
    return new Action<B>(async (editor) => {
      const result = await this.run(editor);
      if (result.type === 'cancelled') { return { type: 'cancelled' }; }
      return { type: 'success', value: f(result.value) };
    });
  }


  // Applicative apply operation (<*>) with cancellation support
  // base version
  apply<B, C>(this: Action<(a: B) => C>, action: Action<B>): Action<C>;
  // flipped version
  apply<C>(f: Action<(a: A) => C>): Action<C>;
  // apply<C, B = (a: A) => C>(f: Action<B>): Action<C>;
  apply<B, C>(this: Action<(a: B) => C>, action: Action<B>): Action<C> {
    return sequence(this, action).map(([f, g]) => f(g));
  }

  // Convenience method for sequencing actions
  then<B>(next: Action<B>): Action<B> {
    return this.bind(() => next);
  }

}

export function pure<A>(a: A): Action<A> {
  return new Action(async () => ({ type: 'success', value: a }));
}

export function fail<A>(message: string = "Operation failed"): Action<A> {
  return new Action(async () => {
    throw new Error(message);
  });
}

export function liftEditor<A>(f: (editor: vscode.TextEditor) => Promise<A>): Action<A> {
  return new Action(async (editor) => {
    try {
      const result = await f(editor);
      return { type: 'success', value: result };
    } catch (error) {
      throw error;
    }
  });
}

// Traverse an array with an action-returning function
export function traverse<A, B>(arr: A[], f: (a: A) => Action<B>): Action<B[]> {
  return sequence(...arr.map(f));
}

type UnwrapAction<T> = T extends Action<infer U> ? U : never;

export function sequence<T extends Action<any>[]>(
  ...actions: [...T]
): Action<{ [K in keyof T]: UnwrapAction<T[K]> }> {
  return new Action(async (editor) => {
    const results = await Promise.all(actions.map(action => action.execute(editor)));

    if (results.some(result => result.type === 'cancelled')) {
      return cancellation();
    }

    const values = results.map(result => (result as ActionResult<any> & { type: 'success' }).value);
    return success(values as { [K in keyof T]: UnwrapAction<T[K]> });
  });
}
