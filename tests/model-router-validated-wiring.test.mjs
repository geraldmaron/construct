/**
 * tests/model-router-validated-wiring.test.mjs
 *
 * Locks in that the embedded-resolution path
 * (lib/embedded-contract/model-resolve.mjs) routes the tier-default pin
 * through the validated-model subsystem in lib/model-router.mjs
 * (resolveValidatedModel/recommendTierModel/formatModelResolutionNotices/
 * isModelAvailable, plus RETIRED_MODEL_SLUGS), so a retired slug pinned via
 * CX_MODEL_STANDARD surfaces a named warning instead of resolving silently,
 * and that every exported symbol in model-router.mjs is reachable from
 * outside the file.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { resolveEmbeddedModel } from '../lib/embedded-contract/model-resolve.mjs';

test('retired slug pinned via env yields a user-visible warning naming the slug', () => {
  const env = { CX_MODEL_STANDARD: 'anthropic/claude-3.5-sonnet', ANTHROPIC_API_KEY: 'sk-test' };
  const r = resolveEmbeddedModel({ requestedTier: 'standard' }, { env });
  assert.ok(
    r.warnings.some((w) => w.includes('anthropic/claude-3.5-sonnet')),
    'retired slug must surface a named warning, not resolve silently',
  );
  assert.equal(r.resolutionSource, 'tier-default');
});

test('a valid pin resolves unchanged with no warning', () => {
  const env = { CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6', ANTHROPIC_API_KEY: 'sk-test' };
  const r = resolveEmbeddedModel({ requestedTier: 'standard' }, { env });
  assert.equal(r.warnings.length, 0);
  assert.equal(r.selectedModel, 'anthropic/claude-sonnet-4-6');
});

test('the validated-model subsystem named in construct-uccl.4 has external callers', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const routerPath = path.join(repoRoot, 'lib', 'model-router.mjs');

  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, out); continue; }
      if (/\.(mjs|js)$/.test(entry.name)) out.push(full);
    }
  }
  const files = [];
  for (const dir of ['lib', 'bin', 'tests']) walk(path.join(repoRoot, dir), files);
  const externalFiles = files.filter((f) => f !== routerPath);
  const externalSource = externalFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const targetExports = ['resolveValidatedModel', 'formatModelResolutionNotices', 'isModelAvailable'];
  const orphaned = targetExports.filter((name) => !new RegExp(`\\b${name}\\b`).test(externalSource));
  assert.deepEqual(orphaned, [], `validated-model exports with zero external callers: ${orphaned.join(', ')}`);
});
