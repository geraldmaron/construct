/**
 * audit-rules.test.mjs — static rule-reference audit (bead construct-bt9o).
 *
 * Rules have no runtime retrieval event to log, so "which rules earn their keep"
 * is answered statically: a rule is load-bearing if it is referenced by path in
 * the active surface OR glob-activated via `paths:` frontmatter; otherwise it is a
 * true orphan. Uses a tmp rootDir fixture so the test is deterministic.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditRules } from '../lib/audit-rules.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cx-auditrules-'));
  const w = (rel, body) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), body); };
  // A referenced rule named by a Worker Profile prompt, a glob-activated rule,
  // and a true orphan exercise every classification.
  w('rules/common/referenced.md', '---\ndescription: x\n---\nbody');
  w('rules/golang/glob.md', '---\ndescription: x\npaths:\n  - "**/*.go"\n---\nbody');
  w('rules/web/orphan.md', '---\ndescription: x\n---\nbody');
  w('registry/worker-profiles/prompts/construct.md', 'Follow rules/common/referenced.md when working.');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('classifies rules as referenced, glob-activated, or orphan', () => {
  const { root, cleanup } = fixture();
  try {
    const r = auditRules({ rootDir: root, silent: true });
    assert.equal(r.total, 3);
    assert.deepEqual(r.referenced.map((x) => x.rule), ['common/referenced']);
    assert.ok(r.referenced[0].refs >= 1, `expected at least one citation, got ${r.referenced[0].refs}`);
    assert.deepEqual(r.globScoped, ['golang/glob']);
    assert.deepEqual(r.orphans, ['web/orphan']);
    assert.deepEqual(r.issues, [{ kind: 'orphan-rules', items: ['web/orphan'] }]);
  } finally { cleanup(); }
});

test('a rule referenced from many surface files counts every citation', () => {
  const { root, cleanup } = fixture();
  try {
    writeFileSync(join(root, 'CLAUDE.md'), 'see rules/common/referenced.md and rules/common/referenced again');
    const r = auditRules({ rootDir: root, silent: true });
    const ref = r.referenced.find((x) => x.rule === 'common/referenced');
    assert.ok(ref.refs >= 3, `expected >=3 refs, got ${ref.refs}`);
  } finally { cleanup(); }
});

test('the real corpus has no false orphans among glob-scoped language rules', () => {
  // Guards the regression that flagged golang/python/etc. as orphans before
  // `paths:` frontmatter was treated as load-bearing.
  const r = auditRules({ silent: true });
  for (const lang of ['golang/coding-style', 'python/security', 'typescript/testing']) {
    assert.ok(!r.orphans.includes(lang), `${lang} must not be a false orphan (it is glob-activated)`);
  }
});
