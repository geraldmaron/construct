/**
 * lib/embed/capability-jobs.mjs — daemon-side registration of embed-capability
 * scheduled jobs.
 *
 * `registerEmbedCapabilityJobs` reads the enabled set and registers exactly
 * one Scheduler job per enabled capability — no more, no fewer, and never
 * for a capability that is merely available-but-not-enabled. Each job body
 * (`runCapabilityTick`) is the real F5 glue: it slices the specialist's
 * bound provider snapshot (E4 providerBindings + B11 filter enforcement)
 * out of the daemon's last snapshot, asks `workflow-invoke.mjs` for the
 * orchestration plan, and — only when a reasoning executor is actually
 * wired in (see below) — runs it, validates the resulting output packet
 * against the role's output contract (F2's `validateOutputPacket`), checks
 * every proposed external write against the specialist's E4 grant
 * (`AuthorityGuard`), and enqueues surviving proposals as durable
 * writeIntents in the approval queue. The daemon never calls a
 * provider write adapter itself — enqueue is the only path out of this
 * module; the J2 envelope executor is the sole drain.
 *
 * Reasoning-executor placement: `resolveRuntime` reports
 * whether an `in-process` or `external` runtime is *configured*.
 * `runCapabilityTick` accepts an optional
 * `reasoningExecutor(plan, sliceCtx) -> { outputPacket, writeProposals }`
 * so an engine can be wired in without changing this module again; absent
 * that injection, a resolved runtime with no executor records a visible
 * `skipped-with-reason(reasoning-executor-not-available)` tick — never a
 * fabricated completion. A `runtime: 'none'` resolution still short-circuits
 * to `skipped-with-reason(no-runtime)` before any of this even runs, exactly
 * as the pre-F5 stub did.
 *
 * lib/embed/reasoning-executor.mjs (construct-jvjow.2) is the first real
 * engine: opt-in and off by default, budget-gated through
 * lib/policy/unattended-budget.mjs. Its executor function can also return
 * `{ skippedReason }` — e.g. budget exhaustion — which this module turns
 * into the same honest `skipped-with-reason` shape rather than a fabricated
 * or contract-checked completion; the deterministic snapshot/plan work
 * above always finishes first and is never rolled back by a reasoning skip.
 *
 * Standing Assignment convergence: each enabled capability is
 * materialized as a durable `capability:<id>` Standing Assignment record
 * (lib/embed/standing-assignments.mjs) at registration time, and every
 * scheduled tick runs through `runAssignmentAttempt` so the assignment's
 * last-attempt state advances only after the tick actually executed —
 * never on registration or due-detection. `runCapabilityTick` itself is
 * unchanged: it remains the capability execution path the assignment's
 * `capability-tick` action invokes.
 */

import { loadEmbedCapabilities } from './capability-loader.mjs';
import { enabledCapabilityIds, writeCapabilityTick } from './capability-lifecycle.mjs';
import { resolveRuntime } from './capability-runtime.mjs';
import {
  attemptStatusFromTick,
  parseIntervalMs,
  readAssignmentState,
  runAssignmentAttempt,
  syncCapabilityAssignments,
} from './standing-assignments.mjs';
import { matchesFilter, validateFilterConfig } from '../providers/contract.mjs';
import { validateOutputPacket } from '../orchestration/worker.mjs';
import { invokeProcedure } from '../embedded-contract/procedure-invoke.mjs';
import { loadAllPacks } from '../packs/loader.mjs';
import { AuthorityGuard } from './authority-guard.mjs';
import {
  buildCapabilityTickGateInput,
  evaluateMeaningfulChangeGate,
  MEANINGFUL_CHANGE_SKIP_PREFIX,
} from '../assignments/meaningful-change-gate.mjs';

/** Default cadence (ms) for a capability with no declared `embed.cadence.every`. */
const DEFAULT_CADENCE_MS = 15 * 60_000;

/** Reserved reason recorded when a runtime resolves but no reasoning executor is wired in. */
export const SKIP_REASON_NO_EXECUTOR = 'reasoning-executor-not-available';

/** Generic linear workflow used to obtain a role-scoped plan for a capability's bound specialist. */
const CAPABILITY_WORKFLOW_TYPE = 'structure-notes';

const PACK_TIER_RANK = { project: 0, user: 1, builtin: 2, unknown: 3 };

/**
 * Parse the ISO-8601 duration subset accepted by `embed.cadence.every`
 * (P and T with D/H/M components — the same grammar the provider filter's
 * `updatedSince` predicate accepts). Delegates to the Standing Assignment
 * model's `parseIntervalMs` — the single trigger-cadence grammar per
 * An unparsable value returns null, falling back to
 * DEFAULT_CADENCE_MS rather than throwing at daemon startup over one
 * malformed capability.
 */
export function parseCadenceMs(every) {
  return parseIntervalMs(every);
}

/**
 * Strip a `cx-` prefix from a specialist id, mirroring the bare role ids
 * `workflow-invoke.mjs` (role-facts.mjs `roleMap`) and `AuthorityGuard`'s
 * embedBindings map key expect.
 */
function bareRoleId(workerProfileId) {
  return String(workerProfileId || '').replace(/^cx-/, '');
}

/**
 * Merge every loaded pack's `embedBindings` block into a single
 * workerProfileId → { providers[], proposals[] } map, project tier winning
 * over user winning over builtin — the same precedence
 * `lib/embedded-contract/workflow-invoke.mjs` applies to framework
 * resolution. Reuses `loadAllPacks` read-only; performs no validation of
 * its own (E4 validation already ran when the pack was loaded).
 */
export function mergedEmbedBindings({ rootDir, env = process.env } = {}) {
  const { packs } = loadAllPacks({ rootDir, env });
  const ordered = [...packs].sort((a, b) => (PACK_TIER_RANK[a._tier] ?? 3) - (PACK_TIER_RANK[b._tier] ?? 3));

  const merged = {};
  // Lowest precedence first so a higher-precedence tier's binding for the
  // same specialist overwrites rather than merges field-by-field — a
  // project override fully replaces a builtin grant for that specialist.
  for (const pack of [...ordered].reverse()) {
    for (const [workerProfileId, binding] of Object.entries(pack.embedBindings || {})) {
      merged[workerProfileId] = binding;
    }
  }
  return merged;
}

/**
 * Slice the capability's bound providers out of the daemon's last-generated
 * snapshot and re-apply the capability's own `embed.filter`
 * on top of whatever the poll-time source filter already admitted — a
 * capability's filter can be narrower than the source's, never wider,
 * since it runs after the source filter already ran. Returns `null`
 * sections are skipped entirely when the bound provider has no section in
 * the snapshot (not configured as a source, or the provider errored).
 *
 * @param {object|null} snapshot   the daemon's last SnapshotEngine.generate() result
 * @param {string[]} providerBindings
 * @param {object|null} filter embed.filter block or null
 * @returns {{ sections: Array<{provider:string, items:object[]}>, errors: string[] }}
 */
export function sliceBoundSnapshot(snapshot, providerBindings, filter) {
  const bound = new Set(providerBindings || []);
  const sections = [];
  const errors = [];

  for (const section of snapshot?.sections ?? []) {
    if (!bound.has(section.provider)) continue;

    let items = section.items ?? [];
    if (filter != null) {
      try {
        validateFilterConfig(section.provider, filter);
        items = items.filter((item) => matchesFilter(item, filter));
      } catch (err) {
        errors.push(`embed.filter invalid for bound provider '${section.provider}': ${err.message}`);
        items = [];
      }
    }
    sections.push({ provider: section.provider, items });
  }

  return { sections, errors };
}

/**
 * Any-key-autonomous authority profile: `AuthorityGuard.check()` runs its
 * E4 binding gate before consulting authority level at all. This module owns
 * writeIntent enqueueing itself (the actual durable record) rather than the
 * guard's own approval-queued branch, so every key resolves `autonomous`
 * here and a granted proposal short-circuits straight to `allowed:true`.
 */
const AUTONOMOUS_AUTHORITY = new Proxy({}, { get: () => 'autonomous' });

/**
 * Check a single proposed write against the specialist's E4 grant.
 * Returns `{ allowed: true }` or `{ allowed: false, reason }` — never
 * throws, so one denied proposal never aborts the rest of the batch.
 */
async function checkProposalAuthority(embedBindings, { workerProfileId, providerId, writeKind }) {
  const guard = new AuthorityGuard({ authority: AUTONOMOUS_AUTHORITY }, null, embedBindings);
  const result = await guard.check(`${providerId}.${writeKind}`, {
    proposal: { workerProfileId, providerId, writeKind },
  });
  return result.allowed
    ? { allowed: true }
    : { allowed: false, reason: result.reason || `proposal ${providerId}.${writeKind} denied` };
}

/**
 * Real tick body: resolves the runtime selector, and when a
 * runtime is available AND a reasoning executor is wired in, composes the
 * specialist's bound snapshot slice, asks workflow-invoke.mjs for the
 * orchestration plan, runs the executor, validates its output packet
 * against the role's output contract, checks every proposed write against
 * the E4 grant, and enqueues surviving proposals as writeIntents. Every
 * other path — no runtime, no executor, contract failure — records an
 * honest status and never a fabricated completion.
 *
 * @param {object} manifest                embed-capability manifest (capability-loader.mjs shape)
 * @param {object} [opts]
 * @param {string} opts.rootDir
 * @param {object} [opts.env]
 * @param {() => object|null} [opts.getSnapshot]        returns the daemon's last snapshot, or null
 * @param {import('./approval-queue.mjs').ApprovalQueue} [opts.approvalQueue]
 * @param {object} [opts.embedBindings]                  workerProfileId → {providers[],proposals[]}; built fresh from mergedEmbedBindings when omitted
 * @param {(plan: object, ctx: object) => Promise<{outputPacket?: object, writeProposals?: object[]}>} [opts.reasoningExecutor]
 * @param {object|null} [opts.assignmentState] prior attempt state for meaningful-change gate
 * @param {string|null} [opts.dedupKey] at-least-once dedup key for meaningful-change gate
 * @returns {Promise<object>} the recorded tick
 */
export async function runCapabilityTick(manifest, {
  rootDir,
  env = process.env,
  getSnapshot = () => null,
  approvalQueue = null,
  embedBindings = null,
  reasoningExecutor = null,
  assignmentState = null,
  dedupKey = null,
} = {}) {
  const embed = manifest.embed;
  const runtime = await resolveRuntime(embed.runtime, env);
  const tickedAt = new Date().toISOString();

  if (runtime.resolved === 'none') {
    const tick = { status: 'skipped-with-reason', reason: runtime.reason, runtime: runtime.resolved, tickedAt };
    writeCapabilityTick(manifest.id, tick, rootDir);
    return tick;
  }

  if (typeof reasoningExecutor !== 'function') {
    const tick = { status: 'skipped-with-reason', reason: SKIP_REASON_NO_EXECUTOR, runtime: runtime.resolved, tickedAt };
    writeCapabilityTick(manifest.id, tick, rootDir);
    return tick;
  }

  const workerProfileId = bareRoleId(embed.workerProfileId);
  const snapshot = getSnapshot();
  const { sections, errors: sliceErrors } = sliceBoundSnapshot(snapshot, embed.providerBindings, embed.filter ?? null);

  const gateInput = buildCapabilityTickGateInput({ sections, assignmentState, dedupKey });
  const gate = evaluateMeaningfulChangeGate(gateInput);
  if (!gate.proceed) {
    const tick = {
      status: 'skipped-with-reason',
      reason: `${MEANINGFUL_CHANGE_SKIP_PREFIX}:${gate.reason}`,
      runtime: runtime.resolved,
      tickedAt,
      meaningfulChangeGate: {
        skippedAtStage: gate.skippedAtStage,
        contentHash: gate.contentHash,
      },
    };
    writeCapabilityTick(manifest.id, tick, rootDir);
    return tick;
  }

  const plan = await invokeProcedure(
    {
      procedureId: CAPABILITY_WORKFLOW_TYPE,
      workerProfileStrategy: 'explicit',
      requestedWorkerProfiles: [workerProfileId],
      approvalMode: 'proposal-only',
      context: { snapshotSections: sections },
    },
    { env, cwd: rootDir },
  );

  if (plan.status === 'error') {
    const tick = {
      status: 'skipped-with-reason',
      reason: `plan-error: ${plan.errors?.[0]?.code || 'unknown'}`,
      runtime: runtime.resolved,
      tickedAt,
    };
    writeCapabilityTick(manifest.id, tick, rootDir);
    return tick;
  }

  const bindings = embedBindings ?? mergedEmbedBindings({ rootDir, env });

  const executorResult = await reasoningExecutor(plan, { manifest, sections, sliceErrors, workerProfileId });

  // A `skippedReason` (e.g. construct-jvjow.2's budget-exhausted gate) means
  // the executor deliberately declined to reason this tick — an honest
  // skip, not a fabricated or contract-checked completion. The deterministic
  // snapshot/plan work above already ran and is not undone; only the
  // reasoning step itself is skipped.

  if (executorResult?.skippedReason) {
    const tick = {
      status: 'skipped-with-reason',
      reason: executorResult.skippedReason,
      runtime: runtime.resolved,
      tickedAt,
    };
    writeCapabilityTick(manifest.id, tick, rootDir);
    return tick;
  }

  const outputPacket = executorResult?.outputPacket ?? null;
  const writeProposals = Array.isArray(executorResult?.writeProposals) ? executorResult.writeProposals : [];

  const outputCheck = validateOutputPacket(
    { role: workerProfileId, outputContractId: embed.outputContract, outputPacket },
    { cwd: rootDir },
  );

  if (outputCheck.checked && outputCheck.contractStatus === 'contract-failed') {
    const tick = {
      status: 'blocked',
      reason: 'output-contract-violation',
      contractId: outputCheck.contractId,
      violations: outputCheck.violations,
      runtime: runtime.resolved,
      tickedAt,
    };
    writeCapabilityTick(manifest.id, tick, rootDir);
    return tick;
  }

  const enqueued = [];
  const denied = [];

  for (const proposal of writeProposals) {
    const { providerId, writeKind, payload } = proposal || {};
    const authResult = await checkProposalAuthority(bindings, { workerProfileId, providerId, writeKind });

    if (!authResult.allowed) {
      denied.push({ providerId, writeKind, reason: authResult.reason });
      continue;
    }

    const record = approvalQueue?.enqueue({
      tool: `${providerId}.${writeKind}`,
      args: payload ?? {},
      surface: 'embed-capability',
      requestedBy: { serviceId: manifest.id, role: workerProfileId },
    });
    enqueued.push({ providerId, writeKind, approvalId: record?.approvalId ?? null });
  }

  const tick = {
    status: 'ran',
    runtime: runtime.resolved,
    contractStatus: outputCheck.contractStatus,
    proposalsEnqueued: enqueued,
    proposalsDenied: denied,
    tickedAt,
    meaningfulChangeGate: { contentHash: gate.contentHash },
  };
  writeCapabilityTick(manifest.id, tick, rootDir);
  return tick;
}

/**
 * Register exactly one Scheduler job per enabled embed capability.
 * Capabilities that are available but not enabled are never registered.
 * An invalid or missing manifest for a nominally-enabled id is skipped with
 * a stderr line rather than crashing daemon startup — the loader already
 * fails closed at `enable` time, so this path only defends against a
 * project manifest edited or corrupted after enable.
 *
 * Convergence: registration first syncs the enabled set onto
 * durable Standing Assignment records (retiring assignments for
 * no-longer-enabled capabilities), then wraps each scheduled tick in
 * `runAssignmentAttempt` so the assignment's `lastAttemptAt` advances
 * strictly after the tick executed. A tick body that throws is still an
 * execution attempt and is recorded as one (status `error`) instead of
 * escaping to the scheduler's catch-and-log.
 *
 * @param {import('./scheduler.mjs').Scheduler} scheduler
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {object} [opts.env]
 * @param {string[]} [opts.packRoots]
 * @param {string[]} [opts.knownWorkerProfiles]
 * @param {() => object|null} [opts.getSnapshot]
 * @param {import('./approval-queue.mjs').ApprovalQueue} [opts.approvalQueue]
 * @param {object} [opts.embedBindings]
 * @param {(plan: object, ctx: object) => Promise<object>} [opts.reasoningExecutor]
 * @returns {string[]} ids of capabilities actually registered
 */
export function registerEmbedCapabilityJobs(scheduler, {
  rootDir,
  env = process.env,
  packRoots,
  knownWorkerProfiles,
  getSnapshot,
  approvalQueue,
  embedBindings,
  reasoningExecutor,
} = {}) {
  const enabledIds = new Set(enabledCapabilityIds({ rootDir, packRoots, knownWorkerProfiles }));
  if (enabledIds.size === 0) return [];

  const { capabilities, errors } = loadEmbedCapabilities({ rootDir, packRoots, knownWorkerProfiles });
  for (const err of errors) {
    process.stderr.write(`[embed] capability load error: ${err}\n`);
  }

  const enabledManifests = capabilities.filter((manifest) => enabledIds.has(manifest.id));

  // Materialize the enabled set as durable Standing Assignment records before
  // any job registers — the assignment record is the canonical durable
  // identity for the scheduled work; the Scheduler entry is just its host.

  const sync = syncCapabilityAssignments({
    rootDir,
    capabilities: enabledManifests.map((manifest) => ({
      id: manifest.id,
      every: manifest.embed.cadence?.every ?? null,
    })),
  });
  for (const err of sync.errors) {
    process.stderr.write(`[embed] standing-assignment sync error: ${err}\n`);
  }
  for (const retiredId of sync.retired) {
    process.stderr.write(`[embed] standing assignment '${retiredId}' retired (capability no longer enabled)\n`);
  }

  if (enabledIds.size === 0) return [];

  const registered = [];
  for (const manifest of enabledManifests) {
    const assignment = sync.synced.find((a) => a.action?.capabilityId === manifest.id) ?? null;
    const cadenceMs = parseCadenceMs(manifest.embed.cadence?.every) ?? DEFAULT_CADENCE_MS;
    scheduler.register(
      `embed-capability:${manifest.id}`,
      cadenceMs,
      async () => {
        const runTick = async () => {
          const state = assignment ? readAssignmentState(assignment.id, { rootDir }) : null;
          const tick = await runCapabilityTick(manifest, {
            rootDir,
            env,
            getSnapshot,
            approvalQueue,
            embedBindings,
            reasoningExecutor,
            assignmentState: state,
            dedupKey: assignment ? `${assignment.id}:${Math.floor(Date.now() / 60_000)}` : null,
          });
          return {
            status: attemptStatusFromTick(tick.status),
            detail: tick.reason ?? null,
            tick,
            contentHash: tick.meaningfulChangeGate?.contentHash ?? null,
          };
        };

        // The attempt record advances only inside runAssignmentAttempt,
        // strictly after runCapabilityTick executed — a missing assignment
        // record (sync error) still ticks the capability, just without
        // attempt bookkeeping, and says so.

        let tick = null;
        let attemptStatus;
        let attemptDetail = null;
        if (assignment) {
          const attempt = await runAssignmentAttempt(assignment, runTick, { rootDir });
          tick = attempt.result?.tick ?? null;
          attemptStatus = attempt.status;
          attemptDetail = attempt.detail;
        } else {
          const result = await runTick();
          tick = result.tick;
          attemptStatus = result.status;
          attemptDetail = result.detail;
        }

        const status = tick?.status ?? attemptStatus;
        const reason = tick?.reason ?? attemptDetail;
        const detail = reason ? ` (${reason})` : '';
        process.stderr.write(`[embed] capability '${manifest.id}': ${status}${detail}\n`);
      },
      { runImmediately: true },
    );
    registered.push(manifest.id);
  }

  const missingIds = [...enabledIds].filter((id) => !registered.includes(id));
  for (const id of missingIds) {
    process.stderr.write(`[embed] capability '${id}' is enabled but its manifest failed to load — not registered\n`);
  }

  return registered;
}
