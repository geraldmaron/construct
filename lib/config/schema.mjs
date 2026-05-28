/**
 * lib/config/schema.mjs — construct.config.json v1 schema + tiny validator.
 *
 * Defines the project-level config shape. Hand-rolled validator instead of
 * AJV/zod to keep Construct dependency-free at startup — the loader runs
 * before npm install completes in some bootstrap paths.
 *
 * Schema v1 covers: alias, deployment, providers, autoEmbed, telemetry.
 * Tier model selection lives in `specialists/registry.json` only — this config
 * file is intentionally not a second edit surface for model assignments.
 * Later phases (6, 7b) extend it with `resources` and `costs` blocks
 * without bumping the version — additive keys are allowed.
 *
 * Secret interpolation rule: any string starting with `$` is treated as
 * an env-var pointer (`"$ANTHROPIC_API_KEY"` resolves at load time from
 * process.env). Pointers keep secrets in .env where they belong.
 */

export const CONFIG_SCHEMA_VERSION = 1;

export const DEPLOYMENT_MODES = ['solo', 'team', 'enterprise'];
export const MCP_BROKER_VALUES = ['auto', 'on', 'off'];
export const DEFAULT_PROFILE_ID = 'rnd';

export const SURFACES = ['claude', 'opencode', 'codex', 'copilot', 'vscode', 'cursor'];

export const DEFAULT_PROJECT_CONFIG = Object.freeze({
  version: CONFIG_SCHEMA_VERSION,
  alias: 'Construct',
  deployment: Object.freeze({
    mode: 'solo',
    mcpBroker: 'auto',
    projectName: null,
    tenantId: null,
  }),
  providers: Object.freeze({}),
  profile: DEFAULT_PROFILE_ID,
  autoEmbed: false,
  telemetry: Object.freeze({
    enabled: true,
  }),
  roleSelection: Object.freeze({
    primary: null,
    secondary: null,
    perConversationOverride: true,
  }),
  hosts: Object.freeze(Object.fromEntries(SURFACES.map((s) => [s, Object.freeze({ enabled: true })]))),
  resources: Object.freeze({
    disk: Object.freeze({
      tracesMaxDays: 30,
      intakeArchiveMaxItems: 500,
      intakeArchiveMaxDays: 90,
      taskGraphsMaxItems: 200,
      taskGraphsMaxDays: 90,
      workerLogsMaxMb: 100,
      workerLogsMaxDays: 14,
      sessionsMaxItems: 100,
      backupsMaxDays: 60,
      handoffsMaxDays: 30,
      handoffsMaxItems: 50,
      totalCxMaxMb: 2000,
    }),
    process: Object.freeze({
      embedDaemonMaxRssMb: 800,
      mcpServerMaxRssMb: 250,
      workerReplicaMaxRssMb: 256,
    }),
  }),
});

export const FIELD_RULES = {
  version: { type: 'number', required: true },
  alias: { type: 'string', required: false, maxLength: 120 },
  deployment: {
    type: 'object',
    required: false,
    fields: {
      mode: { type: 'string', enum: DEPLOYMENT_MODES },
      mcpBroker: { type: 'string', enum: MCP_BROKER_VALUES },
      projectName: { type: ['string', 'null'] },
      tenantId: { type: ['string', 'null'] },
    },
  },
  providers: { type: 'object', required: false },
  profile: { type: 'string', required: false, maxLength: 40 },
  autoEmbed: { type: 'boolean', required: false },
  telemetry: {
    type: 'object',
    required: false,
    fields: {
      enabled: { type: 'boolean' },
    },
  },
  roleSelection: {
    type: 'object',
    required: false,
    fields: {
      primary: { type: ['string', 'null'], maxLength: 50 },
      secondary: { type: ['string', 'null'], maxLength: 50 },
      perConversationOverride: { type: 'boolean' },
    },
  },
  resources: { type: 'object', required: false },
  hosts: {
    type: 'object',
    required: false,
    fields: Object.fromEntries(SURFACES.map((s) => [s, {
      type: 'object',
      required: false,
      fields: {
        enabled: { type: 'boolean', required: false },
      },
    }])),
  },
  costs: {
    type: 'object',
    required: false,
    fields: {
      billingMode: { type: 'string', enum: ['metered', 'subscription', 'mixed'] },
      enforce: { type: 'boolean' },
      budgets: { type: 'object' },
      // Per-provider billing-mode overrides. The global billingMode is the
      // fallback; entries here win for the provider id (anthropic, openai,
      // openrouter, gemini, ollama, local, github-copilot, …). Subscription
      // entries contribute $0 to "actual spend" headline numbers; the
      // metered-equivalent stays in the footnote.
      providers: { type: 'object', required: false },
    },
  },
};

function checkType(value, expected) {
  if (Array.isArray(expected)) return expected.some((t) => checkType(value, t));
  if (expected === 'null') return value === null;
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  return typeof value === expected;
}

function validateField(value, rule, path) {
  const errors = [];
  if (value === undefined) {
    if (rule.required) errors.push(`${path}: required field missing`);
    return errors;
  }
  if (!checkType(value, rule.type)) {
    errors.push(`${path}: expected type ${JSON.stringify(rule.type)}, got ${value === null ? 'null' : typeof value}`);
    return errors;
  }
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(rule.enum)}, got ${JSON.stringify(value)}`);
  }
  if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
    errors.push(`${path}: exceeds maxLength ${rule.maxLength}`);
  }
  if (rule.fields && checkType(value, 'object')) {
    for (const [key, subRule] of Object.entries(rule.fields)) {
      errors.push(...validateField(value[key], subRule, `${path}.${key}`));
    }
  }
  return errors;
}

export function validateProjectConfig(raw) {
  const errors = [];
  if (!checkType(raw, 'object')) {
    return { valid: false, errors: ['root: must be an object'] };
  }
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    errors.push(...validateField(raw[key], rule, key));
  }
  if (raw.version !== undefined && raw.version !== CONFIG_SCHEMA_VERSION) {
    errors.push(`version: expected ${CONFIG_SCHEMA_VERSION}, got ${raw.version}`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
