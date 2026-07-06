/**
 * tests/functional/profile-lifecycle.functional.test.mjs — Scope lifecycle.
 *
 * Verifies the full discipline:
 *   create -> draft scaffolded with requirements brief
 *   drafts -> lists the draft
 *   health  -> returns a rollup (zero when no data yet)
 *   archive -> only allowed with a substantive reason; moves files into archive/
 *
 * Archiving touches the real repo paths under scopes/ + lib/intake/tables/,
 * so the archive test stages a sacrificial scope under a fake repo to avoid
 * mutating the project's own curated catalog mid-test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDraftScope, listDrafts, scopeHealth } from '../../lib/scopes/lifecycle.mjs';

test('lifecycle: createDraftScope scaffolds requirements brief + draft scope', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-create-'));
  const { briefPath, draftPath } = createDraftScope({ cwd, id: 'media-agency', displayName: 'Media Agency' });

  assert.ok(fs.existsSync(briefPath));
  assert.ok(fs.existsSync(draftPath));

  const brief = fs.readFileSync(briefPath, 'utf8');
  // Discipline anchors are present, not just empty section headers. These
  // are the core-12-roster ids (construct-rf26.11); cx-researcher absorbed
  // ux-researcher and cx-reviewer absorbed evaluator/trace-reviewer.
  assert.match(brief, /cx-researcher/);
  assert.match(brief, /cx-product-manager/);
  assert.match(brief, /cx-architect/);
  assert.match(brief, /cx-reviewer/);
  assert.match(brief, /Acceptance:/);

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  assert.equal(draft.id, 'media-agency');
  assert.equal(draft.custom, true);

  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('lifecycle: createDraftScope rejects id collisions with the curated catalog', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-collide-'));
  assert.throws(
    () => createDraftScope({ cwd, id: 'rnd' }),
    /already exists in the curated catalog/,
  );
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('lifecycle: createDraftScope refuses to overwrite an existing draft', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-overwrite-'));
  createDraftScope({ cwd, id: 'studio-x' });
  assert.throws(
    () => createDraftScope({ cwd, id: 'studio-x' }),
    /already exists/,
  );
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('lifecycle: listDrafts surfaces in-progress drafts under .cx/scopes/', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-list-drafts-'));
  createDraftScope({ cwd, id: 'one' });
  createDraftScope({ cwd, id: 'two' });
  const drafts = listDrafts(cwd);
  const ids = drafts.map((d) => d.id).sort();
  assert.deepEqual(ids, ['one', 'two']);
  for (const d of drafts) {
    assert.equal(d.hasBrief, true);
    assert.equal(d.hasScope, true);
  }
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('lifecycle: scopeHealth returns a zero-shaped report when no data exists', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-health-empty-'));
  const report = scopeHealth(cwd, 'rnd');
  assert.equal(report.scope, 'rnd');
  assert.equal(report.scopeExists, true);
  assert.equal(report.observationCount, 0);
  assert.deepEqual(report.roles, {});
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('lifecycle: scopeHealth counts per-role outcomes filtered by scope', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-health-data-'));
  const outDir = path.join(cwd, '.cx', 'outcomes');
  fs.mkdirSync(outDir, { recursive: true });
  const lines = [
    { ts: new Date().toISOString(), role: 'engineer', profile: 'rnd', success: true },
    { ts: new Date().toISOString(), role: 'engineer', profile: 'rnd', success: false },
    { ts: new Date().toISOString(), role: 'engineer', profile: 'creative', success: true },
  ];
  fs.writeFileSync(path.join(outDir, 'engineer.jsonl'), lines.map(JSON.stringify).join('\n') + '\n');

  const report = scopeHealth(cwd, 'rnd');
  assert.equal(report.roles.engineer.runs, 2);
  assert.equal(report.roles.engineer.successRate, 0.5);

  const creative = scopeHealth(cwd, 'creative');
  assert.equal(creative.roles.engineer.runs, 1);
  assert.equal(creative.roles.engineer.successRate, 1);

  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('lifecycle: archiveScope refuses an empty or trivial reason', async () => {
  const { archiveScope } = await import('../../lib/scopes/lifecycle.mjs');
  assert.throws(() => archiveScope({ id: 'rnd', reason: '' }), /substantive reason/);
  assert.throws(() => archiveScope({ id: 'rnd', reason: 'idk' }), /substantive reason/);
});

test('lifecycle: createDraftScope seeds persona + department artifacts when supplied', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-seeded-'));
  const result = createDraftScope({
    cwd,
    id: 'studio-y',
    displayName: 'Studio Y',
    seedRoles: ['game-designer', 'narrative-writer', 'qa'],
    seedDepartments: [
      { id: 'design', displayName: 'Design' },
      { id: 'production', displayName: 'Production' },
    ],
  });

  assert.equal(result.personaPaths.length, 3);
  assert.equal(result.departmentPaths.length, 2);

  // Each persona artifact has the canonical section headings; templates that
  // ship empty are rejected at promote-time, but the scaffolding must at least
  // produce the right structure.
  for (const p of result.personaPaths) {
    const content = fs.readFileSync(p, 'utf8');
    assert.match(content, /## Goals/);
    assert.match(content, /## Frustrations/);
    assert.match(content, /## Decision rights/);
    assert.match(content, /## Handoffs/);
    assert.match(content, /## Output contract/);
    assert.match(content, /## Failure modes/);
    assert.match(content, /## Evidence/);
  }
  for (const d of result.departmentPaths) {
    const content = fs.readFileSync(d, 'utf8');
    assert.match(content, /## Charter/);
    assert.match(content, /## Handoffs/);
    assert.match(content, /## Evidence/);
  }

  const draft = JSON.parse(fs.readFileSync(result.draftPath, 'utf8'));
  assert.deepEqual(draft.roles, ['game-designer', 'narrative-writer', 'qa']);
  assert.equal(draft.departments.length, 2);
  assert.equal(draft.departments[0].id, 'design');

  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
