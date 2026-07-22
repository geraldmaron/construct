/**
 * lib/intake/session-prelude.mjs — shared session-start surfaces.
 *
 * Builders that render the same status blocks the claude SessionStart
 * hook prints inline, so opencode and any other agent runtime can
 * surface the same content without re-implementing the intake-queue
 * read or the broker-mode resolution.
 *
 * Progressive disclosure: pending intake is informational, not a
 * day-1 blocker. Empty queues stay silent; when packets exist, copy
 * marks triage as optional so lean "just write code" sessions are not
 * taught full beads/graph/intake ceremony. Safety signals (broker
 * ApprovalRequired, oracle gaps) still surface when active.
 *
 * Pure functions: no fs writes, no stdout, no side effects. Callers
 * decide where the rendered markdown lands (inline injection for
 * claude, `client.app.log` for opencode).
 */
import { createIntakeQueue } from './queue.mjs';
import { formatTriageLine } from './classify.mjs';
import { isBrokered } from '../mcp/broker.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { getRebrand } from '../workspace-presets/rebrand.mjs';
import { homedir as osHomedir } from 'node:os';
import { readLastTick } from '../oracle/index.mjs';
import { listPending } from '../oracle/actions.mjs';
import { readLatestVerdict } from '../oracle/verdicts.mjs';
import { isVerdictOnlyGap } from '../oracle/policy.mjs';
import { formatAge } from '../oracle/heartbeat.mjs';
import { isCleanVerdict } from '../oracle/synthesize.mjs';

export function buildIntakePrelude({ cwd, env = process.env } = {}) {
  if (!cwd) return '';
  try {
    const queue = createIntakeQueue(cwd, env);
    const pending = queue.listPending();
    if (!pending.length) return '';
    const { intakeQueueLabel, signalNoun } = getRebrand(cwd);
    const recent = pending.slice(-3).map((p) => {
      const src = p.intake?.sourcePath || p.id;
      return `- ${formatTriageLine(src, p.triage)}`;
    });
    // Strip a trailing " queue" / " intake" so the heading reads
    // "## Pending R&D intake (N)" rather than the redundant
    // "## Pending R&D intake queue queue (N)".
    const heading = intakeQueueLabel.replace(/\s+queue$/i, '');
    return `\n## Pending ${heading} (${pending.length})\n${recent.join('\n')}\nOptional — not a coding blocker. When you want file-borne triage for a ${signalNoun}: \`construct intake show <id>\`, then \`construct intake done <id>\` when finished. Task graphs from intake (\`construct graph from-intake\`) are opt-in.\n`;
  } catch {
    return '';
  }
}

export function buildBrokerStatusLine({ env = process.env, cwd } = {}) {
  const active = isBrokered(env, { cwd });
  const mode = getDeploymentMode(env, { cwd });
  if (!active) {
    return `MCP broker: off · deployment mode: ${mode} (set CONSTRUCT_MCP_BROKER=on to engage in solo mode).`;
  }
  return `MCP broker: on · deployment mode: ${mode}. High-risk actions may return \`ApprovalRequired\` — surface the question to the user; never bypass.`;
}

export function buildSessionPrelude({ cwd, env = process.env } = {}) {
  const intake = buildIntakePrelude({ cwd, env });
  const broker = buildBrokerStatusLine({ env, cwd });
  const oracle = buildOraclePrelude({ cwd, env });
  if (!intake && !broker && !oracle) return '';
  const parts = [];
  if (intake) parts.push(intake.trim());
  if (oracle) parts.push(oracle.trim());
  if (broker) parts.push(broker);
  return parts.join('\n\n');
}

/**
 * lib/oracle/synthesize.mjs renders gap detail text against a 24h lookback
 * window ("in the last 24h"); a verdict older than that window describes a
 * period disjoint from the present, so the same threshold marks it stale.
 * Missing/unparseable `at` resolves to Infinity (stale, not fresh) rather
 * than defaulting to zero age.
 */
const VERDICT_STALE_MS = 24 * 60 * 60 * 1000;

function verdictFreshness(verdict, now = Date.now()) {
  const at = verdict?.at;
  const parsed = at ? Date.parse(at) : NaN;
  const ageMs = Number.isFinite(parsed) ? now - parsed : Infinity;
  return {
    ageMs,
    stale: !Number.isFinite(ageMs) || ageMs > VERDICT_STALE_MS,
    asOf: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
  };
}

/**
 * Oracle verdict + pending queue for session-start. The oracle background
 * daemon is retired — no process produces fresh ticks, so an old tick is the
 * designed state, never a "stalled producer" failure. Verdicts and pending
 * approvals come from one-shot `construct oracle review` runs.
 */
export function buildOraclePrelude({ cwd, env = process.env, homeDir } = {}) {
  if (!cwd) return '';
  if (env.CONSTRUCT_ORACLE === 'off' || env.CONSTRUCT_ORACLE === '0') return '';
  try {
    const home = homeDir ?? osHomedir();
    const last = readLastTick(home);
    const verdict = readLatestVerdict(cwd);
    const pending = listPending(cwd).filter((p) => p.status === 'pending');
    const v = verdict?.verdict ?? last?.verdict ?? 'unknown';
    if (isCleanVerdict(v) && pending.length === 0) return '';
    const source = verdict ?? last;
    const { ageMs, stale, asOf } = verdictFreshness(source);
    const verdictHead = v === 'unknown'
      ? `\n## Oracle overseer · verdict: **${v}**`
      : `\n## Oracle overseer · verdict: **${v}** (as of ${asOf ?? 'unknown'}, ${formatAge(ageMs)} ago)`;
    const lines = [verdictHead];
    if (v !== 'unknown' && stale) {
      lines.push(`- STALE: verdict is older than ${formatAge(VERDICT_STALE_MS)}; gap details below describe the verdict date, not now.`);
    }
    const gapSource = verdict?.gaps ?? last?.gaps ?? [];
    const top = gapSource.filter((g) => g.severity === 'high').slice(0, 3);
    for (const g of top) {
      if (isVerdictOnlyGap(g)) {
        const hint = g.id === 'beads-hygiene'
          ? 'run `construct beads drift`'
          : g.id === 'workflow-misaligned'
            ? 'run `construct init`'
            : 'see `construct oracle gaps`';
        lines.push(`- [${g.severity}] ${g.id} (verdict-only): ${g.detail} — ${hint}`);
      } else {
        lines.push(`- [${g.severity}] ${g.id}: ${g.detail}`);
      }
    }
    if (pending.length) {
      lines.push(`Pending approvals (${pending.length}): \`construct oracle pending\``);
    }
    lines.push('Review: `construct oracle review` · Gaps: `construct oracle gaps` · Approve: `construct oracle approve <id>`\n');
    return lines.join('\n');
  } catch {
    return '';
  }
}

export function readOracleDockState({ cwd, env = process.env, homeDir } = {}) {
  if (!cwd || env.CONSTRUCT_ORACLE === 'off' || env.CONSTRUCT_ORACLE === '0') {
    return { visible: false, verdict: null, pendingCount: 0, topGaps: [], summary: '', asOf: null, stale: false };
  }
  try {
    const home = homeDir ?? osHomedir();
    const last = readLastTick(home);
    const verdictDoc = readLatestVerdict(cwd);
    const pending = listPending(cwd).filter((p) => p.status === 'pending');
    const verdict = verdictDoc?.verdict ?? last?.verdict ?? 'unknown';
    const gapSource = verdictDoc?.gaps ?? last?.gaps ?? [];
    const topGaps = gapSource.filter((g) => g.severity === 'high').slice(0, 3);
    const visible = !isCleanVerdict(verdict) || pending.length > 0;
    const { stale, asOf } = verdictFreshness(verdictDoc ?? last);
    const parts = [`verdict ${verdict}`];
    if (pending.length) parts.push(`${pending.length} pending`);
    if (verdict !== 'unknown' && stale) parts.push('STALE');
    return {
      visible,
      verdict,
      pendingCount: pending.length,
      topGaps,
      summary: parts.join(' · '),
      asOf,
      stale: verdict !== 'unknown' && stale,
    };
  } catch {
    return { visible: false, verdict: null, pendingCount: 0, topGaps: [], summary: '', asOf: null, stale: false };
  }
}

export function formatOracleDockDetail(state) {
  if (!state?.visible) return 'Oracle: healthy — no pending approvals.';
  const lines = [`Oracle overseer · ${state.summary}`];
  if (state.stale) {
    lines.push(`  STALE: verdict as of ${state.asOf ?? 'unknown'}; gap details describe the verdict date, not now.`);
  }
  for (const g of state.topGaps || []) {
    if (isVerdictOnlyGap(g)) {
      lines.push(`  [${g.severity}] ${g.id} (verdict-only): ${g.detail}`);
    } else {
      lines.push(`  [${g.severity}] ${g.id}: ${g.detail}`);
    }
  }
  if (state.pendingCount > 0) {
    lines.push('  Pending: construct oracle pending');
  }
  lines.push('  Review: construct oracle review · Gaps: construct oracle gaps');
  return lines.join('\n');
}
