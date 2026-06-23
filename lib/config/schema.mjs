/**
 * lib/config/schema.mjs — construct.config.json v1 schema + tiny validator.
 *
 * Defines the project-level config shape. Hand-rolled validator instead of
 * AJV/zod to keep Construct dependency-free at startup — the loader runs
 * before npm install completes in some bootstrap paths.
 *
 * Schema v1 covers: alias, deployment, providers, sources, intakePolicy,
 * autoEmbed, ingest, telemetry.
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

export const INGEST_STRATEGIES = ['adapter', 'provider', 'docling-remote'];
export const INGEST_FALLBACKS = ['none', 'provider', 'adapter'];
export const INGEST_ORCHESTRATIONS = ['prompt-only', 'orchestrated'];

export const ORCHESTRATION_WORKER_BACKENDS = ['inline', 'provider'];
export const ORCHESTRATION_STORES = ['filesystem', 'sqlite', 'postgres'];
export const CHAIN_OF_THOUGHT_MODES = ['hidden', 'surface', 'telemetry_only'];

// SessionStart context routing. `auto` keeps the rich payload on stdout for
// interactive sessions and suppresses it (to a debug log) for non-interactive /
// SDK invocations, so a one-shot command's stdout stays reserved for its output.
export const HOOK_OUTPUT_MODES = ['auto', 'silent', 'stderr', 'stdout'];

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
  sources: Object.freeze({
    targets: [],
  }),
  intakePolicy: Object.freeze({
    maxDepth: 4,
    additionalDirs: [],
  }),
  artifactWorkflow: Object.freeze({
    defaults: Object.freeze({}),
    types: Object.freeze({}),
  }),
  profile: DEFAULT_PROFILE_ID,
  autoEmbed: false,
  ingest: Object.freeze({
    strategy: 'adapter',
    fallback: 'none',
    orchestration: 'prompt-only',
  }),
  orchestration: Object.freeze({
    workerBackend: 'inline',
    store: 'filesystem',
    chainOfThought: 'hidden',
  }),
  telemetry: Object.freeze({
    enabled: true,
  }),
  hooks: Object.freeze({
    outputMode: 'auto',
  }),
  models: Object.freeze({
    visibility: Object.freeze({
      mode: 'all_configured',
      include: [],
      exclude: [],
      providers: {},
    }),
    catalog: Object.freeze({
      liveOpenRouter: true,
      maxLiveFree: 24,
    }),
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
  $schema: { type: 'string', required: false },
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
  sources: {
    type: 'object',
    required: false,
    fields: {
      targets: { type: 'array' },
    },
  },
  intakePolicy: {
    type: 'object',
    required: false,
    fields: {
      maxDepth: { type: 'number' },
      additionalDirs: { type: 'array' },
    },
  },
  artifactWorkflow: {
    type: 'object',
    required: false,
    fields: {
      defaults: { type: 'object', required: false },
      types: { type: 'object', required: false },
    },
  },
  profile: { type: 'string', required: false, maxLength: 40 },
  autoEmbed: { type: 'boolean', required: false },
  ingest: {
    type: 'object',
    required: false,
    fields: {
      strategy: { type: 'string', enum: INGEST_STRATEGIES },
      fallback: { type: 'string', enum: INGEST_FALLBACKS },
      orchestration: { type: 'string', enum: INGEST_ORCHESTRATIONS },
    },
  },
  orchestration: {
    type: 'object',
    required: false,
    fields: {
      workerBackend: { type: 'string', enum: ORCHESTRATION_WORKER_BACKENDS },
      store: { type: 'string', enum: ORCHESTRATION_STORES },
      chainOfThought: { type: 'string', enum: CHAIN_OF_THOUGHT_MODES },
    },
  },
  telemetry: {
    type: 'object',
    required: false,
    fields: {
      enabled: { type: 'boolean' },
    },
  },
  hooks: {
    type: 'object',
    required: false,
    fields: {
      outputMode: { type: 'string', enum: HOOK_OUTPUT_MODES },
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
      providers: { type: 'object', required: false },
    },
  },
  models: {
    type: 'object',
    required: false,
    fields: {
      visibility: {
        type: 'object',
        required: false,
        fields: {
          mode: { type: 'string', enum: ['all_configured', 'tier_defaults', 'explicit'] },
          include: { type: 'array' },
          exclude: { type: 'array' },
          providers: { type: 'object' },
        },
      },
      catalog: {
        type: 'object',
        required: false,
        fields: {
          liveOpenRouter: { type: 'boolean' },
          maxLiveFree: { type: 'number' },
        },
      },
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
