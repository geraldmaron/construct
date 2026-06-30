/**
 * tests/asset-quality/anti-fixtures.test.mjs — Asserts the asset-quality anti-fixture corpus.
 *
 * Each anti-fixture is an intentionally-bad artifact that MUST be rejected by the audit it
 * targets. Enforced fixtures assert the audit fires today against the real audit function;
 * pending fixtures are explicitly skipped with the bead that will enforce them, so a coverage
 * gap stays visible rather than silently passing. Registry: tests/fixtures/asset-quality/anti-fixtures.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintDocPresentation } from '../../lib/templates/doc-presentation.mjs';
import { auditDeckMarkdownLayout } from '../../lib/deck-export-pptx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, '..', 'fixtures', 'asset-quality');
const manifest = JSON.parse(readFileSync(path.join(fixturesRoot, 'anti-fixtures.json'), 'utf8'));

// Frontmatter is the markdown header block, not part of the body a presentation linter inspects; strip it the way the release gate does.

function loadBody(relPath) {
  const raw = readFileSync(path.join(fixturesRoot, relPath), 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '');
}

const AUDITS = {
  lintDocPresentation(relPath, fixture) {
    const { errors } = lintDocPresentation(loadBody(relPath), { type: fixture.type });
    return { failed: errors.length > 0, signals: errors };
  },
  auditDeckMarkdownLayout(relPath) {
    const raw = readFileSync(path.join(fixturesRoot, relPath), 'utf8');
    const result = auditDeckMarkdownLayout(raw);
    return { failed: result.ok === false, signals: result.issues.map((issue) => issue.code) };
  },
};

for (const fixture of manifest.fixtures) {
  const title = `${fixture.id}: trips ${fixture.audit}`;

  if (fixture.status === 'pending') {
    test(title, { skip: `pending audit — enforced by ${fixture.bead}` }, () => {});
    continue;
  }

  test(title, () => {
    const runAudit = AUDITS[fixture.audit];
    assert.ok(runAudit, `unknown audit ${fixture.audit} for ${fixture.id}`);
    const { failed, signals } = runAudit(fixture.path, fixture);
    assert.equal(failed, true, `${fixture.id} should be rejected by ${fixture.audit}`);
    const needle = fixture.expect.matches ?? fixture.expect.code;
    assert.ok(
      signals.some((signal) => String(signal).includes(needle)),
      `${fixture.id}: expected signal "${needle}" in ${JSON.stringify(signals)}`,
    );
  });
}

// A family with no enforced anti-fixture would let a whole format regress unnoticed; require at least one per declared family.

test('every declared family has an enforced anti-fixture', () => {
  for (const family of manifest.families) {
    const enforced = manifest.fixtures.filter(
      (fixture) => fixture.family === family && fixture.status === 'enforced',
    );
    assert.ok(enforced.length > 0, `family ${family} has no enforced anti-fixture`);
  }
});
