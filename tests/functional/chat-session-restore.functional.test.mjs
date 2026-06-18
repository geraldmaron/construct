/**
 * tests/functional/chat-session-restore.functional.test.mjs — session resume for chat.
 *
 * Verifies transcript and usage rows round-trip from a jsonl session file through
 * lib/chat/session-restore.mjs without a live chat process or network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restoreFromSession, listSessionFiles, resolveResumePath } from '../../lib/chat/session-restore.mjs';

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-chat-resume-'));
  const sessions = path.join(dir, '.cx', 'chat-sessions');
  fs.mkdirSync(sessions, { recursive: true });
  return { dir, sessions };
}

test('restoreFromSession rebuilds transcript and usage from jsonl rows', () => {
  const { dir, sessions } = tmpProject();
  try {
    const file = path.join(sessions, '2026-01-01T00-00-00-construct-abc.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'session_start', host: 'construct' }),
      JSON.stringify({ type: 'transcript', role: 'you', text: 'hello' }),
      JSON.stringify({ type: 'transcript', role: 'construct', text: 'hi there' }),
      JSON.stringify({ type: 'usage', tokens: { input: 10, output: 5, total: 15 } }),
    ].join('\n') + '\n');

    const restored = restoreFromSession(file);
    assert.equal(restored.transcript.length, 2);
    assert.equal(restored.transcript[0].text, 'hello');
    assert.equal(restored.usage.tokens.total, 15);
    assert.equal(restored.usage.turns, 1);

    const latest = resolveResumePath({ cwd: dir, resume: true });
    assert.equal(latest, file);
    assert.equal(listSessionFiles({ cwd: dir }).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
