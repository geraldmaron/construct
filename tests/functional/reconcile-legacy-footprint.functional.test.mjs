/**
 * tests/functional/reconcile-legacy-footprint.functional.test.mjs
 *
 * Functional coverage for the two ADR-0027 backward-repair tasks that de-conflate
 * Construct's footprint from host project content:
 *   - legacy-doctrine-strip  (ask) — collapses an un-fenced doctrine body in
 *     AGENTS.md/CLAUDE.md to the project header plus marker blocks
 *   - legacy-guide-decommit  (ask) — relocates a root construct_guide.md into .cx/
 *
 * Each test runs from an isolated tmp cwd. For every task: a needsRepair case,
 * apply() fixes it, a second detect() returns needsRepair:false (idempotency),
 * and user content / canonical copies are preserved. Both tasks are `ask`, so a
 * final test asserts they are excluded from runAutoReconciliations' applied set.
 */

import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshReconcileModule() {
  return import(`${pathToFileURL(join(REPO_ROOT, 'lib', 'reconcile', 'index.mjs')).href}?ts=${Date.now()}-${Math.random()}`);
}

async function taskModule(file) {
  const full = join(REPO_ROOT, 'lib', 'reconcile', file);
  const mod = await import(`${pathToFileURL(full).href}?ts=${Date.now()}-${Math.random()}`);
  return mod.default;
}

function withCwd(fn) {
  const project = mkdtempSync(join(tmpdir(), 'cx-legacy-foot-'));
  const home = mkdtempSync(join(tmpdir(), 'cx-legacy-home-'));
  const prev = { cwd: process.cwd(), HOME: process.env.HOME, CX_HOME_OVERRIDE: process.env.CX_HOME_OVERRIDE };
  process.env.HOME = home;
  process.env.CX_HOME_OVERRIDE = home;
  process.chdir(project);
  return Promise.resolve(fn({ project })).finally(() => {
    process.chdir(prev.cwd);
    for (const k of ['HOME', 'CX_HOME_OVERRIDE']) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    rmTmpDir(project);
    rmTmpDir(home);
  });
}

const LEGACY_AGENTS = `<!--
AGENTS.md — canonical operating contract for AI agents working in this repository.
-->

# demo-project Agent Guide

## Operating hierarchy

- Use Beads.

## Start-of-session rules

- Read AGENTS.md.

## Maintenance rules

- Update plan.

## End-of-session rules

- Push.

## House rules

- Prefer functional components.

## Verification rules

- Tests pass.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker
bd ready
<!-- END BEADS INTEGRATION -->

<!-- BEGIN CONSTRUCT INTEGRATION v:1 hash:4217abca6dd1 -->
## Construct integration
This project is managed by Construct.
<!-- END CONSTRUCT INTEGRATION -->`;

test('legacy-doctrine-strip: removes doctrine, preserves user section + marker blocks, idempotent', async () => {
  await withCwd(async ({ project }) => {
    writeFileSync(join(project, 'AGENTS.md'), LEGACY_AGENTS);
    const task = await taskModule('legacy-doctrine-strip.mjs');

    const before = await task.detect();
    assert.equal(before.needsRepair, true);

    await task.apply();
    const out = readFileSync(join(project, 'AGENTS.md'), 'utf8');

    assert.ok(!out.includes('## Operating hierarchy'), 'doctrine removed');
    assert.ok(!out.includes('## Verification rules'), 'doctrine removed');
    assert.ok(out.includes('## House rules'), 'user section preserved');
    assert.ok(out.includes('<!-- BEGIN BEADS INTEGRATION'), 'beads block preserved');
    assert.ok(out.includes('<!-- BEGIN CONSTRUCT INTEGRATION'), 'construct block preserved');
    assert.equal(out.split('\n')[0], '# demo-project', 'collapsed to plain project H1');

    const after = await task.detect();
    assert.equal(after.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('legacy-doctrine-strip: a clean AGENTS.md (header + marker block only) is left alone', async () => {
  await withCwd(async ({ project }) => {
    const clean = '# demo-project\n\n<!-- BEGIN CONSTRUCT INTEGRATION v:1 hash:abc -->\n## Construct integration\nx\n<!-- END CONSTRUCT INTEGRATION -->\n';
    writeFileSync(join(project, 'AGENTS.md'), clean);
    const task = await taskModule('legacy-doctrine-strip.mjs');
    const det = await task.detect();
    assert.equal(det.needsRepair, false);
  });
});

test('legacy-doctrine-strip: strips doctrine from AGENTS.md that has YAML frontmatter', async () => {
  await withCwd(async ({ project }) => {
    const withFrontmatter = `---
cx_doc_id: abc123
generator: construct/init
---
<!--
AGENTS.md — canonical operating contract for AI agents working in this repository.
-->

# demo-project Agent Guide

## Operating hierarchy

- Use Beads.

## Start-of-session rules

- Read AGENTS.md.

## Maintenance rules

- Update plan.

## End-of-session rules

- Push.

## House rules

- Keep it clean.

## Verification rules

- Tests pass.

<!-- BEGIN CONSTRUCT INTEGRATION v:1 hash:4217abca6dd1 -->
## Construct integration
x
<!-- END CONSTRUCT INTEGRATION -->`;
    writeFileSync(join(project, 'AGENTS.md'), withFrontmatter);
    const task = await taskModule('legacy-doctrine-strip.mjs');

    const before = await task.detect();
    assert.equal(before.needsRepair, true);

    await task.apply();
    const out = readFileSync(join(project, 'AGENTS.md'), 'utf8');

    assert.ok(!out.includes('## Operating hierarchy'), 'doctrine removed');
    assert.ok(!out.includes('## Verification rules'), 'doctrine removed');
    assert.ok(!out.includes('cx_doc_id'), 'frontmatter stripped');
    assert.ok(out.includes('## House rules'), 'user section preserved');
    assert.ok(out.includes('<!-- BEGIN CONSTRUCT INTEGRATION'), 'construct block preserved');
    assert.equal(out.split('\n')[0], '# demo-project', 'starts with plain project H1');
  });
});

test('legacy-guide-decommit: relocates root construct_guide.md into .cx/, idempotent', async () => {
  await withCwd(async ({ project }) => {
    writeFileSync(join(project, 'construct_guide.md'), '# Welcome to Construct\n\norientation\n');
    const task = await taskModule('legacy-guide-decommit.mjs');

    const before = await task.detect();
    assert.equal(before.needsRepair, true);

    const applied = await task.apply();
    assert.match(applied.summary, /git rm --cached construct_guide\.md/);
    assert.ok(!existsSync(join(project, 'construct_guide.md')), 'root copy removed');
    assert.equal(readFileSync(join(project, '.cx', 'construct_guide.md'), 'utf8'), '# Welcome to Construct\n\norientation\n');

    const after = await task.detect();
    assert.equal(after.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('legacy-guide-decommit: an existing .cx/ guide is the canonical copy and is not clobbered', async () => {
  await withCwd(async ({ project }) => {
    mkdirSync(join(project, '.cx'), { recursive: true });
    writeFileSync(join(project, '.cx', 'construct_guide.md'), 'CANONICAL\n');
    writeFileSync(join(project, 'construct_guide.md'), 'ROOT STALE\n');
    const task = await taskModule('legacy-guide-decommit.mjs');

    await task.apply();
    assert.ok(!existsSync(join(project, 'construct_guide.md')), 'root copy removed');
    assert.equal(readFileSync(join(project, '.cx', 'construct_guide.md'), 'utf8'), 'CANONICAL\n', '.cx/ copy preserved');
  });
});

test('both tasks are ask-safety: excluded from runAutoReconciliations', async () => {
  await withCwd(async ({ project }) => {
    writeFileSync(join(project, 'AGENTS.md'), LEGACY_AGENTS);
    writeFileSync(join(project, 'construct_guide.md'), '# Welcome to Construct\n');
    const mod = await freshReconcileModule();
    const { applied, skipped } = await mod.runAutoReconciliations({});
    const appliedIds = applied.map((a) => a.id);
    assert.ok(!appliedIds.includes('legacy-doctrine-strip'), 'doctrine-strip not auto-applied');
    assert.ok(!appliedIds.includes('legacy-guide-decommit'), 'guide-decommit not auto-applied');
    const skippedAsk = skipped.filter((s) => s.reason === 'safety:ask').map((s) => s.id);
    assert.ok(skippedAsk.includes('legacy-doctrine-strip'));
    assert.ok(skippedAsk.includes('legacy-guide-decommit'));

    assert.ok(existsSync(join(project, 'construct_guide.md')), 'auto run left the root guide untouched');
  });
});
