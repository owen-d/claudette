import { Action, pure, success } from '../action'; // Adjust the import path as needed
import * as vscode from 'vscode';

// Mock vscode.TextEditor
const mockEditor: vscode.TextEditor = {} as vscode.TextEditor;

describe('Action class', () => {
  describe('apply method', () => {
    it('should work with base version (function applied to value)', async () => {
      const addOne = pure((x: number) => x + 1);
      const five = pure(5);

      const result = addOne.apply(five);
      const executionResult = await result.execute(mockEditor);

      expect(executionResult).toEqual(success(6));
    });

    it('should work with flipped version (value applied to function)', async () => {
      const addOne = pure((x: number) => x + 1);
      const five = pure(5);

      const flipped = five.apply(addOne);
      const executionResult = await flipped.execute(mockEditor);

      expect(executionResult).toEqual(success(6));
    });

    it('should work with chained applications', async () => {
      const add = pure((x: number) => (y: number) => x + y);
      const three = pure(3);
      const four = pure(4);

      const result = add.apply(three).apply(four);
      const executionResult = await result.execute(mockEditor);

      expect(executionResult).toEqual(success(7));
    });

    it('should handle cancellation in base version', async () => {
      const addOne = pure((x: number) => x + 1);
      const cancelled = new Action<number>(async () => ({ type: 'cancelled' }));

      const result = addOne.apply(cancelled);
      const executionResult = await result.execute(mockEditor);

      expect(executionResult).toEqual({ type: 'cancelled' });
    });

    it('should handle cancellation in flipped version', async () => {
      const cancelled = new Action<(x: number) => number>(async () => ({ type: 'cancelled' }));
      const five = pure(5);

      const result = five.apply(cancelled);
      const executionResult = await result.execute(mockEditor);

      expect(executionResult).toEqual({ type: 'cancelled' });
    });
  });

  // You can add more test suites for other methods (map, bind, etc.) here
});