/**
 * lib/writes/write-intent.mjs — the writeIntent record: the only artifact
 * shape a specialist, embed capability, or MCP caller may produce when it
 * wants an external write to happen.
 *
 * A writeIntent never executes anything by itself. `buildWriteIntent`
 * validates and normalizes the record; `lib/writes/control-plane.mjs` is the
 * only module that turns an *approved* writeIntent into a call through
 * lib/writes/envelope.mjs. Nothing in this file resolves a provider adapter
 * or performs I/O — it is schema and validation only, so it stays importable
 * from any orchestration or embed path without smuggling in write access.
 */

/** Providers with a governed-write adapter under lib/providers/contract/adapters/*. */
export const KNOWN_PROVIDERS = Object.freeze(['jira', 'github', 'confluence', 'slack']);

/**
 * Validate a writeIntent's required shape. Returns `{ ok: true }` or
 * `{ ok: false, errors: string[] }` — never throws, so a malformed proposal
 * from a specialist degrades to a rejected intent rather than crashing the
 * caller.
 *
 * @param {object} intent
 * @param {string} intent.providerId - one of KNOWN_PROVIDERS
 * @param {string} intent.writeKind - adapter-specific write type (e.g. 'issue', 'comment')
 * @param {object} intent.payload - write payload passed to the adapter
 * @param {object} [intent.requestedBy] - actor identity of the recommending specialist
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validateWriteIntent(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object') {
    return { ok: false, errors: ['writeIntent must be an object'] };
  }
  if (!intent.providerId || typeof intent.providerId !== 'string') {
    errors.push('writeIntent.providerId is required');
  } else if (!KNOWN_PROVIDERS.includes(intent.providerId)) {
    errors.push(`writeIntent.providerId "${intent.providerId}" is not a known governed provider (${KNOWN_PROVIDERS.join(', ')})`);
  }
  if (!intent.writeKind || typeof intent.writeKind !== 'string') {
    errors.push('writeIntent.writeKind is required');
  }
  if (!intent.payload || typeof intent.payload !== 'object') {
    errors.push('writeIntent.payload is required and must be an object');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Build a normalized writeIntent record from a specialist's recommendation.
 * Throws on an invalid intent so a caller cannot silently enqueue a
 * malformed record — the run should see the failure at recommend time, not
 * discover it later when the control plane tries to execute it.
 *
 * @param {object} spec
 * @param {string} spec.providerId
 * @param {string} spec.writeKind
 * @param {object} spec.payload
 * @param {object} [spec.requestedBy] - { specialistId, role, serviceId, sessionId }
 * @param {string} [spec.surface] - origin surface, e.g. 'embed-capability' | 'mcp' | 'cli'
 * @returns {{ providerId: string, writeKind: string, payload: object, requestedBy: object, surface: string, tool: string }}
 */
export function buildWriteIntent(spec) {
  const intent = {
    providerId: spec?.providerId,
    writeKind: spec?.writeKind,
    payload: spec?.payload,
  };
  const result = validateWriteIntent(intent);
  if (!result.ok) {
    throw new Error(`buildWriteIntent: invalid writeIntent — ${result.errors.join('; ')}`);
  }
  return {
    providerId: intent.providerId,
    writeKind: intent.writeKind,
    payload: intent.payload,
    requestedBy: spec?.requestedBy ?? {},
    surface: spec?.surface ?? 'unknown',
    tool: writeIntentToolName(intent.providerId, intent.writeKind),
  };
}

/**
 * The tool-name encoding shared with lib/embed/capability-jobs.mjs's
 * ApprovalQueue.enqueue({ tool }) calls and lib/embed/authority-guard.mjs's
 * grant keys — "<providerId>.<writeKind>", e.g. "jira.issue". Kept in one
 * place so the control-plane drain and the enqueue side can never drift.
 *
 * @param {string} providerId
 * @param {string} writeKind
 * @returns {string}
 */
export function writeIntentToolName(providerId, writeKind) {
  return `${providerId}.${writeKind}`;
}

/**
 * Parse a "<providerId>.<writeKind>" tool name back into its parts. Returns
 * null when the name has no dot, which the caller should treat as
 * unresolvable rather than guessing.
 *
 * @param {string} tool
 * @returns {{ providerId: string, writeKind: string }|null}
 */
export function parseWriteIntentToolName(tool) {
  const idx = typeof tool === 'string' ? tool.indexOf('.') : -1;
  if (idx <= 0 || idx === tool.length - 1) return null;
  return { providerId: tool.slice(0, idx), writeKind: tool.slice(idx + 1) };
}
