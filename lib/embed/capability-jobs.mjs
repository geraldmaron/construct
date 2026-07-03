/**
 * lib/embed/capability-jobs.mjs — daemon-side registration of embed-capability
 * scheduled jobs (ADR-0061 §4, LMCP-P2).
 *
 * `registerEmbedCapabilityJobs` reads the enabled set and registers exactly
 * one Scheduler job per enabled capability — no more, no fewer, and never
 * for a capability that is merely available-but-not-enabled. Each job body
 * is a stub in this bead: it resolves the runtime selector and records a
 * `skipped-with-reason` tick, since invoking the specialist's reasoning is
 * LMCP-F5's job. The stub still proves the registration, runtime
 * resolution, and status recording chain end to end, and never fabricates
 * a proposal.
 */

import { loadEmbedCapabilities } from './capability-loader.mjs';
import { enabledCapabilityIds, writeCapabilityTick } from './capability-lifecycle.mjs';
import { resolveRuntime } from './capability-runtime.mjs';

/** Default cadence (ms) for a capability with no declared `embed.cadence.every`. */
const DEFAULT_CADENCE_MS = 15 * 60_000;

/**
 * Parse the ISO-8601 duration subset accepted by `embed.cadence.every`
 * (P and T with D/H/M components — the same grammar ADR-0060's
 * `updatedSince` predicate accepts). An unparsable value returns null,
 * falling back to DEFAULT_CADENCE_MS rather than throwing at daemon
 * startup over one malformed capability.
 */
export function parseCadenceMs(every) {
  if (typeof every !== 'string' || !every) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(every);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const ms = ((days * 24 + hours) * 60 + minutes) * 60_000;
  return ms > 0 ? ms : null;
}

/**
 * Stub tick body: resolves the runtime selector and records the outcome as
 * a durable last-tick record. When runtime resolves to `none`, the tick is
 * `skipped-with-reason(no-runtime)` — the honest skip ADR-0061 requires.
 * When a runtime is available, the tick is still `skipped-with-reason` with
 * reason `not-implemented`, since the actual reasoning call lands in F5 —
 * registration and status are in scope here, execution is not.
 */
export async function runCapabilityTick(manifest, { rootDir, env = process.env } = {}) {
  const embed = manifest.embed;
  const runtime = await resolveRuntime(embed.runtime, env);
  const tickedAt = new Date().toISOString();

  const tick = runtime.resolved === 'none'
    ? { status: 'skipped-with-reason', reason: runtime.reason, runtime: runtime.resolved, tickedAt }
    : { status: 'skipped-with-reason', reason: 'not-implemented', runtime: runtime.resolved, tickedAt };

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
 * @param {import('./scheduler.mjs').Scheduler} scheduler
 * @param {{ rootDir: string, env?: object }} opts
 * @returns {string[]} ids of capabilities actually registered
 */
export function registerEmbedCapabilityJobs(scheduler, { rootDir, env = process.env, packRoots, knownSpecialists } = {}) {
  const enabledIds = new Set(enabledCapabilityIds({ rootDir, packRoots, knownSpecialists }));
  if (enabledIds.size === 0) return [];

  const { capabilities, errors } = loadEmbedCapabilities({ rootDir, packRoots, knownSpecialists });
  for (const err of errors) {
    process.stderr.write(`[embed] capability load error: ${err}\n`);
  }

  const registered = [];
  for (const manifest of capabilities) {
    if (!enabledIds.has(manifest.id)) continue;

    const cadenceMs = parseCadenceMs(manifest.embed.cadence?.every) ?? DEFAULT_CADENCE_MS;
    scheduler.register(
      `embed-capability:${manifest.id}`,
      cadenceMs,
      async () => {
        const tick = await runCapabilityTick(manifest, { rootDir, env });
        process.stderr.write(`[embed] capability '${manifest.id}': ${tick.status}${tick.reason ? ` (${tick.reason})` : ''}\n`);
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
