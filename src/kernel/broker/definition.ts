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

export interface JsonSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  readonly description: string;
  readonly enum?: readonly string[];
  readonly items?: { readonly type: 'string' | 'object' };
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export interface ToolDefinition<C, I, O> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly surface: Surface;
  readonly readOnly: boolean;
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
    throw new ToolInputError(`"${key}" is required`);
  }
  if (typeof v !== 'string') throw new ToolInputError(`"${key}" must be a string`);
  if (opts.oneOf && !opts.oneOf.includes(v)) throw new ToolInputError(`"${key}" must be one of ${opts.oneOf.join(' | ')}`);
  return v;
}

export function bool(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = raw[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new ToolInputError(`"${key}" must be true or false`);
  return v;
}

export function num(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolInputError(`"${key}" must be a number`);
  return v;
}

export function obj(raw: Record<string, unknown>, key: string, opts: { readonly optional?: boolean } = {}): Record<string, unknown> | undefined {
  const v = raw[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new ToolInputError(`"${key}" is required`);
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ToolInputError(`"${key}" must be an object`);
  return v as Record<string, unknown>;
}

export function list(raw: Record<string, unknown>, key: string): unknown[] {
  const v = raw[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ToolInputError(`"${key}" must be a list`);
  return v;
}

/** Refuse keys the schema does not declare, so a host cannot smuggle extra intent. */
export function closed(raw: Record<string, unknown>, schema: JsonSchema): void {
  for (const key of Object.keys(raw)) {
    if (!(key in schema.properties)) throw new ToolInputError(`"${key}" is not an input of this tool`);
  }
}

/** The MCP tools/list entry for a definition. */
export function mcpTool(def: ToolDefinition<unknown, unknown, unknown>): Record<string, unknown> {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: false, openWorldHint: false },
  };
}
