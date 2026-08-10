/**
 * tests/decisions-registry.test.mjs — decision registry build + validation.
 *
 * The registry is the spine of the enforcement/decision-durability program
 * (bead construct-wvbf.1): it indexes ADRs and rules from source and binds each
 * to its enforcement via @enforces markers. Assignments are runtime records,
 * not durable decisions. These tests pin that the view builds
 * deterministically, parses ADR status/supersede edges, and surfaces the
 * advisory-vs-enforced split downstream gates depend on.
 *
 * docs/decisions/adr does not exist on the live tree, so ADR-parsing coverage
 * runs against a synthetic repoRoot fixture instead of the real corpus.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRegistry, validateRegistry, DECISION_STATUSES } from '../lib/decisions/registry.mjs';

function withFixtureRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cx-decisions-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the retired ADR corpus is never re-indexed on the live tree', () => {
  const { decisions } = buildRegistry();
  assert.equal(decisions.filter((d) => d.kind === 'adr').length, 0, 'docs/decisions/adr was deleted by design and stays empty');
});

test('ADR status and supersede edges parse into the canonical enum (synthetic fixture)', () => {
  withFixtureRepo((dir) => {
    const adrDir = join(dir, 'docs', 'decisions', 'adr');
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, '0001-first.md'), '# ADR-0001: First\n\n**Status**: superseded\n');
    writeFileSync(join(adrDir, '0002-second.md'), '# ADR-0002: Second\n\n**Status**: accepted\n**Supersedes**: ADR-0001\n');

    const { byId } = buildRegistry({ repoRoot: dir });
    const first = byId.get('ADR-0001');
    const second = byId.get('ADR-0002');
    assert.ok(first, 'ADR-0001 present');
    assert.ok(second, 'ADR-0002 present');
    assert.ok(DECISION_STATUSES.includes(second.status), `status "${second.status}" is canonical`);
    assert.equal(second.supersedes, 'ADR-0001');
  });
});

test('deleted legacy assignments are not indexed as durable decisions', () => {
  const { decisions, byId } = buildRegistry();
  assert.equal(decisions.some((decision) => decision.kind === 'adr'), false, 'no adr-kind decisions on the live tree');
  assert.equal(byId.has('any-to-product-manager'), false);
});

test('@enforces marker binds a test to a decision (synthetic fixture)', () => {
  withFixtureRepo((dir) => {
    const adrDir = join(dir, 'docs', 'decisions', 'adr');
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, '0001-first.md'), '# ADR-0001: First\n\n**Status**: accepted\n');
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'x.test.mjs'), '# @enforces ADR-0001\n');

    const { byId } = buildRegistry({ repoRoot: dir });
    const adr = byId.get('ADR-0001');
    assert.ok(adr, 'ADR-0001 present');
    assert.ok(
      adr.enforcingTests.some((t) => t.includes('x.test.mjs')),
      'the @enforces marker binds the decision and is discovered',
    );
    assert.equal(adr.advisory, false, 'a bound decision is not advisory');
  });
});

test('supersededBy is the inverse of supersedes', () => {
  const { decisions, byId } = buildRegistry();
  for (const d of decisions) {
    if (d.supersedes) {
      const target = byId.get(d.supersedes);
      if (target) assert.equal(target.supersededBy, d.id, `${d.supersedes}.supersededBy === ${d.id}`);
    }
  }
});

test('buildRegistry is deterministic and id-ordered', () => {
  const a = buildRegistry().decisions.map((d) => d.id);
  const b = buildRegistry().decisions.map((d) => d.id);
  assert.deepEqual(a, b, 'two builds are identical');
  const sorted = [...a].sort();
  assert.deepEqual(a, sorted, 'decisions are ordered by id');
});

test('validateRegistry passes on the current tree', () => {
  const { ok, errors } = validateRegistry();
  assert.equal(ok, true, `registry should be structurally valid: ${errors.join('; ')}`);
});
