/**
 * tests/functional/a1-session-reflect.functional.test.mjs — A1 end-to-end loop.
 *
 * Exercises the full session-reflect path the way a real Stop event would:
 * spawn the hook, write the observation, build the vector index, search via
 * the production observation-store, accumulate across two sessions. If any
 * piece of the loop fails, this catches it before CI.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const HOOK = path.join(REPO, 'lib', 'hooks', 'session-reflect.mjs');

function buildTranscript(turns) {
  return turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
}

test('A1 end-to-end: hook writes searchable observation, vector index built, accumulation works', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-functional-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  // Session 1: realistic multi-tool session
  const t1 = path.join(cwd, 'transcript-1.jsonl');
  fs.writeFileSync(t1, buildTranscript([
    { type: 'user', message: { content: 'Fix the OIDC publish failure in release.yml' } },
    { type: 'assistant', message: { content: [
      { type: 'text', text: 'Reading the workflow file.' },
      { type: 'tool_use', name: 'Read', input: { file_path: `${cwd}/.github/workflows/release.yml` } },
    ]}},
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: `${cwd}/.github/workflows/release.yml` } },
    ]}},
    { type: 'assistant', message: { content: [
      { type: 'text', text: 'Replaced npm whoami with OIDC endpoint check. Tests pass.' },
    ]}},
  ]));

  const r1 = spawnSync('node', [HOOK], {
    cwd,
    input: JSON.stringify({ cwd, transcript_path: t1, session_id: 'func-1', session_duration_ms: 8500 }),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(r1.status, 0, `hook failed: ${r1.stderr}`);

  // Loop must close on three artifacts: observation file, index entry, vector index.
  const obsDir = path.join(cwd, '.cx', 'observations');
  const indexPath = path.join(obsDir, 'index.json');
  const vectorsPath = path.join(obsDir, 'vectors.json');
  assert.ok(fs.existsSync(indexPath), 'observations index not written');
  assert.ok(fs.existsSync(vectorsPath), 'vector index not built — the await regression is back');

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.length, 1);
  const obs = JSON.parse(fs.readFileSync(path.join(obsDir, `${index[0].id}.json`), 'utf8'));
  assert.equal(obs.source, 'auto-reflect');
  assert.match(obs.content, /OIDC endpoint check/);

  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
  assert.equal(vectors.length, 1);
  assert.ok(Array.isArray(vectors[0].embedding) && vectors[0].embedding.length > 0);

  // Real production code path: search via the public store API.
  const { searchObservations, listObservations } = await import(`${REPO}/lib/observation-store.mjs`);
  const list = listObservations(cwd, { limit: 10 });
  assert.equal(list.length, 1);
  const search = await searchObservations(cwd, 'OIDC publish failure', { limit: 3 });
  assert.ok(search.length >= 1, 'search returned no results');

  // Session 2: confirms accumulation, newest-first ordering
  const t2 = path.join(cwd, 'transcript-2.jsonl');
  fs.writeFileSync(t2, buildTranscript([
    { type: 'user', message: { content: 'Write the homebrew bump fix' } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: `${cwd}/.github/workflows/release.yml` } },
      { type: 'text', text: 'Added git remote set-url with x-access-token. Done.' },
    ]}},
  ]));
  const r2 = spawnSync('node', [HOOK], {
    cwd,
    input: JSON.stringify({ cwd, transcript_path: t2, session_id: 'func-2', session_duration_ms: 3000 }),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(r2.status, 0);
  const index2 = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index2.length, 2);
  assert.match(index2[0].summary, /git remote set-url|homebrew/i);

  fs.rmSync(cwd, { recursive: true, force: true });
});

test('A1 opt-out: CONSTRUCT_REFLECT_AUTO=off produces zero artifacts', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-optout-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const t = path.join(cwd, 't.jsonl');
  fs.writeFileSync(t, buildTranscript([
    { type: 'user', message: { content: 'hello' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
  ]));
  const r = spawnSync('node', [HOOK], {
    cwd,
    input: JSON.stringify({ cwd, transcript_path: t }),
    env: { ...process.env, CONSTRUCT_REFLECT_AUTO: 'off' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'observations')), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});
