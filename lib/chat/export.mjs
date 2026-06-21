/**
 * lib/chat/export.mjs — plain markdown export for construct chat turns.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { summarizeSources } from './tui/turn-present.mjs';

function exportDir({ cwd }) {
  const base = resolveProjectScopedPath('chat-sessions', { cwd, ensureDir: true });
  const dir = path.join(base, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function turnToMarkdown(turn) {
  const lines = [`## you`, '', turn.userText || '', ''];
  const evidence = turn.evidence || null;
  if (evidence) lines.push(`evidence: ${evidence.status}${evidence.reasonCodes?.length ? ` (${evidence.reasonCodes.join(', ')})` : ''}`, '');
  const src = summarizeSources(evidence?.records?.map((record) => ({ tool: record.tool, ref: record.target })) || turn.sources || []);
  if (src.total) {
    lines.push(`sources: ${src.refs.join(', ')}`, '');
  }
  lines.push('## construct', '', turn.assistant || '(no answer)', '');
  return lines.join('\n');
}

export function exportTurns(turnBlocks, { scope = 'last', cwd = process.cwd() } = {}) {
  const turns = turnBlocks.filter((item) => item.kind === 'turn').map((item) => item.block);
  if (!turns.length) return { ok: false, error: 'no turns to export' };

  let selected = turns;
  if (scope === 'last') selected = [turns[turns.length - 1]];
  else if (scope === 'turn' && turns.length) selected = [turns[turns.length - 1]];

  const body = selected.map(turnToMarkdown).join('\n---\n\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(exportDir({ cwd }), `${stamp}-${scope}-answer.md`);
  fs.writeFileSync(file, `${body}\n`, 'utf8');
  return { ok: true, path: file, count: selected.length };
}
