/**
 * tests/docs-optimize-consistency.test.mjs — guards the prompt-optimizer docs
 * against re-diverging from scripts/optimize.mjs.
 *
 * Ground truth (scripts/optimize.mjs) is that `construct optimize` is dry-run
 * by default, `--apply` patches the role skill file under skills/perspectives/ (never
 * registry manifests), backups + history live under the user home, and
 * the post-apply gate is the integrity check + `construct sync` composition —
 * there is no persona-validator hook, no DSPy dependency, no staging/promotion
 * workflow, and no promptHistory[] registry field. Also pins the launcher-class
 * bug: an ESM script must not reference bare __dirname.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

const OPTIMIZER_DOCS = [
  'skills/ai/prompt-optimizer.md',
  'commands/work/optimize-prompts.md',
];

test('scripts/optimize.mjs has no bare __dirname (ESM ReferenceError class)', () => {
  const src = read('scripts/optimize.mjs');
  assert.ok(
    !/(?<![\w.'"])__dirname\b/.test(src),
    'scripts/optimize.mjs is ESM — a bare __dirname throws at runtime and a try/catch can mask it, ' +
      'which is exactly how the persona-validator spawn silently never ran'
  );
});

test('scripts/optimize.mjs patch target stays skills/perspectives/', () => {
  const src = read('scripts/optimize.mjs');
  assert.match(
    src,
    /['"]skills['"],\s*['"]perspectives['"]/,
    'the optimizer must patch role skill files under skills/perspectives/ — the docs pin this target'
  );
  assert.ok(
    !src.includes('persona-validator'),
    'the persona-validator hook does not exist; optimize.mjs must not reference it'
  );
});

test('optimizer docs name skills/perspectives/ as the patch target, not registry manifests', () => {
  for (const rel of OPTIMIZER_DOCS) {
    const text = read(rel);
    assert.ok(
      text.includes('skills/perspectives/'),
      `${rel} must name skills/perspectives/ as the patch target`
    );
    assert.ok(
      !/specialists\/org\/specialists\/<agent>\.json/.test(text),
      `${rel} must not present registry/specialists/<agent>.json as the patch target`
    );
  }
});

test('optimizer docs carry no claims about machinery that does not exist', () => {
  const ghostClaims = [
    [/DSPy/i, 'a DSPy dependency', ['skills/ai/prompt-optimizer.md']],
    [/dspy-ai|pip3|Python 3\.\d+/, 'a Python/pip auto-install step', []],
    [/prompt-staging-/, 'staging marker files', []],
    [/promptHistory\[\]/, 'a promptHistory[] registry field', []],
    [/performance-reviews\/patches/, 'a patches output directory', []],
    [/persona-validator/, 'the removed persona-validator hook', []],
  ];
  for (const rel of OPTIMIZER_DOCS) {
    const text = read(rel);
    for (const [pattern, label, allowedIn] of ghostClaims) {
      if (allowedIn.includes(rel)) {
        const matches = text.match(new RegExp(pattern, 'g')) || [];
        assert.ok(
          matches.length <= 2,
          `${rel}: ${label} may appear only in the what-this-does-not-replace contrast, found ${matches.length} mentions`
        );
        continue;
      }
      assert.ok(
        !pattern.test(text),
        `${rel} must not claim ${label} — scripts/optimize.mjs has no such machinery`
      );
    }
  }
});

test('optimizer docs describe the real gate: dry-run default, explicit --apply, --rollback', () => {
  for (const rel of ['skills/ai/prompt-optimizer.md', 'commands/work/optimize-prompts.md']) {
    const text = read(rel);
    assert.ok(text.includes('--apply'), `${rel} must document the explicit --apply gate`);
    assert.ok(text.includes('--rollback'), `${rel} must document --rollback`);
    assert.match(
      text,
      /dry.?run/i,
      `${rel} must state the default run is a dry-run`
    );
  }
});

test('optimizer docs state the real minimum-signal default (3, not 20)', () => {
  const skill = read('skills/ai/prompt-optimizer.md');
  assert.match(
    skill,
    /--min-traces.*default 3|default 3.*--min-traces|\(default 3\)/,
    'skills/ai/prompt-optimizer.md must document --min-traces default 3'
  );
  assert.ok(
    !/fewer than 20 scored traces/.test(skill),
    'the 20-trace minimum was never the implemented default'
  );
});
