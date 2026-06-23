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
import { loadPersistedTurns } from '../../lib/chat/session-persist.mjs';

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

test('restoreFromSession reads transcript_block turn snapshots', () => {
  const { dir, sessions } = tmpProject();
  try {
    const file = path.join(sessions, 'snap.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'transcript_block',
      block: {
        kind: 'turn_snapshot',
        id: 'turn-1',
        userText: 'compare',
        overlay: { intent: 'research', specialists: ['cx-researcher'], externalResearch: { required: true } },
        assistant: 'answer',
        tools: [],
        sources: [],
        evidence: { status: 'uncited_evidence', records: [{ toolId: 'r1', tool: 'read', target: 'README.md', completion: 'completed', result: 'success' }], citations: [] },
        notices: [],
      },
    })}\n`);

    const restored = restoreFromSession(file);
    assert.equal(restored.turnBlocks.length, 1);
    assert.equal(restored.turnBlocks[0].block.userText, 'compare');
    assert.equal(restored.turnBlocks[0].block.overlay.intent, 'research');
    assert.equal(restored.turnBlocks[0].block.evidence.status, 'uncited_evidence');
    assert.equal(restored.turnBlocks[0].block.evidence.schemaVersion, 1);
    assert.ok(restored.turnBlocks[0].block.evidence.reasonCodes.includes('legacy_evidence_unversioned'));
    const client = loadPersistedTurns(file);
    assert.equal(client.turns[0].evidence.status, 'uncited_evidence');
    assert.equal(client.turns[0].unverified, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restoreFromSession migrates an old snapshot without evidence metadata', () => {
  const { dir, sessions } = tmpProject();
  const file = path.join(sessions, 'old.jsonl');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'transcript_block',
      block: {
        kind: 'turn_snapshot', id: 'old', userText: 'summarize',
        overlay: { assumptionsBlocked: true }, assistant: 'summary', tools: [], sources: [], notices: [],
      },
    })}\n`);
    const restored = restoreFromSession(file);
    assert.equal(restored.turnBlocks[0].block.evidence.status, 'insufficient_evidence');
    assert.ok(restored.turnBlocks[0].block.evidence.reasonCodes.includes('legacy_snapshot_without_evidence'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
