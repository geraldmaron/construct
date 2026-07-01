/**
 * tests/audit/f12-gates/audit-doc-staleness.red.mjs — R22 stale internal audit doc.
 *
 * tests/AUDIT.md hard-codes test-corpus counts in its "At a glance" section and
 * in section 5 (functional layer). Those numbers have drifted from the repo:
 * the doc claims 543 `*.test.mjs` files and "functional 146" / "12 tests, 6 files",
 * while disk now holds different totals. The doc also contradicts itself —
 * "Skipped markers: 0 file(s)" at the top vs "### 6. Skipped (5)" lower down.
 *
 * Best-practice target: a checked-in inventory doc is only trustworthy if its
 * counts are regenerated from disk (scripts/generate-test-corpus-inventory.mjs
 * exists for exactly this). These assertions parse the claimed numbers and
 * compare them to a fresh on-disk count. RED today: the numbers mismatch.
 * GREEN once the doc is regenerated from the live inventory (bead -004), or the
 * staleness-prone counts are removed in favor of the generated artifact.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
const AUDIT_DOC = path.join(REPO_ROOT, 'tests', 'AUDIT.md');

// Walk the repo for *.test.mjs, mirroring how AUDIT.md frames its corpus:
// the top-level "543 test files" claim and the "functional 146" / functional
// layer claim both count compiled test files, excluding node_modules.

function listTestFiles(rootDir) {
  const all = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith('.test.mjs')) {
        all.push(full);
      }
    }
  }
  return all;
}

function readDoc() {
  return fs.readFileSync(AUDIT_DOC, 'utf8');
}

describe('R22 — tests/AUDIT.md corpus counts track disk', () => {
  it('the doc exists and pins a regeneration script', () => {
    assert.ok(fs.existsSync(AUDIT_DOC), 'tests/AUDIT.md must exist');
    const doc = readDoc();
    assert.match(
      doc,
      /generate-test-corpus-inventory\.mjs/,
      'AUDIT.md should name its regeneration source so counts are not hand-maintained'
    );
  });

  it('the claimed total *.test.mjs count matches the on-disk count', () => {
    const doc = readDoc();
    const m = doc.match(/\*\*(\d+)\s+test files\*\*/);
    assert.ok(m, 'AUDIT.md should state a bold total test-file count');
    const claimedTotal = Number(m[1]);

    const actualTotal = listTestFiles(path.join(REPO_ROOT, 'tests')).length;

    assert.equal(
      claimedTotal,
      actualTotal,
      `AUDIT.md claims ${claimedTotal} *.test.mjs files but disk has ${actualTotal} — doc is stale (regenerate via scripts/generate-test-corpus-inventory.mjs)`
    );
  });

  it('the claimed functional-layer count matches the on-disk count', () => {
    const doc = readDoc();
    const m = doc.match(/Functional layer:\*\*\s+(\d+)\s+file/);
    assert.ok(m, 'AUDIT.md "At a glance" should state a functional file count');
    const claimedFunctional = Number(m[1]);

    const functionalDir = path.join(REPO_ROOT, 'tests', 'functional');
    const actualFunctional = listTestFiles(functionalDir).length;

    assert.equal(
      claimedFunctional,
      actualFunctional,
      `AUDIT.md claims ${claimedFunctional} functional files but disk has ${actualFunctional}`
    );
  });

  it('the "At a glance" and section-5 functional counts agree with each other', () => {
    const doc = readDoc();
    const glance = doc.match(/Functional layer:\*\*\s+(\d+)\s+file/);
    const section5 = doc.match(/###\s*5\.\s*Functional layer\s*\((\d+)\s+tests?,\s*(\d+)\s+files?\)/);
    assert.ok(glance, 'expected an At-a-glance functional file count');
    assert.ok(section5, 'expected a section-5 "(N tests, M files)" header');

    const glanceFiles = Number(glance[1]);
    const section5Files = Number(section5[2]);

    assert.equal(
      glanceFiles,
      section5Files,
      `AUDIT.md is internally inconsistent: "At a glance" says ${glanceFiles} functional files but section 5 says ${section5Files}`
    );
  });

  it('the skipped-marker count is internally consistent', () => {
    const doc = readDoc();
    const glance = doc.match(/Skipped markers:\*\*\s+(\d+)\s+file/);
    const section6 = doc.match(/###\s*6\.\s*Skipped\s*\((\d+)\)/);
    assert.ok(glance, 'expected an At-a-glance skipped-marker count');
    assert.ok(section6, 'expected a section-6 "Skipped (N)" header');

    const glanceSkips = Number(glance[1]);
    const section6Skips = Number(section6[1]);

    assert.equal(
      glanceSkips,
      section6Skips,
      `AUDIT.md is internally inconsistent: "At a glance" claims ${glanceSkips} skipped markers but section 6 lists ${section6Skips}`
    );
  });
});
