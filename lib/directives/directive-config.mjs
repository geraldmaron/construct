/**
 * lib/directives/directive-config.mjs — standing-instruction records
 * ("directives") a user attaches to a provider: recurring work the daemon
 * should surface without a fresh invocation each time (e.g. "watch Jira,
 * summarize what the team is working on weekly").
 *
 * A directive is data, validated the same way lib/config/source-targets.mjs
 * validates a source target: shape-checked here, resolved against the
 * merged config by resolveEffectiveDirectivesFromConfig, and never executed
 * by this module — lib/embed/daemon.mjs's "directive-runner" job is the only
 * consumer that acts on a directive, and even it only ever records that a
 * directive is due (a durable ledger entry a human or, once wired,
 * lib/oracle/execute.mjs's directive-execution branch can act on) rather
 * than running anything unattended. `autoRun` is a documented seam for that
 * later wiring, not permission for the validation/resolution helpers below
 * to run an LLM call.
 */

export const DIRECTIVE_TRIGGER_KINDS = Object.freeze(['interval', 'on-demand']);
export const DIRECTIVE_ACTIONS = Object.freeze(['summarize', 'draft-artifact', 'file-beads', 'dispatch-worker-profile']);
export const DIRECTIVE_OUTPUT_KINDS = Object.freeze(['knowledge-note', 'artifact-draft', 'beads', 'pr']);

const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/i;

/**
 * Validate one directive record. Returns an array of error strings (empty
 * when valid) — never throws, mirroring
 * lib/config/source-targets.mjs's validateSourceTarget.
 *
 * @param {object} directive
 * @param {number} index
 * @param {object} [opts]
 * @param {string[]} [opts.knownWorkerProfiles] - bare or cx-prefixed ids; unresolvable when supplied and non-empty
 * @returns {string[]}
 */
export function validateDirective(directive, index = 0, { knownWorkerProfiles } = {}) {
  const errors = [];
  const at = `directives[${index}]`;

  if (!directive || typeof directive !== 'object' || Array.isArray(directive)) {
    return [`${at}: must be an object`];
  }

  if (typeof directive.id !== 'string' || !ID_RE.test(directive.id)) {
    errors.push(`${at}.id: required stable id (letters, numbers, hyphens, underscores; max 64 chars)`);
  }

  if (typeof directive.provider !== 'string' || !directive.provider.trim()) {
    errors.push(`${at}.provider: required non-empty string naming the bound provider`);
  }

  if (typeof directive.workerProfileId !== 'string' || !directive.workerProfileId.trim()) {
    errors.push(`${at}.workerProfileId: required non-empty string naming the responsible Worker Profile`);
  } else if (Array.isArray(knownWorkerProfiles) && knownWorkerProfiles.length > 0) {
    const bare = directive.workerProfileId.replace(/^cx-/, '');
    const known = knownWorkerProfiles.some((s) => s === directive.workerProfileId || s.replace(/^cx-/, '') === bare);
    if (!known) errors.push(`${at}.workerProfileId: unresolvable Worker Profile id '${directive.workerProfileId}'`);
  }

  if (typeof directive.instruction !== 'string' || !directive.instruction.trim()) {
    errors.push(`${at}.instruction: required non-empty string`);
  }

  if (!directive.trigger || typeof directive.trigger !== 'object') {
    errors.push(`${at}.trigger: required object`);
  } else if (!DIRECTIVE_TRIGGER_KINDS.includes(directive.trigger.kind)) {
    errors.push(`${at}.trigger.kind: must be one of ${DIRECTIVE_TRIGGER_KINDS.join(', ')}`);
  } else if (directive.trigger.kind === 'interval') {
    const minutes = directive.trigger.intervalMinutes;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
      errors.push(`${at}.trigger.intervalMinutes: required positive number when trigger.kind is 'interval'`);
    }
  }

  if (!DIRECTIVE_ACTIONS.includes(directive.action)) {
    errors.push(`${at}.action: must be one of ${DIRECTIVE_ACTIONS.join(', ')}`);
  }

  if (!directive.output || typeof directive.output !== 'object') {
    errors.push(`${at}.output: required object`);
  } else if (!DIRECTIVE_OUTPUT_KINDS.includes(directive.output.kind)) {
    errors.push(`${at}.output.kind: must be one of ${DIRECTIVE_OUTPUT_KINDS.join(', ')}`);
  }

  if (directive.autoRun !== undefined && typeof directive.autoRun !== 'boolean') {
    errors.push(`${at}.autoRun: must be a boolean when present`);
  }

  return errors;
}

/**
 * Validate an array of directives, including duplicate-id detection.
 *
 * @param {any} directives
 * @param {object} [opts]
 * @param {string[]} [opts.knownWorkerProfiles]
 * @returns {string[]}
 */
export function validateDirectives(directives, opts = {}) {
  if (directives === undefined) return [];
  if (!Array.isArray(directives)) return ['directives: must be an array'];

  const errors = [];
  const seenIds = new Set();
  directives.forEach((directive, index) => {
    errors.push(...validateDirective(directive, index, opts));
    const id = directive?.id;
    if (typeof id === 'string') {
      const key = id.toLowerCase();
      if (seenIds.has(key)) errors.push(`directives[${index}].id: duplicate id "${id}"`);
      seenIds.add(key);
    }
  });
  return errors;
}

/**
 * Normalize a directive record with its documented defaults —
 * `autoRun: false` when absent, matching the fail-safe posture every other
 * write-adjacent default in this codebase takes (lib/writes/write-policy.mjs
 * DEFAULT_WRITE_POLICY_MODE, lib/embed/authority-guard.mjs's fail-safe
 * approval-queued default).
 *
 * @param {object} raw
 * @returns {object}
 */
export function normalizeDirective(raw) {
  return {
    ...raw,
    autoRun: raw.autoRun ?? false,
  };
}

/**
 * Resolve the effective, normalized directive list from a loaded
 * construct.config.json. Does not validate — callers that need validation
 * errors call validateDirectives on the raw config value first (the same
 * split lib/config/source-targets.mjs's resolveEffectiveSourceTargetsFromConfig
 * keeps from validateSourceTargets).
 *
 * @param {object} config - a loaded construct.config.json
 * @returns {object[]}
 */
export function resolveEffectiveDirectivesFromConfig(config) {
  return (config?.directives ?? []).map(normalizeDirective);
}
