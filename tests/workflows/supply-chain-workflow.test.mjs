/**
 * tests/workflows/supply-chain-workflow.test.mjs — supply-chain.yml shape
 * for OSV config wiring and dependency-review skip-on-unsupported.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const YAML = readFileSync(resolve(ROOT, '.github/workflows/supply-chain.yml'), 'utf8');

test('OSV scan uses osv-scanner.toml and is not continue-on-error', () => {
  assert.match(YAML, /--config=osv-scanner\.toml/);
  const osvBlock = YAML.split(/osv-scan:/)[1]?.split(/\n  [a-z]/)[0] || '';
  assert.doesNotMatch(osvBlock, /continue-on-error:\s*true/);
});

test('dependency review is gated by probe-dependency-review support output', () => {
  assert.match(YAML, /probe-dependency-review:/);
  assert.match(YAML, /dependency-graph\/compare/);
  assert.match(
    YAML,
    /needs\.probe-dependency-review\.outputs\.supported\s*==\s*'true'/,
  );
  assert.match(YAML, /dependency-review-action@/);
});
