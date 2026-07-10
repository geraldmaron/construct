/**
 * tests/functional/a1-session-reflect.functional.test.mjs
 *
 * The hook writes observations through the machine-scoped state root
 * (ADR-0066), keyed by a hash of cwd — so CX_HOME_OVERRIDE is pinned for the
 * whole file (and threaded into the hook's spawn env) to keep that write off
 * the real developer machine's $HOME.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const HOOK = path.join(REPO, 'lib', 'hooks', 'session-reflect.mjs');

let homeOverride;
let prevHomeOverride;

before(() => {
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-a1-reflect-home-'));
  prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = homeOverride;
});

after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function buildTranscript(turns) {
  return turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
}

test('A1 end-to-end: hook writes searchable observation, accumulation works', async () => {
  // The hook writes embeddings with the hashing model; the search below runs
  // in this process and must embed the query with the same model, or the
  // vector dimensions mismatch and the search returns nothing.
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-functional-'));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });

  // listObservations/searchObservations below resolve the machine-scoped
  // state root (ADR-0066) via CX_HOME_OVERRIDE read in-process, not via any
  // rootDir option — pin it or they write into the real developer machine's
  // ~/.construct/projects.
  const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = cwd;

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
    timeout: 15_000,
    env: { ...process.env, CONSTRUCT_EMBEDDING_MODEL: 'hashing', CONSTRUCT_REFLECT_BUDGET_MS: '15000', HOME: cwd, CX_HOME_OVERRIDE: cwd }
  });
  assert.equal(r1.status, 0, `hook failed: ${r1.stderr}`);

  const obsDir = path.join(cwd, '.construct', 'observations');
  const indexPath = path.join(obsDir, 'index.json');
  assert.ok(fs.existsSync(indexPath), 'observations index not written');

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.length, 1);
  const obs = JSON.parse(fs.readFileSync(path.join(obsDir, `${index[0].id}.json`), 'utf8'));
  assert.equal(obs.source, 'auto-reflect');
  assert.match(obs.content, /OIDC endpoint check/);

  // Search via production API
  const { searchObservations, listObservations } = await import(`${REPO}/lib/observation-store.mjs`);
  const list = listObservations(cwd, { limit: 10 });
  assert.equal(list.length, 1);
  
  // The observation was committed to LanceDB by a separate process (the hook).
  // Under parallel test load a fresh reader in this process can briefly race
  // the writer's commit, so poll the search instead of asserting on one shot.
  let search = [];
  for (let attempt = 0; attempt < 20 && search.length === 0; attempt += 1) {
    search = await searchObservations(cwd, 'OIDC publish', { limit: 3, project: cwd.split('/').pop() });
    if (search.length === 0) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(search.length >= 1, `search returned no results | hook stderr: ${r1.stderr}`);

  // Session 2
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
    timeout: 15_000,
    env: { ...process.env, CONSTRUCT_EMBEDDING_MODEL: 'hashing', CONSTRUCT_REFLECT_BUDGET_MS: '15000', HOME: cwd, CX_HOME_OVERRIDE: cwd }
  });
  assert.equal(r2.status, 0);
  const index2 = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index2.length, 2);
  assert.match(index2[0].summary, /git remote set-url|homebrew/i);

  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;

  rmTmpDir(cwd);
});
