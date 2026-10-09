/**
 * kernel/broker/definition.ts — the shape of one broker tool.
 *
 * Every tool is declared once: its name, what it does in ordinary words, the
 * surface it belongs to, whether it only reads, a closed input schema, a
 * validator that turns raw arguments into typed input, and the operation.
 * MCP registration, the two surfaces, the tests, and the reference docs all
 * derive from the same definitions.
 */

export type Surface = 'interactive' | 'headless' | 'both';

export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

/**
 * One input property, written with type, description, enum, items,
 * properties, required and additionalProperties only; format and examples are
 * left out because some hosts drop them. An array always says what it holds.
 */
export type JsonSchemaProperty =
  | {
      readonly type: 'string' | 'number' | 'boolean';
      readonly description: string;
      readonly enum?: readonly string[];
    }
  | {
      readonly type: 'object';
      readonly description: string;
      readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
      readonly required?: readonly string[];
      readonly additionalProperties?: false;
    }
  | {
      readonly type: 'array';
      readonly description: string;
      readonly items: JsonSchemaItem;
    };

/** What an array input holds. */
export type JsonSchemaItem =
  | {
      readonly type: 'string';
      readonly enum?: readonly string[];
      readonly description?: string;
    }
  | {
      readonly type: 'object';
      readonly description?: string;
      readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
      readonly required?: readonly string[];
      readonly additionalProperties?: false;
    };

/** What is wrong with an input, in terms the caller can fix. */
export interface InputProblem {
  /** The input that is wrong. */
  readonly field?: string;
  /** The values that input accepts, when they are a closed set. */
  readonly allowed?: readonly string[];
  /** A value for that one input that would be accepted. */
  readonly example?: unknown;
}

/**
 * The caller's input is wrong. It reaches the host as a tool error result the
 * model reads, naming the field and, when there are any, the allowed values
 * and an example, so the model can correct the call itself.
 */
export class ToolInputError extends Error {
  readonly field: string | null;
  readonly allowed: readonly string[] | null;
  readonly example: unknown;

  constructor(message: string, problem: InputProblem = {}) {
    super(message);
    this.name = 'ToolInputError';
    this.field = problem.field ?? null;
    this.allowed = problem.allowed ? [...problem.allowed] : null;
    this.example = problem.example === undefined ? null : problem.example;
  }
}

export interface ToolDefinition<C, I, O> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly surface: Surface;
  readonly readOnly: boolean;
  /**
   * The tool can make a change a person would not want made without them:
   * minting an approval, settling a trust state, or closing work. Hosts that
   * key safeguards on MCP's destructiveHint then treat it accordingly.
   */
  readonly destructive?: boolean;
  readonly inputSchema: JsonSchema;
  validate(raw: Record<string, unknown>): I;
  run(ctx: C, input: I): Promise<O> | O;
}

export function record(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function str(raw: Record<string, unknown>, key: string, opts: { readonly optional?: boolean; readonly oneOf?: readonly string[] } = {}): string | undefined {
  const v = raw[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new ToolInputError(`"${key}" is required`, { field: key, allowed: opts.oneOf });
  }
  if (typeof v !== 'string') throw new ToolInputError(`"${key}" must be a string`, { field: key, allowed: opts.oneOf });
  if (opts.oneOf && !opts.oneOf.includes(v)) throw new ToolInputError(`"${key}" must be one of ${opts.oneOf.join(' | ')}`, { field: key, allowed: opts.oneOf });
  return v;
}

export function bool(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = raw[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new ToolInputError(`"${key}" must be true or false`, { field: key });
  return v;
}

export function num(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolInputError(`"${key}" must be a number`, { field: key });
  return v;
}

export function obj(raw: Record<string, unknown>, key: string, opts: { readonly optional?: boolean } = {}): Record<string, unknown> | undefined {
  const v = raw[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new ToolInputError(`"${key}" is required`, { field: key });
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ToolInputError(`"${key}" must be an object`, { field: key });
  return v as Record<string, unknown>;
}

export function list(raw: Record<string, unknown>, key: string): unknown[] {
  const v = raw[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ToolInputError(`"${key}" must be a list`, { field: key });
  return v;
}

/** Refuse keys the schema does not declare, so a host cannot smuggle extra intent. */
export function closed(raw: Record<string, unknown>, schema: JsonSchema): void {
  for (const key of Object.keys(raw)) {
    if (!(key in schema.properties)) throw new ToolInputError(`"${key}" is not an input of this tool`, { field: key, allowed: Object.keys(schema.properties) });
  }
}

/** The MCP tools/list entry for a definition. */
export function mcpTool(def: ToolDefinition<unknown, unknown, unknown>): Record<string, unknown> {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: def.destructive === true, openWorldHint: false },
  };
}
