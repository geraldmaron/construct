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
  if (!intake && !broker) return '';
  const parts = [];
  if (intake) parts.push(intake.trim());
  if (broker) parts.push(broker);
  return parts.join('\n\n');
}
