// Simple testing for the Tool interface + schema support
import { Action, pure } from './action';
import { Tool, createTool, JSONSchema, detectSchema } from './tool'; // Adjust the import path as needed

describe('Tool', () => {
  // Mock input and output types
  type MockInput = { value: number };
  type MockOutput = { result: number };

  // Mock input schema
  const mockInputSchema: JSONSchema = {
    type: 'object',
    properties: {
      value: { type: 'number' }
    }
  };

  // Mock run function
  const mockRunFunction = (input: MockInput): Action<MockOutput> => pure({ result: input.value * 2 });

  let tool: Tool<MockInput, MockOutput>;

  beforeEach(() => {
    const mockInput = { value: 0 };
    const inputSchema = detectSchema(mockInput);
    tool = createTool<MockInput, MockOutput>(
      'Test Tool',
      'A tool for testing',
      inputSchema,
      mockRunFunction
    );
  });

  test('createTool creates a tool with correct properties', () => {
    expect(tool.name).toBe('Test Tool');
    expect(tool.description).toBe('A tool for testing');
    expect(tool.inputSchema).toEqual(mockInputSchema);
    expect(tool.examples).toEqual([]);
    expect(typeof tool.run).toBe('function');
    expect(typeof tool.addExample).toBe('function');
  });

  test('run method executes correctly', async () => {
    const input: MockInput = { value: 5 };
    const action = tool.run(input);
    const result = await action.execute({} as any);
    if (result.type === 'success') {
      expect(result.value).toEqual({ result: 10 });
    } else {
      fail('Expected successful result');
    }
  });

  test('addExample adds an example correctly', () => {
    const input: MockInput = { value: 3 };
    const output: MockOutput = { result: 6 };
    tool.addExample(input, output);
    expect(tool.examples).toContainEqual({ input, output });
  });

  test('multiple examples can be added', () => {
    tool.addExample({ value: 1 }, { result: 2 });
    tool.addExample({ value: 2 }, { result: 4 });
    expect(tool.examples).toHaveLength(2);
    expect(tool.examples[0]).toEqual({ input: { value: 1 }, output: { result: 2 } });
    expect(tool.examples[1]).toEqual({ input: { value: 2 }, output: { result: 4 } });
  });

  test('inputSchema is accessible and correct', () => {
    expect(tool.inputSchema).toEqual(mockInputSchema);
  });
});