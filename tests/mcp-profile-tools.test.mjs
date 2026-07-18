/**
 * tests/mcp-profile-tools.test.mjs — Contract tests for lib/mcp/tools/scope.mjs.
 *
 * Each MCP wrapper is exercised in an isolated tmpdir so a green run guarantees:
 *   - read-only tools return structured data for a fresh project
 *   - mutating tools refuse to run without confirm=true
 *   - mutating tools write the expected durable artifacts with confirm=true
 *
 * Operator-only surfaces (optimize_apply / optimize_rollback) intentionally
 * remain CLI-only and are not asserted here.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scopeShow,
  scopeList,
  scopeDrafts,
  scopeHealthTool,
  outcomesSummary,
  outcomesRecord,
  knowledgeAdd,
  scopeCreate,
  sandboxList,
  learningStatus,
} from '../lib/mcp/tools/scope.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshProject(scopeId = 'rnd') {
  const dir = mkdtempSync(join(tmpdir(), 'cx-mcp-profile-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, 'construct.config.json'), JSON.stringify({ version: 1, scope: scopeId }, null, 2));
  return dir;
}

test('scope_show returns the configured scope shape', () => {
  const cwd = freshProject('rnd');
  const res = scopeShow({ cwd });
  assert.equal(res.id, 'rnd');
  assert.ok(Array.isArray(res.roles));
  assert.ok(Array.isArray(res.intake.types));
  assert.ok(Array.isArray(res.intake.stages));
  assert.equal(res.custom, false);
});

test('scope_show falls back to rnd when config is missing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cx-mcp-profile-default-'));
  tmpDirs.push(cwd);
  const res = scopeShow({ cwd });
  assert.equal(res.id, 'rnd');
});

test('scope_list returns the curated catalog with counts', () => {
  const res = scopeList();
  assert.ok(Array.isArray(res.scopes));
  const ids = res.scopes.map((p) => p.id);
  assert.ok(ids.includes('rnd'), 'rnd must be in the catalog');
  for (const p of res.scopes) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.roleCount, 'number');
  }
});

test('scope_drafts returns empty arrays for a fresh project', () => {
  const cwd = freshProject();
  const res = scopeDrafts({ cwd });
  assert.deepEqual(res.drafts, []);
  assert.equal(res.custom, null);
});

test('scope_health returns a deterministic zero-state for a fresh project', () => {
  const cwd = freshProject();
  const res = scopeHealthTool({ cwd, id: 'rnd', window_days: 7 });
  assert.equal(res.id, 'rnd');
  assert.equal(res.windowDays, 7);
  assert.equal(typeof res.observationCount, 'number');
});

test('outcomes_summary returns an empty-roles note when no data is recorded', () => {
  const cwd = freshProject();
  const res = outcomesSummary({ cwd });
  assert.ok('roles' in res);
  // Either no data note or empty roles dict; both are acceptable empty shapes.
  if (res.note) assert.equal(typeof res.note, 'string');
});

test('outcomes_record refuses to write without confirm=true', () => {
  const cwd = freshProject();
  const res = outcomesRecord({ cwd, role: 'cx-engineer', success: true });
  assert.ok(res.error && res.error.includes('confirm=true'));
});

test('outcomes_record validates required fields under confirm=true', () => {
  const cwd = freshProject();
  const res = outcomesRecord({ cwd, confirm: true });
  assert.ok(res.error && res.error.includes('role:string'));
});

test('outcomes_record appends a JSONL line when confirmed', () => {
  const cwd = freshProject();
  const res = outcomesRecord({
    cwd,
    confirm: true,
    role: 'cx-engineer',
    success: true,
    duration_ms: 1234,
    notes: 'unit',
  });
  assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
  const file = join(cwd, '.construct', 'outcomes', 'cx-engineer.jsonl');
  assert.ok(existsSync(file));
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.role, 'cx-engineer');
  assert.equal(entry.success, true);
  assert.equal(entry.source, 'mcp');
  assert.equal(entry.profile, 'rnd');
});

test('knowledge_add refuses to write without confirm=true', async () => {
  const cwd = freshProject();
  const res = await knowledgeAdd({ cwd, slug: 't', topic: 't', body: 'b' });
  assert.ok(res.error && res.error.includes('confirm=true'));
});

test('knowledge_add writes a research finding when confirmed', async () => {
  const cwd = freshProject();
  const res = await knowledgeAdd({
    cwd,
    confirm: true,
    slug: 'mcp-parity-smoke',
    topic: 'MCP parity smoke test',
    body: 'Findings:\nThis is a unit test artifact.\n',
    confidence: 'inferred',
  });
  assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
  const expected = join(cwd, '.construct', 'knowledge', 'external', 'research', 'mcp-parity-smoke.md');
  assert.ok(existsSync(expected));
  const md = readFileSync(expected, 'utf8');
  assert.ok(md.includes('kind: research-finding'));
  assert.ok(md.includes('profile: rnd'));
});

test('knowledge_add enforces confirmed-needs-source guard', async () => {
  const cwd = freshProject();
  const res = await knowledgeAdd({
    cwd,
    confirm: true,
    slug: 'mcp-parity-confirmed',
    topic: 'requires source',
    body: 'body',
    confidence: 'confirmed',
    sources: [],
  });
  assert.ok(res.error && res.error.includes('at least one source'));
});

test('scope_create refuses without confirm=true', () => {
  const cwd = freshProject();
  const res = scopeCreate({ cwd, id: 'mcp-smoke' });
  assert.ok(res.error && res.error.includes('confirm=true'));
});

test('scope_create scaffolds a draft when confirmed', () => {
  const cwd = freshProject();
  const res = scopeCreate({
    cwd,
    confirm: true,
    id: 'mcp-smoke-draft',
    display_name: 'MCP Smoke',
    seed_roles: ['scribe', 'analyst'],
    seed_departments: [{ id: 'craft', displayName: 'Craft' }],
  });
  assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
  assert.ok(existsSync(join(cwd, '.construct', 'scopes', 'draft-mcp-smoke-draft', 'scope.json')));
  assert.ok(existsSync(join(cwd, '.construct', 'scopes', 'draft-mcp-smoke-draft', 'requirements.md')));
  assert.equal(res.skillEmphasisPaths.length, 2);
  assert.equal(res.departmentPaths.length, 1);
});

test('sandbox_list returns the sandbox roster as an array', () => {
  const res = sandboxList();
  assert.ok(Array.isArray(res.sandboxes));
});

test('learning_status returns a structured one-shot dashboard for a fresh project', () => {
  const cwd = freshProject();
  // Seed one observation so observations.total exercises the read path.
  mkdirSync(join(cwd, '.construct', 'observations'), { recursive: true });
  writeFileSync(
    join(cwd, '.construct', 'observations', 'index.json'),
    JSON.stringify([{ createdAt: new Date().toISOString(), project: 'rnd' }]),
  );
  const res = learningStatus({ cwd });
  assert.equal(res.scope.id, 'rnd');
  assert.equal(res.observations.total, 1);
  assert.equal(res.research.count, 0);
  assert.ok('roles' in res.outcomes);
});
