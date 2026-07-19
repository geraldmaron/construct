/**
 * tests/functional/work-spec-planning.functional.test.mjs — day-one proof
 * for the graph-informed Work spec/planning surface (construct-b0nny.23).
 *
 * Drives the real `construct work-spec` CLI against one isolated sandbox
 * (CONSTRUCT_HOME_OVERRIDE redirected to a tmpdir, a real git fixture repo,
 * rmTmpDir teardown), mirroring tests/functional/workspace-domain.
 * functional.test.mjs's and tests/functional/graph-relational-store.
 * functional.test.mjs's isolation pattern. Spans CLI + two durable stores at
 * once (CLAUDE.md's multi-component-feature rule): the Workspace domain
 * store (construct-b0nny.22) and the relational graph store
 * (construct-b0nny.3/.12/.21). The graph fixture is seeded in-process via
 * the outbox enqueue/drain primitives (same approach graph-relational-store.
 * functional.test.mjs's milestone 3 already established), so the
 * independence/dependency outcomes below are deterministic rather than
 * depending on this repo's own real, evolving dependency graph.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');
const { deriveProjectKey } = await import('../../lib/state-root.mjs');

if (!sqliteAvailable()) {
  test('work-spec planning skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  const { enqueueOutboxEvent, drainOutbox } = await import('../../lib/graph/relational/outbox.mjs');

  const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'work-spec-b0nny23-home-'));
  const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'work-spec-b0nny23-repo-')));
  execFileSync('git', ['init', '-q'], { cwd: REPO });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: REPO });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: REPO });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/work-spec-planning.git'], { cwd: REPO });

  const CANONICAL_ID = deriveProjectKey(REPO);

  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;

  test.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    rmTmpDir(SANDBOX_HOME);
    rmTmpDir(REPO);
  });

  function node(id, type) {
    return { eventType: 'node_upsert', payload: { id, type, name: id, attrs: {} }, origin: 'functional-test', declared: true };
  }
  function edge(from, to, rel) {
    return { eventType: 'edge_upsert', payload: { from, to, rel }, origin: 'functional-test', declared: true };
  }

  // consumer.mjs imports both a.mjs and b.mjs — the assignment touching
  // a.mjs and the one touching b.mjs share a dependent, so a claimed-
  // parallel decomposition over them must be falsified.
  for (const ev of [
    node('file:consumer.mjs', 'file'), node('file:a.mjs', 'file'), node('file:b.mjs', 'file'),
    edge('file:consumer.mjs', 'file:a.mjs', 'imports'),
    edge('file:consumer.mjs', 'file:b.mjs', 'imports'),
  ]) enqueueOutboxEvent(REPO, ev);
  const drain = drainOutbox(REPO);
  assert.equal(drain.failed, 0);
  assert.equal(drain.deadLettered, 0);

  function runConstruct(args) {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
    });
  }

  function writeSpecFixture(name, spec) {
    const specPath = path.join(REPO, name);
    fs.writeFileSync(specPath, JSON.stringify(spec));
    return specPath;
  }

  const CONFLICTING_SPEC = {
    objective: 'Ship the thing',
    desiredOutcome: 'The thing ships',
    dependencyRationale: 'touch-a and touch-b were assumed to be independent',
    ownership: { files: ['file:a.mjs', 'file:b.mjs'] },
    decomposition: [
      { id: 'touch-a', kind: 'execute', touches: ['file:a.mjs'], dependsOn: [], ownership: { files: ['file:a.mjs'] } },
      { id: 'touch-b', kind: 'execute', touches: ['file:b.mjs'], dependsOn: [], ownership: { files: ['file:b.mjs'] } },
    ],
  };

  // --- build: produces a Work spec scoped to this repo's Workspace ---

  test('work-spec build stamps the Workspace id and attaches a graph-checked report', () => {
    const specPath = writeSpecFixture('conflicting-spec.json', CONFLICTING_SPEC);
    const res = runConstruct(['work-spec', 'build', `--from=${specPath}`, '--json']);
    assert.equal(res.status, 0, res.stderr);
    const body = JSON.parse(res.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.workSpec.workspace, CANONICAL_ID, 'Work spec is scoped to this rootDir\'s Workspace (deriveProjectKey)');
    assert.ok(body.workSpec.sourcesContext, 'Sources/Directives context is attached');
    assert.deepEqual(body.workSpec.sourcesContext.sources, []);
    assert.deepEqual(body.workSpec.sourcesContext.directives, []);
    assert.equal(body.workSpec.graphValidation.ok, false, 'touch-a/touch-b share a graph dependent');
    assert.equal(body.workSpec.graphValidation.independence.pairs[0].independent, false);
    assert.ok(body.workSpec.graphValidation.independence.pairs[0].sharedDependents.includes('file:consumer.mjs'));
    assert.equal(body.workSpec.state, 'draft', 'a spec whose graph check fails stays draft, not checked');
  });

  test('work-spec build --strict exits 1 when the graph-checked report is not ok', () => {
    const specPath = writeSpecFixture('conflicting-spec-strict.json', CONFLICTING_SPEC);
    const res = runConstruct(['work-spec', 'build', `--from=${specPath}`, '--json', '--strict']);
    assert.equal(res.status, 1);
  });

  test('the Workspace domain store now has a workspace for this repo (build ensured it)', () => {
    const res = runConstruct(['workspace-domain', 'show', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const body = JSON.parse(res.stdout);
    assert.equal(body.found, true);
    assert.equal(body.workspace.id, CANONICAL_ID);
  });

  // --- build: an independent, non-conflicting decomposition is marked checked ---

  test('work-spec build marks a genuinely independent decomposition as checked', () => {
    const spec = {
      objective: 'Ship the thing',
      desiredOutcome: 'The thing ships',
      dependencyRationale: 'touch-a has no declared or graph-derived dependency here',
      ownership: { files: ['file:a.mjs'] },
      decomposition: [
        { id: 'touch-a', kind: 'execute', touches: ['file:a.mjs'], dependsOn: [], ownership: { files: ['file:a.mjs'] } },
      ],
    };
    const specPath = writeSpecFixture('solo-spec.json', spec);
    const res = runConstruct(['work-spec', 'build', `--from=${specPath}`, '--json']);
    assert.equal(res.status, 0, res.stderr);
    const body = JSON.parse(res.stdout);
    assert.equal(body.workSpec.graphValidation.ok, true);
    assert.equal(body.workSpec.state, 'checked');
  });

  // --- check: runs the graph-informed report without touching the Workspace store ---

  test('work-spec check runs the graph-informed report against a caller-supplied spec', () => {
    const specPath = writeSpecFixture('check-spec.json', CONFLICTING_SPEC);
    const res = runConstruct(['work-spec', 'check', `--from=${specPath}`, '--json']);
    assert.equal(res.status, 0, res.stderr);
    const body = JSON.parse(res.stdout);
    assert.equal(body.graphValidation.independence.pairs[0].independent, false);
  });

  // --- validate: schema check only, no graph or workspace I/O ---

  test('work-spec validate accepts a schema-valid spec and rejects a malformed one', () => {
    const validPath = writeSpecFixture('valid-schema-spec.json', CONFLICTING_SPEC);
    const valid = runConstruct(['work-spec', 'validate', `--from=${validPath}`, '--json']);
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), { ok: true, errors: [] });

    const malformedPath = writeSpecFixture('malformed-spec.json', { objective: '' });
    const malformed = runConstruct(['work-spec', 'validate', `--from=${malformedPath}`, '--json']);
    assert.equal(malformed.status, 1);
    const malformedBody = JSON.parse(malformed.stdout);
    assert.equal(malformedBody.ok, false);
    assert.ok(malformedBody.errors.some((e) => e.includes('desiredOutcome')));
  });

  // --- build without --from: usage error, not a crash ---

  test('work-spec build without --from prints usage and exits 1', () => {
    const res = runConstruct(['work-spec', 'build']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Usage: --from=/);
  });
}
