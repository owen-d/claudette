import { Action } from "./action";

export class Tool<I, O> {
  private constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly inputSchema: JSONSchema,
    private readonly actionFn: (input: I) => Action<O>,
    public readonly examples: Array<{ input: I; output: O }> = []
  ) { }

  static create<I, O>(
    name: string,
    description: string,
    inputSchema: JSONSchema,
    actionFn: (input: I) => Action<O>,
    examples: Array<{ input: I; output: O }> = []
  ): Tool<I, O> {
    return new Tool(name, description, inputSchema, actionFn, examples);
  }

  run(input: I): Action<O> {
    return this.actionFn(input);
  }

  static wrap<I, I1, O, O1>(
    tool: Tool<I, O>,
    inputCodec: Codec<I1, I>,
    outputCodec: Codec<O, O1>
  ): Tool<I1, O1> {
    return Tool.create(
      tool.name,
      tool.description,
      tool.inputSchema,
      (input: I1) => tool.run(inputCodec.encode(input)).map(outputCodec.encode),
      tool.examples?.map(example => ({
        input: inputCodec.decode(example.input),
        output: outputCodec.encode(example.output)
      }))
    );
  }
}


/**
 * Codec class for bidirectional conversion between types A and B
 * @template A - The first type
 * @template B - The second type
 */
export class Codec<A, B> {
  private constructor(
    private _encode: (a: A) => B,
    private _decode: (b: B) => A
  ) { }

  static from<A, B>(encode: (a: A) => B, decode: (b: B) => A): Codec<A, B> {
    return new Codec(encode, decode);
  }

  static array<I, O>(codec: Codec<I, O>): Codec<I[], O[]> {
    return new Codec(
      (arr: I[]) => arr.map(codec.encode),
      (arr: O[]) => arr.map(codec.decode)
    );
  }

  encode(a: A): B {
    return this._encode(a);
  }

  decode(b: B): A {
    return this._decode(b);
  }

  flip(): Codec<B, A> {
    return new Codec(this._decode, this._encode);
  }
}

export interface JSONSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: JSONSchemaType | JSONSchemaType[];
  properties?: { [key: string]: JSONSchema };
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema | JSONSchema[];
  enum?: any[];
  const?: any;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;
  if?: JSONSchema;
  then?: JSONSchema;
  else?: JSONSchema;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  definitions?: { [key: string]: JSONSchema };
  $ref?: string;
}

export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export class SchemaBuilder {
  private schema: JSONSchema = {};

  constructor(type: JSONSchemaType = 'object') {
    this.schema.type = type;
  }

  title(title: string): SchemaBuilder {
    this.schema.title = title;
    return this;
  }

  description(description: string): SchemaBuilder {
    this.schema.description = description;
    return this;
  }

  property(name: string, propertySchema: JSONSchema): SchemaBuilder {
    if (!this.schema.properties) {
      this.schema.properties = {};
    }
    this.schema.properties[name] = propertySchema;
    return this;
  }

  required(...propertyNames: string[]): SchemaBuilder {
    if (!this.schema.required) {
      this.schema.required = [];
    }
    this.schema.required.push(...propertyNames);
    return this;
  }

  minimum(min: number): SchemaBuilder {
    this.schema.minimum = min;
    return this;
  }

  maximum(max: number): SchemaBuilder {
    this.schema.maximum = max;
    return this;
  }

  minLength(min: number): SchemaBuilder {
    this.schema.minLength = min;
    return this;
  }

  maxLength(max: number): SchemaBuilder {
    this.schema.maxLength = max;
    return this;
  }

  pattern(pattern: string): SchemaBuilder {
    this.schema.pattern = pattern;
    return this;
  }

  enum(...values: any[]): SchemaBuilder {
    this.schema.enum = values;
    return this;
  }

  build(): JSONSchema {
    return this.schema;
  }
}

// Helper functions
function createSchema(type?: JSONSchemaType): SchemaBuilder {
  return new SchemaBuilder(type);
}

function createStringSchema(): SchemaBuilder {
  return new SchemaBuilder('string');
}

function createNumberSchema(): SchemaBuilder {
  return new SchemaBuilder('number');
}

function createArraySchema(): SchemaBuilder {
  return new SchemaBuilder('array');
}

// Example usage
const personSchema = createSchema()
  .title('Person')
  .description('A schema representing a person')
  .property('firstName', createStringSchema().minLength(1).maxLength(50).build())
  .property('lastName', createStringSchema().minLength(1).maxLength(50).build())
  .property('age', createNumberSchema().minimum(0).maximum(120).build())
  .property('email', createStringSchema().pattern('^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$').build())
  .required('firstName', 'lastName', 'age')
  .build();

export function detectSchema(obj: any): JSONSchema {
  const schema = createSchema();

  if (obj === null) {
    return createSchema('null').build();
  }

  const type = typeof obj;
  switch (type) {
    case 'string':
      return createSchema('string').build();
    case 'number':
      return createSchema('number').build();
    case 'boolean':
      return createSchema('boolean').build();
    case 'object':
      if (Array.isArray(obj)) {
        const itemSchema = obj.length > 0 ? detectSchema(obj[0]) : {};
        return createSchema('array').property('items', itemSchema).build();
      } else {
        Object.keys(obj).forEach(key => {
          const propertySchema = detectSchema(obj[key]);
          schema.property(key, propertySchema);
        });
      }
      break;
    default:
      throw new Error(`Unsupported type: ${type}`);
  }

  return schema.build();
}