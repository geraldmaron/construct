/**
 * lib/mcp/tools/provider-write.mjs — provider_write MCP tool (LMCP-I7).
 *
 * The only MCP-reachable path from a host agent (Claude Code, OpenCode) to an
 * external write. Classified destructive in lib/mcp/tool-safety.mjs, so
 * server.mjs's dispatch-time checkDestructiveGate() call already refuses the
 * execute path without a valid out-of-band approval_token before this module
 * ever runs — this file does not re-implement that check, it is downstream
 * of it.
 *
 * Two modes, selected by `dry_run` (default true):
 *   - dry_run=true: resolves the governed-write adapter for `provider` and
 *     asks it to render the payload it would submit (adapter.renderDryRun),
 *     which runs field/shape validation only. Never calls
 *     lib/writes/envelope.mjs and never reaches adapter.write() — no network
 *     call, no side effect, regardless of token presence.
 *   - dry_run=false (execute): the destructive gate has already run in
 *     server.mjs by the time dispatchToolByName reaches this module, so
 *     arriving here at all means a token was consumed. Dispatches through
 *     writeWithEnvelope() (LMCP-J2) — idempotency key, sent-log dedup,
 *     policy/approval gate, retry, audit — which is the only caller of
 *     adapter.write(). This module never calls adapter.write() directly.
 *
 * E4 respect: when args.specialist_id is present (an embedded-specialist
 * caller), the proposed provider+writeKind is checked against that
 * specialist's embedBindings grant via AuthorityGuard before either mode
 * proceeds. A specialist outside its grant is denied here, before the
 * adapter is even resolved — independent of and in addition to the
 * destructive-gate token check server.mjs already performed.
 */

import { writeWithEnvelope } from '../../writes/envelope.mjs';
import { WriteSentLog } from '../../writes/sent-log.mjs';
import { AuthorityGuard } from '../../embed/authority-guard.mjs';
import { mergedEmbedBindings } from '../../embed/capability-jobs.mjs';
import { resolveGovernedAdapter } from '../../providers/contract/adapter-factories.mjs';

/**
 * Resolve the governed-write adapter for a provider name. Isolated as its
 * own function so tests can override resolution via the `deps.resolveAdapter`
 * injection point without touching the shared adapter-factories wiring.
 *
 * @param {string} provider
 * @returns {{ meta: object, write: Function, search?: Function, renderDryRun?: Function }}
 */
function resolveAdapter(provider) {
  try {
    return resolveGovernedAdapter(provider);
  } catch (err) {
    throw new Error(err.message.replace('resolveGovernedAdapter:', 'provider_write:'));
  }
}

/**
 * Check an embedded-specialist caller's proposal against its embedBindings
 * grant. Returns null (no opinion) when args carries no specialist_id, so
 * non-embed callers are unaffected — additive enforcement layered in front
 * of the destructive gate, mirroring lib/embed/capability-jobs.mjs's
 * checkProposalAuthority for the daemon path.
 *
 * @param {object} args
 * @param {{ rootDir?: string, env?: object, embedBindings?: object }} opts
 * @returns {Promise<{ allowed: boolean, reason?: string }|null>}
 */
async function checkE4Binding(args, { rootDir, env = process.env, embedBindings } = {}) {
  if (!args.specialist_id) return null;

  const bindings = embedBindings ?? mergedEmbedBindings({ rootDir, env });
  const guard = new AuthorityGuard({ authority: {} }, null, bindings);
  const result = await guard.check('externalPost', {
    proposal: {
      specialistId: args.specialist_id,
      providerId: args.provider,
      writeKind: args.item?.type,
    },
  });

  // Only a binding-scoped denial (mode: 'denied' with no queueId) short-circuits
  // provider_write; a queued/autonomous authority-level outcome is not this
  // tool's concern — the destructive gate + J2 envelope already own approval.
  if (result.mode === 'denied' && !result.allowed) {
    return { allowed: false, reason: result.reason };
  }
  return null;
}

/**
 * provider_write tool implementation.
 *
 * @param {object} args
 * @param {string} args.provider - 'atlassian-jira' | 'atlassian-confluence' | 'github'
 * @param {object} args.item - write payload, shape depends on provider (see governed-write.mjs per adapter)
 * @param {boolean} [args.dry_run=true] - render-only when true; never touches adapter.write()
 * @param {string} [args.specialist_id] - embedded-specialist caller id (LMCP-E4 binding check)
 * @param {string} [args.idempotency_key] - explicit idempotency key forwarded to the J2 envelope
 * @param {object} [deps] - injection points for tests
 * @param {Function} [deps.resolveAdapter] - override adapter resolution
 * @param {WriteSentLog} [deps.sentLog] - override sent-log instance
 * @param {object} [deps.embedBindings] - override merged embedBindings map
 * @param {string} [deps.rootDir]
 * @param {object} [deps.env]
 * @returns {Promise<object>}
 */
export async function providerWrite(args = {}, deps = {}) {
  const provider = args.provider;
  const item = args.item;
  const dryRun = args.dry_run !== false;

  if (!provider) return { error: 'provider_write: args.provider is required' };
  if (!item || typeof item !== 'object') return { error: 'provider_write: args.item is required' };

  const bindingDenial = await checkE4Binding(args, {
    rootDir: deps.rootDir,
    env: deps.env,
    embedBindings: deps.embedBindings,
  });
  if (bindingDenial) {
    return { status: 'denied', provider, dryRun, reason: bindingDenial.reason };
  }

  const resolve = deps.resolveAdapter ?? resolveAdapter;
  let adapter;
  try {
    adapter = resolve(provider);
  } catch (err) {
    return { error: err.message ?? String(err) };
  }

  if (dryRun) {
    if (typeof adapter.renderDryRun !== 'function') {
      return {
        status: 'dry-run',
        provider,
        dryRun: true,
        diff: null,
        note: `provider "${provider}" adapter has no renderDryRun; payload echoed verbatim, no validation performed.`,
        payload: item,
      };
    }
    try {
      const diff = adapter.renderDryRun(item);
      return { status: 'dry-run', provider, dryRun: true, diff };
    } catch (err) {
      return { status: 'dry-run-invalid', provider, dryRun: true, error: err.message ?? String(err) };
    }
  }

  const sentLog = deps.sentLog ?? new WriteSentLog({ persistPath: WriteSentLog.resolvePersistPath(deps.rootDir ?? process.cwd()) });

  const envelopeResult = await writeWithEnvelope({
    provider: adapter,
    config: {},
    payload: item,
    dryRun: false,
    sentLog,
    idempotencyKey: args.idempotency_key,
    requestedBy: args.specialist_id ? { role: `cx-${args.specialist_id}` } : {},
  });

  return {
    status: envelopeResult.status,
    provider,
    dryRun: false,
    envelope: envelopeResult.envelope,
  };
}

export default providerWrite;
