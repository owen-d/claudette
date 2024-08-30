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
  apply<B, C>(this: Action<(a: B) => C>, action: Action<B>): Action<C> {
    return sequence(this, action).map(([f, g]) => f(g));
  }

  // Convenience method for sequencing actions
  then<B>(next: Action<B>): Action<B> {
    return this.bind(() => next);
  }

  // Convenience method for buffering multiple actions together into
  // a tuple.
  and<B>(other: Action<B>): Action<[A, B]> {
    return sequence(this, other);
  }

  // sideEffect allows accessing the value inside to perform some
  // non-state manipulating action (i.e. debug logging).
  sideEffect(f: (a: A) => void): Action<A> {
    return this.map(x => {
      f(x);
      return x;
    });
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

type MaybePromise<T> = T | Promise<T>;
export function liftEditor<A>(f: (editor: vscode.TextEditor) => MaybePromise<A>): Action<A> {
  function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
    return value instanceof Promise;
  }

  return new Action(async (editor): Promise<ActionResult<A>> => {
    try {
      const result = f(editor);
      if (isPromise(result)) {
        // Handle asynchronous case
        const asyncResult = await result;
        return { type: 'success', value: asyncResult };
      } else {
        // Handle synchronous case
        return { type: 'success', value: result };
      }
    } catch (error) {
      throw error;
    }
  });
}

export function lift<A>(f: () => MaybePromise<A>): Action<A> {
  // take advantage of not needing the editor
  return liftEditor(f);
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
