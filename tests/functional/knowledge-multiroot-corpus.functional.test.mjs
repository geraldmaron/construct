/**
 * tests/functional/knowledge-multiroot-corpus.functional.test.mjs —
 * multi-root knowledge corpus with chunk-level provenance (bead construct-760c.2).
 *
 * @capability research.multi-project-search
 *
 * Exercises the real `bin/construct` binary in a mkdtemp project (pattern:
 * source-target-directory.functional.test.mjs) that registers TWO directory
 * source targets, each holding a distinct marker doc:
 *
 *   AC1  `knowledge search` over both roots returns chunks from each, attributed
 *        to the right target (origin.targetId / origin.projectKey / relPath).
 *   AC2  `--projects=<one>` excludes the other target's chunk.
 *   R3   an unknown `--projects` id exits non-zero with an actionable message,
 *        never a silent empty result.
 *   AC4  `ingest --as=<targetId>` stamps origin provenance; `ingest` without
 *        `--as` is unchanged.
 *
 * A fetch-spy preload asserts the whole multi-root path stays local — directory
 * corpora never touch the network.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

const PRELOAD = path.join(os.tmpdir(), `cx-multiroot-fetch-spy-${process.pid}.mjs`);
fs.writeFileSync(PRELOAD, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url) => {
  try { appendFileSync(process.env.FETCH_SPY_OUT, String(url) + '\\n'); } catch {}
  return { status: 200, ok: true, json: async () => ({}), text: async () => '' };
};
`);
test.after(() => { try { fs.rmSync(PRELOAD, { force: true }); } catch {} });

function runCx(cwd, args, extraEnv = {}) {
  const spyOut = path.join(cwd, `fetch-calls-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(spyOut, '');
  const res = spawnSync(process.execPath, ['--import', PRELOAD, BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      FETCH_SPY_OUT: spyOut,
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      GITHUB_REPOS: '',
      ...extraEnv,
    },
  });
  const calls = fs.readFileSync(spyOut, 'utf8').split('\n').filter(Boolean);
  return { ...res, calls };
}

// A project cwd with two sibling directory corpora, each carrying one uniquely
// named marker doc so a hit unambiguously identifies its source target.
function twoRootProject() {
  const cwd = freshDir('cx-multiroot-proj-');
  const appDocs = path.join(cwd, 'app-docs');
  const sdkDocs = path.join(cwd, 'sdk-docs');
  fs.mkdirSync(appDocs, { recursive: true });
  fs.mkdirSync(path.join(sdkDocs, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(appDocs, 'auth.md'), '# Auth strategy\n\nThe app uses zephyrmarkerapp session tokens for auth.\n');
  fs.writeFileSync(path.join(sdkDocs, 'nested', 'auth.md'), '# Auth strategy\n\nThe sdk uses quboltmarkersdk API keys for auth.\n');
  runCx(cwd, ['sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: appDocs })]);
  runCx(cwd, ['sources', 'add', 'directory', 'proj-sdk', JSON.stringify({ path: sdkDocs })]);
  return { cwd, appDocs, sdkDocs };
}

test('AC1: knowledge search over two directory targets returns attributed chunks from both', () => {
  const { cwd } = twoRootProject();
  const res = runCx(cwd, ['knowledge', 'search', 'auth strategy', '--top=20']);
  assert.equal(res.status, 0, `search failed: ${res.stderr}`);
  assert.match(res.stdout, /zephyrmarkerapp|«proj-app»/, `app corpus missing from output:\n${res.stdout}`);
  assert.match(res.stdout, /quboltmarkersdk|«proj-sdk»/, `sdk corpus missing from output:\n${res.stdout}`);
  assert.match(res.stdout, /«proj-app»/, 'app hit must carry its project attribution');
  assert.match(res.stdout, /«proj-sdk»/, 'sdk hit must carry its project attribution');
  assert.deepEqual(res.calls, [], 'multi-root search makes no network calls');
});

test('AC2: --projects=<one> excludes the other target chunks', () => {
  const { cwd } = twoRootProject();
  const res = runCx(cwd, ['knowledge', 'search', 'auth strategy', '--projects=proj-app', '--top=20']);
  assert.equal(res.status, 0, `scoped search failed: ${res.stderr}`);
  assert.match(res.stdout, /«proj-app»/, 'scoped search must include the named project');
  assert.doesNotMatch(res.stdout, /«proj-sdk»/, 'scoped search must exclude the other project');
  assert.deepEqual(res.calls, [], 'scoped search makes no network calls');
});

test('R3: an unknown --projects id exits non-zero with an actionable message', () => {
  const { cwd } = twoRootProject();
  const res = runCx(cwd, ['knowledge', 'search', 'auth strategy', '--projects=proj-nope']);
  assert.notEqual(res.status, 0, 'unknown project must fail, not return empty');
  assert.match(`${res.stdout}${res.stderr}`, /unknown project "proj-nope"/, 'message must name the bad id');
  assert.match(`${res.stdout}${res.stderr}`, /proj-app/, 'message must list known projects');
});

test('AC4: ingest --as stamps origin provenance; without --as is unchanged', () => {
  const { cwd } = twoRootProject();
  const srcFile = path.join(cwd, 'note.md');
  fs.writeFileSync(srcFile, '# Imported note\n\nSome imported knowledge body text.\n');

  const withAs = runCx(cwd, ['ingest', srcFile, '--as=proj-app', '--fidelity=fast']);
  assert.equal(withAs.status, 0, `ingest --as failed: ${withAs.stderr}`);
  const knowledgeDir = path.join(cwd, '.construct', 'knowledge', 'internal');
  const stamped = fs.readdirSync(knowledgeDir).map((f) => fs.readFileSync(path.join(knowledgeDir, f), 'utf8'));
  const provenanced = stamped.find((c) => c.includes('origin_target_id: proj-app'));
  assert.ok(provenanced, 'ingest --as must stamp origin_target_id');
  assert.match(provenanced, /origin_provider: directory/, 'ingest --as must stamp origin_provider');

  const src2 = path.join(cwd, 'note2.md');
  fs.writeFileSync(src2, '# Plain note\n\nUnbound knowledge body text.\n');
  const noAs = runCx(cwd, ['ingest', src2, '--fidelity=fast']);
  assert.equal(noAs.status, 0, `plain ingest failed: ${noAs.stderr}`);
  const afterPlain = fs.readdirSync(knowledgeDir).map((f) => fs.readFileSync(path.join(knowledgeDir, f), 'utf8'));
  const plainFile = afterPlain.find((c) => c.includes('Unbound knowledge body'));
  assert.ok(plainFile, 'plain ingest must still write the file');
  assert.doesNotMatch(plainFile, /origin_target_id/, 'plain ingest must not stamp provenance');
});

test('unknown ingest --as target is a hard error', () => {
  const { cwd } = twoRootProject();
  const srcFile = path.join(cwd, 'note.md');
  fs.writeFileSync(srcFile, '# Imported note\n\nSome imported knowledge body text.\n');
  const res = runCx(cwd, ['ingest', srcFile, '--as=proj-nope', '--fidelity=fast']);
  assert.notEqual(res.status, 0, 'unknown --as target must fail');
  assert.match(`${res.stdout}${res.stderr}`, /unknown source target "proj-nope"/, 'message must name the bad id');
});
