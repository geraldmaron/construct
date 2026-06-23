/**
 * tests/core-dependency-policy.test.mjs — enforce ADR 0001 (zero npm core).
 *
 * ADR 0001 (docs/decisions/adr/0001-zero-npm-core.md) restricts the published CLI's
 * runtime `dependencies` to Node.js built-ins plus a small sanctioned set; any
 * other core dependency requires a merged ADR. Without enforcement, unsanctioned
 * deps drift in unnoticed — and a heavy transitive chain can ship a vulnerable
 * package to every consumer.
 *
 * The check is a ratchet. SANCTIONED is the ADR-0001 allowlist. PENDING_ADR
 * holds known drift awaiting a replace-or-ADR decision, each entry tied to a
 * tracking bead. A dependency in neither set fails the suite. Entries may only
 * leave PENDING_ADR (promoted to SANCTIONED via ADR, or removed), never join it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const SANCTIONED = new Set([
  '@modelcontextprotocol/sdk',
  '@lancedb/lancedb',
  'apache-arrow',
  // js-yaml: frontmatter parse/emit only (ADR-0028). New YAML use cases need
  // a fresh ADR; the allowlist entry is narrow on purpose.
  'js-yaml',
]);

// node-webvtt was removed (ADR-0028): zero in-tree usage. New deps may not
// enter this map — the ratchet only releases via SANCTIONED.

const PENDING_ADR = new Map();

test('core dependencies obey ADR 0001 (sanctioned, or tracked pending an ADR)', () => {
  const deps = Object.keys(pkg.dependencies || {});
  const unaccounted = deps.filter((d) => !SANCTIONED.has(d) && !PENDING_ADR.has(d));
  assert.deepEqual(
    unaccounted,
    [],
    `New core dependency without an ADR: ${unaccounted.join(', ')}. ` +
      `ADR 0001 limits runtime dependencies to ${[...SANCTIONED].join(', ')}. ` +
      `Write docs/decisions/adr/NNNN-*.md (see docs/guides/reference/dependencies.md) before adding it, or implement in-tree.`,
  );
});

test('pending-ADR allowlist stays disjoint from the sanctioned set', () => {
  for (const dep of PENDING_ADR.keys()) {
    assert.ok(!SANCTIONED.has(dep), `${dep} is both sanctioned and pending — remove it from PENDING_ADR`);
  }
});

test('the @xenova transformers chain is not reintroduced', () => {
  const everywhere = {
    ...(pkg.dependencies || {}),
    ...(pkg.optionalDependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  assert.ok(
    !('@xenova/transformers' in everywhere),
    '@xenova/transformers is deprecated and pulls a vulnerable onnx/protobufjs chain — use @huggingface/transformers',
  );
});

test('local-embedding ML stack stays optional, never forced into core', () => {
  assert.ok(
    !('@huggingface/transformers' in (pkg.dependencies || {})),
    '@huggingface/transformers must live in optionalDependencies (see docs/decisions/adr/0014-local-embeddings-optional.md) — the in-tree hashing embedder is the zero-dependency default',
  );
  assert.ok(
    '@huggingface/transformers' in (pkg.optionalDependencies || {}),
    '@huggingface/transformers should be declared in optionalDependencies so local ONNX embedding remains an opt-in capability',
  );
});
