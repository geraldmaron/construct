/**
 * tests/functional/cross-repo-code-retrieval.functional.test.mjs —
 * sterile cross-repo code retrieval pins (construct-1smc4.4), mirroring the
 * knowledge-multiroot-corpus pattern: two fixture repos in tmpdirs registered
 * via the real `construct sources add`, fetch-spy preload, isolated HOME,
 * hashing embeddings, zero network.
 *
 * The three acceptance surfaces and where each is pinned:
 *
 *   AC1  Attributed code-chunk retrieval per origin.
 *        - Here: the RAG path (lib/knowledge/rag.mjs buildCorpus → ask
 *          --dry-run, backing `construct ask`) returns code chunks with
 *          origin.{targetId,projectKey,relPath,kind:'code'} under the hashing
 *          embedder — the retrieval half knowledge-multiroot.test.mjs's
 *          buildCorpus-only unit pins never exercised.
 *        - Also pinned (knowledgeSearch + `knowledge search` CLI):
 *          tests/functional/knowledge-search-code-federation.functional.test.mjs.
 *   AC2  --projects narrowing over code hits.
 *        - Here: through the real binary with targets registered via
 *          `sources add` (the multiroot-corpus registration path), a code
 *          marker scoped to the OTHER repo disappears; scoped to its own
 *          repo the marker surfaces with attribution.
 *        - Also pinned (config written directly, unit + CLI):
 *          tests/functional/knowledge-search-code-federation.functional.test.mjs.
 *   AC3  Code-map query.
 *        - Here: `graph build-targets` over TWO registered repos, then a
 *          SEPARATE process runs `graph query --projects=<id>` and
 *          `--projects=all` — per-project keyed results, an import edge found
 *          only in the repo that has it.
 *        - Also pinned (single target, persistence + unknown-id error):
 *          tests/functional/graph-target-build.functional.test.mjs.
 *
 * Sterile: repos are plain tmpdir directories (no git, no clone); a fetch-spy
 * preload proves zero outbound network on every spawned binary call; the RAG
 * embedder is forced to hashing-bow-v1 via CONSTRUCT_EMBEDDING_MODEL=hashing.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildCorpus, ask } from '../../lib/knowledge/rag.mjs';
import { resolveContentRoots } from '../../lib/sources/content-roots.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

const PRELOAD = path.join(os.tmpdir(), `cx-crossrepo-fetch-spy-${process.pid}.mjs`);
fs.writeFileSync(PRELOAD, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url) => {
  try { appendFileSync(process.env.FETCH_SPY_OUT, String(url) + '\\n'); } catch {}
  return { status: 200, ok: true, json: async () => ({}), text: async () => '' };
};
`);
test.after(() => { try { fs.rmSync(PRELOAD, { force: true }); } catch {} });

function runCx(cwd, args, extraEnv = {}) {
  const spyOut = path.join(cwd, `fetch-calls-${Math.random().toString(36).slice(2)}.log`);
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
      CONSTRUCT_EMBEDDING_MODEL: 'hashing',
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      GITHUB_REPOS: '',
      ...extraEnv,
    },
  });
  const calls = fs.readFileSync(spyOut, 'utf8').split('\n').filter(Boolean);
  return { ...res, calls };
}

const PY_MARKER = 'vkPipelineCruncherPy';
const GO_MARKER = 'vkDispatchWeaverGo';

// Each fixture repo carries one uniquely named non-JS code marker (retrieval
// attribution) and one JS import pair (code-map derivation: build-import-graph
// derives edges for .js/.mjs/.cjs sources only).

function makePyRepo() {
  const dir = freshDir('cx-crossrepo-py-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'pipeline.py'),
    `def ${PY_MARKER}(batch):\n    """Crunches a batch — exists only in the python repo."""\n    return sorted(batch)\n`,
  );
  fs.writeFileSync(path.join(dir, 'app.mjs'), "import { helper } from './lib/util.mjs';\nexport const run = () => helper();\n");
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'util.mjs'), 'export const helper = () => 1;\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Py repo\n\nDocs-only readme, no code markers here.\n');
  return dir;
}

function makeGoRepo() {
  const dir = freshDir('cx-crossrepo-go-');
  fs.mkdirSync(path.join(dir, 'internal'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'internal', 'dispatch.go'),
    `package internal\n\nfunc ${GO_MARKER}(route string) string {\n\treturn route\n}\n`,
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# Go repo\n\nDocs-only readme, no code markers here.\n');
  return dir;
}

function registerBoth(cwd, pyRepo, goRepo) {
  const addPy = runCx(cwd, ['sources', 'add', 'directory', 'repo-py', JSON.stringify({ path: pyRepo })]);
  assert.equal(addPy.status, 0, `sources add repo-py failed: ${addPy.stderr}`);
  const addGo = runCx(cwd, ['sources', 'add', 'directory', 'repo-go', JSON.stringify({ path: goRepo })]);
  assert.equal(addGo.status, 0, `sources add repo-go failed: ${addGo.stderr}`);
}

const dirTarget = (id, dir) => ({ id, provider: 'directory', selector: { path: dir } });

test('AC1: RAG retrieval (buildCorpus + ask --dry-run, hashing embedder) returns code chunks attributed per origin', async () => {
  const pyRepo = makePyRepo();
  const goRepo = makeGoRepo();
  const host = freshDir('cx-crossrepo-host-');

  const roots = resolveContentRoots(
    [dirTarget('repo-py', pyRepo), dirTarget('repo-go', goRepo)],
    { projectRoot: host },
  );
  const corpus = buildCorpus(host, { roots });
  assert.ok(corpus.length > 0, 'corpus non-empty');
  assert.ok(corpus.every((c) => c.origin), 'every chunk carries an origin');
  assert.ok(corpus.every((c) => Array.isArray(c.embedding) && c.embedding.length > 0), 'every chunk embedded (hashing-bow-v1)');

  const pyAnswer = await ask(PY_MARKER, { rootDir: host, corpus, dryRun: true });
  assert.ok(pyAnswer.sources.length > 0, 'python marker retrievable through the RAG pipeline');
  const pyHit = pyAnswer.sources.find((s) => s.origin?.kind === 'code');
  assert.ok(pyHit, 'a retrieved source carries origin.kind: code');
  assert.equal(pyHit.origin.targetId, 'repo-py', 'code hit attributed to repo-py');
  assert.equal(pyHit.origin.projectKey, 'repo-py');
  assert.equal(pyHit.origin.relPath, path.join('src', 'pipeline.py'), 'origin.relPath names the code file');
  assert.equal(pyHit.source, 'target-code');

  const goAnswer = await ask(GO_MARKER, { rootDir: host, corpus, dryRun: true });
  const goHit = goAnswer.sources.find((s) => s.origin?.kind === 'code');
  assert.ok(goHit, 'go marker retrievable as a code chunk');
  assert.equal(goHit.origin.targetId, 'repo-go', 'code hit attributed to repo-go');
  assert.equal(goHit.origin.relPath, path.join('internal', 'dispatch.go'));
});

test('AC1+AC2: sources add → knowledge search attributes code hits and --projects narrows them (real binary, zero network)', () => {
  const pyRepo = makePyRepo();
  const goRepo = makeGoRepo();
  const cwd = freshDir('cx-crossrepo-cli-');
  registerBoth(cwd, pyRepo, goRepo);

  const unscoped = runCx(cwd, ['knowledge', 'search', PY_MARKER, '--top=10']);
  assert.equal(unscoped.status, 0, `unscoped search failed: ${unscoped.stderr}`);
  assert.match(unscoped.stdout, /pipeline\.py/, `python code file missing from output:\n${unscoped.stdout}`);
  assert.match(unscoped.stdout, /«repo-py»/, 'code hit must carry its project attribution badge');
  assert.deepEqual(unscoped.calls, [], 'unscoped code search makes no network calls');

  const scopedAway = runCx(cwd, ['knowledge', 'search', PY_MARKER, '--projects=repo-go', '--top=10']);
  assert.equal(scopedAway.status, 0, `scoped-away search failed: ${scopedAway.stderr}`);
  assert.doesNotMatch(scopedAway.stdout, /pipeline\.py/, 'python code hit must not surface when scoped to repo-go');
  assert.doesNotMatch(scopedAway.stdout, /«repo-py»/, 'no repo-py attribution may appear under --projects=repo-go');
  assert.deepEqual(scopedAway.calls, [], 'scoped search makes no network calls');

  const scopedHome = runCx(cwd, ['knowledge', 'search', GO_MARKER, '--projects=repo-go', '--top=10']);
  assert.equal(scopedHome.status, 0, `scoped-home search failed: ${scopedHome.stderr}`);
  assert.match(scopedHome.stdout, /dispatch\.go/, `go code file missing from scoped output:\n${scopedHome.stdout}`);
  assert.match(scopedHome.stdout, /«repo-go»/, 'scoped code hit must carry its own project badge');
  assert.deepEqual(scopedHome.calls, [], 'scoped search makes no network calls');
});

test('AC3: code-map query — build-targets over two repos, separate-process query --projects=<id> and =all (zero network)', () => {
  const pyRepo = makePyRepo();
  const goRepo = makeGoRepo();
  const cwd = freshDir('cx-crossrepo-graph-');
  registerBoth(cwd, pyRepo, goRepo);

  const build = runCx(cwd, ['graph', 'build-targets', '--json']);
  assert.equal(build.status, 0, `graph build-targets failed: ${build.stderr}`);
  const built = JSON.parse(build.stdout);
  assert.equal(built.ok, true);
  assert.deepEqual(built.targets.map((t) => t.targetId).sort(), ['repo-go', 'repo-py'], 'one graph built per registered repo');
  assert.deepEqual(build.calls, [], 'build-targets makes no network calls');

  // A separate spawned process never ran the builder, so a correct answer
  // proves the per-target graphs persisted under .cx/graph/targets/<id>/.
  const scoped = runCx(cwd, ['graph', 'query', 'file:app.mjs', '--projects=repo-py', '--json']);
  assert.equal(scoped.status, 0, `scoped graph query failed: ${scoped.stderr}`);
  const scopedResult = JSON.parse(scoped.stdout);
  assert.equal(scopedResult.projects.length, 1, '--projects=repo-py selects exactly one graph');
  assert.equal(scopedResult.projects[0].projectKey, 'repo-py');
  assert.equal(scopedResult.projects[0].found, true);
  assert.deepEqual(scopedResult.projects[0].dependencies, ['file:lib/util.mjs'], 'import edge derived inside the scoped repo');
  assert.equal(scopedResult.projects[0].node.attrs.origin.targetId, 'repo-py', 'graph node carries its target origin');
  assert.equal(scopedResult.projects[0].node.attrs.origin.kind, 'code');
  assert.deepEqual(scoped.calls, [], 'scoped graph query makes no network calls');

  // --projects=all fans the same query across every target graph, keyed per
  // project: the node exists only in the repo that has the file.
  const all = runCx(cwd, ['graph', 'query', 'file:app.mjs', '--projects=all', '--json']);
  assert.equal(all.status, 0, `--projects=all graph query failed: ${all.stderr}`);
  const allResult = JSON.parse(all.stdout);
  assert.deepEqual(allResult.projects.map((p) => p.projectKey).sort(), ['repo-go', 'repo-py'], 'all spans both target graphs');
  const byKey = Object.fromEntries(allResult.projects.map((p) => [p.projectKey, p]));
  assert.equal(byKey['repo-py'].found, true, 'node found in the repo that has it');
  assert.equal(byKey['repo-go'].graphPresent, true, 'the other repo has a graph too');
  assert.equal(byKey['repo-go'].found, false, 'node correctly absent from the other repo\'s graph');
  assert.deepEqual(all.calls, [], '--projects=all graph query makes no network calls');
});
