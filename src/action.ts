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
  apply<B>(actionWithFunc: Action<(a: A) => B>): Action<B> {
    return new Action<B>(async (editor) => {
      const [resultA, resultF] = await Promise.all([this.run(editor), actionWithFunc.execute(editor)]);
      if (resultA.type === 'cancelled' || resultF.type === 'cancelled') { return { type: 'cancelled' }; };
      return { type: 'success', value: resultF.value(resultA.value) };
    });
  }

  // Convenience method for sequencing actions
  then<B>(next: Action<B>): Action<B> {
    return this.bind(() => next);
  }

  // Recover from cancellation
  recover(recoveryValue: A): Action<A> {
    return new Action<A>(async (editor) => {
      const result = await this.run(editor);
      return result.type === 'cancelled' ? { type: 'success', value: recoveryValue } : result;
    });
  }

  // Handle cancellation with a custom action
  recoverWith(recoveryAction: Action<A>): Action<A> {
    return new Action<A>(async (editor) => {
      const result = await this.run(editor);
      return result.type === 'cancelled' ? recoveryAction.execute(editor) : result;
    });
  }
}

// Helper functions

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

// Sequence an array of actions
export function sequence<A>(actions: Action<A>[]): Action<A[]> {
  return new Action(async (editor) => {
    return Promise.all(actions.map(action => action.execute(editor)))
      .then(xs => {
        let successes = xs.filter(x => x.type === 'success');
        if (xs.length !== successes.length) {
          return cancellation();
        }

        return success(successes.map(x => x.value));
      })
      ;
  });

}

// Traverse an array with an action-returning function
export function traverse<A, B>(arr: A[], f: (a: A) => Action<B>): Action<B[]> {
  return sequence(arr.map(f));
}

const insertText = (text: string): Action<void> =>
  liftEditor(async (editor) => {
    await editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, text);
    });
  });

