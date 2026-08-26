/**
 * tests/cli/first-run-surface.test.ts — first-run staffing and first output.
 *
 * Ordinary language must actually staff. Empty staff is a fail: asserting
 * that a phrase does not sit in the wrong seat still passes when it sits
 * in no seat. The walkthrough's first construct command is talk, not
 * doctor / status / help.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapImplications } from '../../src/kernel/implication/map.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function staffed(outcome: string): string[] {
  return mapImplications({ outcome }).implicated.map((row) => row.domain);
}

test('"is this ready" staffs product-scoping — empty staff is a fail', () => {
  const domains = staffed('is this ready');
  assert.ok(domains.length > 0, 'empty staff is a fail');
  assert.ok(
    domains.includes('product-scoping'),
    `expected product-scoping, got ${domains.join(', ') || '(none)'}`,
  );
});

test('"do the claims match" staffs evidence-provenance or coverage-gaps — empty staff is a fail', () => {
  const domains = staffed('do the claims match');
  assert.ok(domains.length > 0, 'empty staff is a fail');
  assert.ok(
    domains.includes('evidence-provenance') || domains.includes('coverage-gaps'),
    `expected evidence-provenance or coverage-gaps, got ${domains.join(', ') || '(none)'}`,
  );
});

test('a product-shape ask staffs system-design — empty staff is a fail', () => {
  const domains = staffed('will this shape survive');
  assert.ok(domains.length > 0, 'empty staff is a fail');
  assert.ok(
    domains.includes('system-design'),
    `expected system-design, got ${domains.join(', ') || '(none)'}`,
  );
});

function firstConstructCommand(markdown: string): string | null {
  const fences = markdown.matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g);
  for (const fence of fences) {
    for (const raw of fence[1].split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^(?:npx\s+\S+\s+)?construct\b/.test(line)) return line;
    }
  }
  return null;
}

test('the walkthrough first construct command is not doctor, status, or help', () => {
  const pages = [
    ['docs/first-run.md', readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8')],
    ['README.md', readFileSync(join(ROOT, 'README.md'), 'utf8')],
  ];
  for (const [path, text] of pages) {
    const first = firstConstructCommand(text);
    assert.ok(first, `${path} has no construct command to check`);
    assert.doesNotMatch(
      first,
      /\bconstruct\s+(doctor|status|help)\b/,
      `${path} first construct command is ${first} — first-run is talk, not doctor/status/verbs`,
    );
  }
});
