/**
 * tests/hooks/session-reflect.test.mjs — Stop hook + extractor integration tests.
 *
 * Verifies four contracts of A1:
 *   1. Extractor produces a session-summary observation from a synthetic transcript
 *   2. Hook exits 0 within the 500ms budget on a real-shaped Stop payload
 *   3. Hook writes one observation file under .cx/observations/ when given valid input
 *   4. Hook is a no-op when CONSTRUCT_REFLECT_AUTO=off
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { extractSessionObservation } from '../../lib/reflect/extractor.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'lib', 'hooks', 'session-reflect.mjs');

// Synthetic transcript matching Claude Code's JSONL shape: { type, message: { content: [...] } }
const SAMPLE_TRANSCRIPT = [
  { type: 'user', message: { content: 'Please run the tests and tell me what fails.' } },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Running tests now.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ],
    },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/repo/lib/foo.mjs' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/repo/lib/foo.mjs' } },
      ],
    },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'All tests pass. The bug was in the regex.\n\nFixed by escaping the dot.' },
      ],
    },
  },
];

test('extractor produces a session-summary observation from a synthetic transcript', () => {
  const obs = extractSessionObservation({
    entries: SAMPLE_TRANSCRIPT,
    cwd: '/tmp/repo',
    sessionId: 'sess-test-1',
    durationMs: 12_345,
  });

  assert.ok(obs, 'extractor returned null for valid transcript');
  assert.equal(obs.category, 'session-summary');
  assert.equal(obs.source, 'auto-reflect');
  assert.match(obs.summary, /\[session\]/);
  assert.ok(obs.tags.includes('auto-reflect'));
  assert.ok(obs.tags.includes('session-summary'));
  assert.match(obs.content, /3 assistant turns/);
  assert.match(obs.content, /Bash×1/);
  assert.match(obs.content, /Read×1/);
  assert.equal(obs.extras.toolCallCount, 3);
  assert.equal(obs.extras.assistantTurns, 3);
  assert.equal(obs.extras.sessionId, 'sess-test-1');
});

test('extractor returns null for empty transcript', () => {
  assert.equal(extractSessionObservation({ entries: [], cwd: '/tmp/repo' }), null);
  assert.equal(extractSessionObservation({ entries: null, cwd: '/tmp/repo' }), null);
});

test('extractor caps content at 5KB', () => {
  const huge = Array.from({ length: 200 }, (_, i) => ({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'x'.repeat(500) + ` turn ${i}` }] },
  }));
  const obs = extractSessionObservation({ entries: huge, cwd: '/tmp/repo' });
  assert.ok(obs.content.length <= 5 * 1024);
});

test('hook exits 0 within budget on valid Stop payload and writes an observation', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-reflect-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const transcriptPath = path.join(cwd, 'transcript.jsonl');
  fs.writeFileSync(
    transcriptPath,
    SAMPLE_TRANSCRIPT.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  const t0 = Date.now();
  const result = spawnSync('node', [HOOK_PATH], {
    cwd,
    input: JSON.stringify({
      cwd,
      transcript_path: transcriptPath,
      session_id: 'sess-integration-1',
      session_duration_ms: 5000,
    }),
    encoding: 'utf8',
    timeout: 10_000,
  });
  const elapsed = Date.now() - t0;

  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  // Process-spawn overhead inflates the wall-clock; assert generously, the
  // hook's internal hard budget is 500ms enforced at runtime.
  assert.ok(elapsed < 5_000, `hook took ${elapsed}ms`);

  const obsDir = path.join(cwd, '.cx', 'observations');
  const indexPath = path.join(obsDir, 'index.json');
  const vectorsPath = path.join(obsDir, 'vectors.json');
  assert.ok(fs.existsSync(indexPath), 'observations index was not written');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.ok(Array.isArray(index) && index.length >= 1);
  const entry = index[0];
  assert.equal(entry.category, 'session-summary');
  assert.equal(entry.project, path.basename(cwd), 'project should be derived from cwd');

  const obsFile = path.join(obsDir, `${entry.id}.json`);
  const obs = JSON.parse(fs.readFileSync(obsFile, 'utf8'));
  assert.equal(obs.source, 'auto-reflect');
  assert.match(obs.content, /3 assistant turns/);
  assert.ok(obs.tags.includes('session:sess-integration-1'), 'session id should be in tags');

  // Regression guard: addObservation is async; if the hook fails to await it,
  // process.exit kills the vector-index write and semantic search degrades to
  // BM25 only. Confirm the local vector index was built.
  assert.ok(fs.existsSync(vectorsPath), 'vectors.json missing — hook did not await addObservation');
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
  assert.equal(vectors.length, 1);
  assert.ok(Array.isArray(vectors[0].embedding) && vectors[0].embedding.length > 0,
    'embedding missing from vector entry');
});

test('hook skips trivial sessions with no tool calls and short final text', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-reflect-trivial-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const transcriptPath = path.join(cwd, 'transcript.jsonl');
  const trivial = [
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
  ];
  fs.writeFileSync(transcriptPath, trivial.map((e) => JSON.stringify(e)).join('\n'));

  const result = spawnSync('node', [HOOK_PATH], {
    cwd,
    input: JSON.stringify({ cwd, transcript_path: transcriptPath }),
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.status, 0);
  const indexPath = path.join(cwd, '.cx', 'observations', 'index.json');
  assert.equal(fs.existsSync(indexPath), false, 'trivial session should not be recorded');
});

test('hook is a no-op when CONSTRUCT_REFLECT_AUTO=off', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-reflect-off-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const transcriptPath = path.join(cwd, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify(SAMPLE_TRANSCRIPT[0]) + '\n');

  const result = spawnSync('node', [HOOK_PATH], {
    cwd,
    input: JSON.stringify({ cwd, transcript_path: transcriptPath }),
    env: { ...process.env, CONSTRUCT_REFLECT_AUTO: 'off' },
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.status, 0);
  const obsDir = path.join(cwd, '.cx', 'observations');
  assert.equal(fs.existsSync(obsDir), false, 'opt-out should not create observations dir');
});

test('hook skips when cwd is not a Construct project', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'not-construct-'));
  const transcriptPath = path.join(cwd, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify(SAMPLE_TRANSCRIPT[0]) + '\n');

  const result = spawnSync('node', [HOOK_PATH], {
    cwd,
    input: JSON.stringify({ cwd, transcript_path: transcriptPath }),
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(cwd, '.cx')), false);
});
