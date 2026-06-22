/**
 * lib/chat/export.mjs — plain markdown export for construct chat turns.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { summarizeSources } from './tui/turn-present.mjs';
import { rehydrateContinuation } from './context-continuation.mjs';
import { createContinuationResolver } from './continuation-source.mjs';

function exportDir({ cwd }) {
  const base = resolveProjectScopedPath('chat-sessions', { cwd, ensureDir: true });
  const dir = path.join(base, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Render a persisted continuation packet by rehydrating it through the one shared
// resolver (AC3): reconstructible layers re-derive via the same composer a live
// turn runs, elided layers report as summarized, and the budget accounting stays
// re-verifiable in the export.

function continuationToMarkdown(packet, { cwd }) {
  if (!packet || typeof packet !== 'object') return '';
  const resolver = createContinuationResolver({ cwd });
  const layers = rehydrateContinuation(packet, { resolveSource: resolver.resolveSource });
  const budget = packet.budget || {};
  const lines = ['### context continuation', '',
    `compacted to fit ~${budget.triggerTokens ?? 'n/a'} tokens — retained ${budget.retainedTokens ?? 0}, summarized ${budget.elidedTokens ?? 0}, referenced ${budget.referencedCount ?? 0}`];
  if (packet.blocker) {
    lines.push('', `blocker: ${packet.blocker.reason} (required ${packet.blocker.requiredTokens} > budget ${packet.blocker.budgetTokens})`);
  }
  const reconstructed = layers.filter((l) => l.sourceId || l.elided);
  if (reconstructed.length) {
    lines.push('', 'layers on rehydrate:');
    for (const layer of reconstructed) {
      if (layer.elided) lines.push(`- ${layer.kind}: summarized (elided)`);
      else lines.push(`- ${layer.kind}: ${layer.resolved ? `re-derived from ${layer.sourceId}` : `unresolved (${layer.sourceId})`}`);
    }
  }
  return lines.join('\n');
}

function turnToMarkdown(turn, { cwd = process.cwd() } = {}) {
  const lines = [`## you`, '', turn.userText || '', ''];
  const evidence = turn.evidence || null;
  if (evidence) lines.push(`evidence: ${evidence.status}${evidence.reasonCodes?.length ? ` (${evidence.reasonCodes.join(', ')})` : ''}`, '');
  const src = summarizeSources(evidence?.records?.map((record) => ({ tool: record.tool, ref: record.target })) || turn.sources || []);
  if (src.total) {
    lines.push(`sources: ${src.refs.join(', ')}`, '');
  }
  lines.push('## construct', '', turn.assistant || '(no answer)', '');
  if (turn.continuation) {
    const cont = continuationToMarkdown(turn.continuation, { cwd });
    if (cont) lines.push('', cont, '');
  }
  return lines.join('\n');
}

export function exportTurns(turnBlocks, { scope = 'last', cwd = process.cwd() } = {}) {
  const turns = turnBlocks.filter((item) => item.kind === 'turn').map((item) => item.block);
  if (!turns.length) return { ok: false, error: 'no turns to export' };

  let selected = turns;
  if (scope === 'last') selected = [turns[turns.length - 1]];
  else if (scope === 'turn' && turns.length) selected = [turns[turns.length - 1]];

  const body = selected.map((turn) => turnToMarkdown(turn, { cwd })).join('\n---\n\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(exportDir({ cwd }), `${stamp}-${scope}-answer.md`);
  fs.writeFileSync(file, `${body}\n`, 'utf8');
  return { ok: true, path: file, count: selected.length };
}
