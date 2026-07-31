/**
 * lib/mcp/tool-schema-validate.mjs — enforces each MCP tool's declared
 * inputSchema/outputSchema at dispatch time (construct-tsyfe.9.1).
 *
 * Uses @modelcontextprotocol/sdk/validation/ajv's AjvJsonSchemaValidator — the
 * same Ajv-backed validator the MCP SDK's own client applies to tool results
 * (see tests/mcp-tool-output-schema-guard.test.mjs) and a direct dependency
 * of @modelcontextprotocol/sdk, one of the three declared core-zone
 * exceptions. Reusing it adds no new dependency and no marginal install
 * footprint: Ajv already ships with the
 * already-approved SDK. The alternative — a sixth hand-rolled JSON-Schema-
 * subset validator alongside lib/config/schema.mjs, lib/flows/schema.mjs,
 * lib/providers/instance-config.mjs, lib/registry/custom-schema.mjs, and
 * lib/specialists/schema.mjs — reproduces the defect that defines the
 * schema-validation delegation class: duplicated validators, not any
 * one validator's correctness.
 *
 * Compiled validators are cached per schema object (stable module-level
 * references from tool-definitions*.mjs / *.tool.mjs), so a long-running
 * server compiles each tool's schema once rather than on every call.
 */
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const validatorProvider = new AjvJsonSchemaValidator();
const compiledCache = new WeakMap();

function getCompiled(schema) {
  if (!schema || typeof schema !== 'object') return null;
  let fn = compiledCache.get(schema);
  if (!fn) {
    fn = validatorProvider.getValidator(schema);
    compiledCache.set(schema, fn);
  }
  return fn;
}

// MCP tool arguments are LLM-generated content crossing a host trust
// boundary; a schema silent on size still must not admit an unbounded
// payload. Ceilings are generous on purpose — large legitimate content
// (a real git diff, extracted document text, artifact bodies) must keep
// working unchanged; only pathological payloads are meant to trip this.

export const DEFAULT_MAX_STRING_LENGTH = 2_000_000;
export const DEFAULT_MAX_ARRAY_LENGTH = 10_000;

function oversizedValues(value, path = '$') {
  const violations = [];
  if (typeof value === 'string') {
    if (value.length > DEFAULT_MAX_STRING_LENGTH) {
      violations.push(`${path}: string length ${value.length} exceeds ${DEFAULT_MAX_STRING_LENGTH}`);
    }
  } else if (Array.isArray(value)) {
    if (value.length > DEFAULT_MAX_ARRAY_LENGTH) {
      violations.push(`${path}: array length ${value.length} exceeds ${DEFAULT_MAX_ARRAY_LENGTH}`);
    }
    value.forEach((item, i) => violations.push(...oversizedValues(item, `${path}[${i}]`)));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, sub] of Object.entries(value)) {
      violations.push(...oversizedValues(sub, `${path}.${key}`));
    }
  }
  return violations;
}

/**
 * Validates args against def.inputSchema plus the size ceilings above. A def
 * with no inputSchema is treated as accepting anything (unchanged behavior);
 * every tool in the catalog declares one as of construct-tsyfe.9.1's audit
 * (79/79 hardcoded + self-registered defs).
 */
export function validateToolInput(def, args) {
  const errors = oversizedValues(args ?? {});
  const validate = getCompiled(def?.inputSchema);
  if (validate) {
    const outcome = validate(args ?? {});
    if (!outcome.valid) errors.push(outcome.errorMessage);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a handler's return value against def.outputSchema. Every
 * catalog def carries one (defaulted to DEFAULT_OUTPUT_SCHEMA by
 * withSafetyEnvelope / scanToolModules), so a missing schema here only
 * happens for a name outside the catalog and is treated as valid.
 */
export function validateToolOutput(def, result) {
  const validate = getCompiled(def?.outputSchema);
  if (!validate) return { valid: true, errors: [] };
  const outcome = validate(result);
  return outcome.valid ? { valid: true, errors: [] } : { valid: false, errors: [outcome.errorMessage] };
}
