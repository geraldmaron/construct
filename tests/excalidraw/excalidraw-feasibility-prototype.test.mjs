/**
 * tests/excalidraw/excalidraw-feasibility-prototype.test.mjs (construct-tsyfe.4.6)
 *
 * Static checks for the Excalidraw feasibility prototype: bundle isolation from
 * bin/+lib/, lazy dynamic import in the prototype source, and an explicit defer
 * recommendation recorded in DECISION.md.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROTOTYPE_TSX = path.join(
  REPO,
  'packages/construct-ui/prototypes/excalidraw-editor/ExcalidrawPrototype.tsx',
);
const DECISION_MD = path.join(
  REPO,
  'packages/construct-ui/prototypes/excalidraw-editor/DECISION.md',
);
const BENCH_RESULTS = path.join(
  REPO,
  'packages/construct-ui/prototypes/excalidraw-editor/bench-results.json',
);

function grepCoreForExcalidraw() {
  try {
    execFileSync('grep', [
      '-rn',
      'excalidraw',
      path.join(REPO, 'bin'),
      path.join(REPO, 'lib'),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [];
  } catch (err) {
    const out = err.stdout?.trim();
    return out ? out.split('\n').filter(Boolean) : [];
  }
}

test('core CLI bundle (bin/+lib/) has zero excalidraw references', () => {
  const hits = grepCoreForExcalidraw();
  assert.deepEqual(hits, [], `unexpected excalidraw in core: ${hits.join('; ')}`);
});

test('prototype uses dynamic import for @excalidraw/excalidraw', () => {
  const source = fs.readFileSync(PROTOTYPE_TSX, 'utf8');
  assert.match(source, /await import\(['"]@excalidraw\/excalidraw['"]\)/);
  assert.doesNotMatch(source, /^import\s.*@excalidraw\/excalidraw/m);
});

test('DECISION.md records an explicit defer recommendation with trigger', () => {
  assert.ok(fs.existsSync(DECISION_MD), 'DECISION.md must exist');
  const text = fs.readFileSync(DECISION_MD, 'utf8');
  assert.match(text, /Recommendation:\s*DEFER/i);
  assert.match(text, /Trigger:/i);
  assert.doesNotMatch(text, /TBD|still deciding|needs more investigation/i);
});

test('bench-results.json exists with bundle measurements', () => {
  assert.ok(fs.existsSync(BENCH_RESULTS), 'run packages/construct-ui/prototypes/excalidraw-editor/bench.mjs first');
  const data = JSON.parse(fs.readFileSync(BENCH_RESULTS, 'utf8'));
  assert.equal(data.bead, 'construct-tsyfe.4.6');
  assert.ok(data.eagerEntry.minifiedBytes > 100_000, 'expected substantial Excalidraw bundle');
  assert.ok(data.eagerEntry.gzipBytes > 50_000, 'expected substantial gzip size');
});

test('repo-wide bin/+lib/ still absent excalidraw after prototype lands', () => {
  const hits = grepCoreForExcalidraw();
  assert.equal(hits.length, 0);
});
