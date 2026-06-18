/**
 * lib/chat/session-restore.mjs — resume prior construct chat sessions from jsonl.
 *
 * Session timelines persist under .cx/chat-sessions/*.jsonl. Transcript rows use
 * { type: 'transcript', role, text }; usage events replay into the shared usage
 * accumulator so /usage and the transparency panel stay truthful after --resume.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { createSessionUsage, addUsage } from './tui/usage.mjs';

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

export function restoreFromSession(filePath) {
  const transcript = [];
  const usage = createSessionUsage();
  if (!filePath || !fs.existsSync(filePath)) {
    return { transcript, usage, sessionFile: null };
  }

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'transcript' && event.role && event.text) {
      transcript.push({ role: event.role, text: String(event.text) });
    } else if (event.type === 'usage') {
      addUsage(usage, event);
    }
  }

  return { transcript, usage, sessionFile: filePath };
}
