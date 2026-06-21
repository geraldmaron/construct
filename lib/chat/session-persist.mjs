/**
 * lib/chat/session-persist.mjs — JSONL transcript persistence for construct chat surfaces.
 *
 * Shared by CLI linear mode and dashboard owned-loop SSE so web/desktop resume
 * matches .cx/chat-sessions/ on disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { deserializeBlock, serializeBlock, snapshotTurn } from './tui/turn-block.mjs';
import { migrateEvidenceVerdict } from './evidence.mjs';

export function chatSessionFilePath({ cwd, convId, host = 'construct-web' }) {
  const dir = resolveProjectScopedPath('chat-sessions', { cwd });
  return path.join(dir, `${convId}-${host}.jsonl`);
}

export function createChatPersister({ cwd, sessionId, resumePath = null, host = 'construct' }) {
  try {
    const dir = resolveProjectScopedPath('chat-sessions', { cwd });
    fs.mkdirSync(dir, { recursive: true });
    const file = resumePath || path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${host}-${sessionId}.jsonl`);
    if (!resumePath) {
      fs.appendFileSync(file, `${JSON.stringify({ type: 'session_start', host, sessionId, ts: new Date().toISOString() })}\n`);
    }
    const append = (row) => {
      try {
        fs.appendFileSync(file, `${JSON.stringify({ ...row, ts: new Date().toISOString() })}\n`);
      } catch { /* log is best-effort */ }
    };
    return {
      filePath: file,
      event: (event) => append(event),
      transcript: (role, text) => append({ type: 'transcript', role, text }),
      transcriptBlock: (turn) => append(serializeBlock(turn)),
    };
  } catch {
    return null;
  }
}

export function loadPersistedTurns(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { turns: [], turnBlocks: [] };
  const turns = [];
  const turnBlocks = [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const block = deserializeBlock(row);
      if (!block) continue;
      turnBlocks.push({ kind: 'turn', block });
      const snap = snapshotTurn(block);
      const evidence = migrateEvidenceVerdict(snap);
      turns.push({
        id: snap.id || `turn-${turns.length + 1}`,
        userText: snap.userText || '',
        assistant: snap.assistant || '',
        thinking: snap.thinking || '',
        tools: snap.tools || [],
        overlay: snap.overlay || null,
        sources: snap.sources || [],
        usage: snap.usage || null,
        evidence,
        unverified: ['insufficient_evidence', 'uncited_evidence', 'partially_verified'].includes(evidence.status),
        working: false,
        system: false,
      });
    } catch { /* skip malformed rows */ }
  }
  return { turns, turnBlocks };
}
