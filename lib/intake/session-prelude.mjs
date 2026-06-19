/**
 * lib/intake/session-prelude.mjs — shared session-start surfaces.
 *
 * Builders that render the same R&D-loop status blocks the claude
 * SessionStart hook prints inline, so opencode and any other agent
 * runtime can surface the same content without re-implementing the
 * intake-queue read or the broker-mode resolution.
 *
 * Pure functions: no fs writes, no stdout, no side effects. Callers
 * decide where the rendered markdown lands (inline injection for
 * claude, `client.app.log` for opencode).
 */
import { createIntakeQueue } from './queue.mjs';
import { formatTriageLine } from './classify.mjs';
import { isBrokered } from '../mcp/broker.mjs';
import { getRebrand } from '../profiles/rebrand.mjs';
import { homedir as osHomedir } from 'node:os';
import { readLastTick } from '../oracle/index.mjs';
import { listPending } from '../oracle/actions.mjs';
import { readLatestVerdict } from '../oracle/verdicts.mjs';

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
    return `\n## Pending ${heading} (${pending.length})\n${recent.join('\n')}\nEach packet at \`.cx/intake/pending/<id>.json\` carries the new ${signalNoun}, a triage block (intakeType, rdStage, primaryOwner, recommendedChain, recommendedAction, risk), related existing docs, and an excerpt. Process via the recommended chain, then close via \`construct intake done <id>\`.\n`;
  } catch {
    return '';
  }
}

export function buildBrokerStatusLine({ env = process.env } = {}) {
  const active = isBrokered(env);
  const mode = env?.CONSTRUCT_DEPLOYMENT_MODE || 'solo';
  if (!active) {
    return `MCP broker: off · deployment mode: ${mode} (set CONSTRUCT_MCP_BROKER=on to engage in solo mode).`;
  }
  return `MCP broker: on · deployment mode: ${mode}. High-risk actions may return \`ApprovalRequired\` — surface the question to the user; never bypass.`;
}

export function buildSessionPrelude({ cwd, env = process.env } = {}) {
  const intake = buildIntakePrelude({ cwd, env });
  const broker = buildBrokerStatusLine({ env });
  const oracle = buildOraclePrelude({ cwd, env });
  if (!intake && !broker && !oracle) return '';
  const parts = [];
  if (intake) parts.push(intake.trim());
  if (oracle) parts.push(oracle.trim());
  if (broker) parts.push(broker);
  return parts.join('\n\n');
}

/**
 * Oracle verdict + pending queue for session-start (mirror doctor warnings).
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
    if (v === 'healthy' && pending.length === 0) return '';
    const lines = [`\n## Oracle overseer · verdict: **${v}**`];
    const gapSource = verdict?.gaps ?? last?.gaps ?? [];
    const top = gapSource.filter((g) => g.severity === 'high').slice(0, 3);
    for (const g of top) lines.push(`- [${g.severity}] ${g.id}: ${g.detail}`);
    if (pending.length) {
      lines.push(`Pending approvals (${pending.length}): \`construct oracle pending\``);
    }
    lines.push('Review: `construct oracle review` · Approve: `construct oracle approve <id>`\n');
    return lines.join('\n');
  } catch {
    return '';
  }
}

export function readOracleDockState({ cwd, env = process.env, homeDir } = {}) {
  if (!cwd || env.CONSTRUCT_ORACLE === 'off' || env.CONSTRUCT_ORACLE === '0') {
    return { visible: false, verdict: null, pendingCount: 0, topGaps: [], summary: '' };
  }
  try {
    const home = homeDir ?? osHomedir();
    const last = readLastTick(home);
    const verdictDoc = readLatestVerdict(cwd);
    const pending = listPending(cwd).filter((p) => p.status === 'pending');
    const verdict = verdictDoc?.verdict ?? last?.verdict ?? 'unknown';
    const gapSource = verdictDoc?.gaps ?? last?.gaps ?? [];
    const topGaps = gapSource.filter((g) => g.severity === 'high').slice(0, 3);
    const visible = verdict !== 'healthy' || pending.length > 0;
    const parts = [`verdict ${verdict}`];
    if (pending.length) parts.push(`${pending.length} pending`);
    return {
      visible,
      verdict,
      pendingCount: pending.length,
      topGaps,
      summary: parts.join(' · '),
    };
  } catch {
    return { visible: false, verdict: null, pendingCount: 0, topGaps: [], summary: '' };
  }
}

export function formatOracleDockDetail(state) {
  if (!state?.visible) return 'Oracle: healthy — no pending approvals.';
  const lines = [`Oracle overseer · ${state.summary}`];
  for (const g of state.topGaps || []) {
    lines.push(`  [${g.severity}] ${g.id}: ${g.detail}`);
  }
  if (state.pendingCount > 0) {
    lines.push('  Pending: construct oracle pending');
  }
  lines.push('  Review: construct oracle review');
  return lines.join('\n');
}
