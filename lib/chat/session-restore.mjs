/**
 * lib/chat/session-restore.mjs — resume prior construct chat sessions from jsonl.
 *
 * Session timelines persist under .cx/chat-sessions/*.jsonl. Transcript rows use
 * { type: 'transcript_block', block } for turn fidelity or legacy { type:
 * 'transcript', role, text }; usage events replay into the shared usage
 * accumulator so /usage and the session dock stay truthful after --resume.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { createSessionUsage, addUsage } from './tui/usage.mjs';
import { restoreBlocksFromSessionLines, turnBlocksToLegacyTranscript } from './tui/turn-block.mjs';
import { rehydrateContinuation } from './context-continuation.mjs';
import { createContinuationResolver } from './continuation-source.mjs';

export function sessionDir({ cwd = process.cwd() } = {}) {
  return resolveProjectScopedPath('chat-sessions', { cwd, ensureDir: false });
}

export function listSessionFiles({ cwd = process.cwd() } = {}) {
  const dir = sessionDir({ cwd });
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

export function resolveResumePath({ cwd = process.cwd(), resume = null } = {}) {
  if (resume == null || resume === false) return null;
  if (typeof resume === 'string' && resume !== 'true' && resume !== '') {
    const direct = path.resolve(resume);
    return fs.existsSync(direct) ? direct : null;
  }
  return listSessionFiles({ cwd })[0] || null;
}

export function restoreFromSession(filePath, { cwd = process.cwd() } = {}) {
  const turnBlocks = [];
  const usage = createSessionUsage();
  if (!filePath || !fs.existsSync(filePath)) {
    return { turnBlocks, transcript: [], usage, sessionFile: null, continuations: [] };
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'usage') addUsage(usage, event);
  }

  const blocks = restoreBlocksFromSessionLines(lines);
  for (const item of blocks) {
    if (item.kind === 'turn' || item.kind === 'legacy') turnBlocks.push(item);
  }

  // Resume rehydrates any persisted continuation packet through the one shared
  // resolver (AC3), so a resumed session reconstructs the same reconstructible
  // layers — via the same composer — that the live and export surfaces use.
  const resolver = createContinuationResolver({ cwd });
  const continuations = [];
  for (const item of turnBlocks) {
    const packet = item?.block?.continuation;
    if (packet) continuations.push({ packet, layers: rehydrateContinuation(packet, { resolveSource: resolver.resolveSource }) });
  }

  const transcript = turnBlocksToLegacyTranscript(turnBlocks);
  return { turnBlocks, transcript, usage, sessionFile: filePath, continuations };
}
