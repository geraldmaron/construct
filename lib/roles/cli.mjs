/**
 * lib/roles/cli.mjs — `construct role <subcommand>` handler.
 *
 * Subcommands:
 *   list                — show pending role invocations
 *   latest              — show the most recent unresolved invocation (full brief)
 *   show <fingerprint>  — show one invocation by fingerprint
 *   status              — show onboarded personas + their event types
 *   resolve <fp>        — mark one invocation resolved
 *   prune               — compact the queue: drop resolved + TTL-expired entries
 *   reset               — clear the pending queue (manual recovery)
 */

import { listOnboardedPersonas, loadManifest } from './manifest.mjs';
import { listPending, markResolved, resetPending, prunePending } from './gateway.mjs';
import { recent as recentEvents } from './event-bus.mjs';

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function brief(entry, manifest) {
  const fence = manifest?.fence || {};
  const lines = [
    `# Role invocation — ${entry.workerProfileId}`,
    `bd issue:   ${entry.bdIssueId || '(none)'}`,
    `event:      ${entry.eventType}`,
    `fingerprint: ${entry.fingerprint}`,
    `queued at:  ${fmtTime(entry.ts)}`,
    `summary:    ${entry.summary}`,
    ``,
    `## Fence`,
    `allowedPaths:    ${(fence.allowedPaths || []).join(', ') || '(none)'}`,
    `allowedLabels:   ${(fence.allowedBdLabels || []).join(', ') || '(none)'}`,
    `allowedCommands: ${(fence.allowedCommands || []).join(', ') || '(none)'}`,
    `approvalReq'd:   ${(fence.approvalRequired || []).join(', ') || '(none)'}`,
    ``,
    `## Handoff candidates`,
    (manifest?.handoffCandidates || []).map((h) => `- cx-${h}`).join('\n') || '(none)',
    ``,
    `## To dispatch`,
    `Run via existing Task path. Tell Construct:`,
    `> Dispatch ${entry.workerProfileId} for incident ${entry.bdIssueId} (fingerprint ${entry.fingerprint}).`,
    `> Persona must stay inside fence above. Use \`next:cx-<role>\` bd label for handoff.`,
  ];
  return lines.join('\n');
}

export async function runCli(args) {
  const sub = args[0] || 'list';

  if (sub === 'list') {
    const pending = listPending({ unresolved: true });
    if (pending.length === 0) {
      console.log('No pending role invocations.');
      return 0;
    }
    console.log(`Pending role invocations: ${pending.length}`);
    for (const p of pending) {
      console.log(`  ${fmtTime(p.ts)}  ${p.workerProfileId.padEnd(20)}  ${(p.bdIssueId || '-').padEnd(14)}  ${p.eventType.padEnd(28)}  ${p.summary}`);
    }
    return 0;
  }

  if (sub === 'latest') {
    const pending = listPending({ unresolved: true });
    if (pending.length === 0) {
      console.log('No pending role invocations.');
      return 0;
    }
    const entry = pending[pending.length - 1];
    const manifest = loadManifest(entry.personaId);
    console.log(brief(entry, manifest));
    return 0;
  }

  if (sub === 'show') {
    const fp = args[1];
    if (!fp) { console.error('Usage: construct role show <fingerprint>'); return 2; }
    const pending = listPending({ unresolved: false });
    const entry = pending.find((p) => p.fingerprint === fp || p.bdIssueId === fp);
    if (!entry) { console.error(`No invocation found for ${fp}`); return 1; }
    const manifest = loadManifest(entry.personaId);
    console.log(brief(entry, manifest));
    console.log('\n## Recent matching events');
    for (const e of recentEvents({ fingerprint: entry.fingerprint, limit: 5 })) {
      console.log(`  ${fmtTime(e.ts)}  ${e.type}  ${e.summary?.split('\n')[0] || ''}`);
    }
    return 0;
  }

  if (sub === 'status') {
    const onboarded = listOnboardedPersonas();
    console.log(`Onboarded personas: ${onboarded.length}`);
    for (const id of onboarded) {
      const m = loadManifest(id);
      console.log(`  cx-${id.padEnd(20)} events: ${(m.events || []).join(', ')}`);
    }
    return 0;
  }

  if (sub === 'resolve') {
    const fp = args[1];
    if (!fp) { console.error('Usage: construct role resolve <fingerprint>'); return 2; }
    const ok = markResolved(fp);
    console.log(ok ? `Resolved ${fp}` : `No matching pending entry for ${fp}`);
    return ok ? 0 : 1;
  }

  if (sub === 'prune') {
    const { removed, resolved, expired, fixtures, kept } = prunePending();
    console.log(`Pruned ${removed} entr${removed === 1 ? 'y' : 'ies'} (${resolved} resolved, ${expired} expired, ${fixtures} fixture) · ${kept} remaining.`);
    return 0;
  }

  if (sub === 'reset') {
    resetPending();
    console.log('Pending queue cleared.');
    return 0;
  }

  console.error(`Unknown role subcommand: ${sub}`);
  console.error('Usage: construct role [list|latest|show <fp>|status|resolve <fp>|prune|reset]');
  return 2;
}
