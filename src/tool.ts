import { Action } from "./action";

/*
a Tool interface. Each tool has
* An {Input,Output} (parameterized)
  * the input schema is passed to the constructor
* A name method (string)
* A description method (string)
* An optional set of example (Input,Output) pairs
* A `run(input) -> Action<output>` method
*/
export interface Tool<I, O> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  examples: Array<{ input: I; output: O }>;
  action: (input: I) => Action<O>;
  addExample: (input: I, output: O) => void;
}

export function createTool<I, O>(
  name: string,
  description: string,
  inputSchema: JSONSchema,
  runFunction: (input: I) => Action<O>
): Tool<I, O> {
  const examples: Array<{ input: I; output: O }> = [];

  return {
    name,
    description,
    inputSchema,
    examples,
    action: runFunction,
    addExample: (input: I, output: O) => {
      examples.push({ input, output });
    },
  };
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