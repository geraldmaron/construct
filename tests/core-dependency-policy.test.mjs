/**
 * tests/core-dependency-policy.test.mjs — enforce ADR 0001 (zero npm core).
 *
 * ADR 0001 (docs/decisions/adr/0001-zero-npm-core.md) restricts the published CLI's
 * runtime `dependencies` to Node.js built-ins plus a small sanctioned set; any
 * other core dependency requires a merged ADR. Without enforcement, unsanctioned
 * deps drift in unnoticed — and a heavy transitive chain can ship a vulnerable
 * package to every consumer.
 *
 * The check is a ratchet. SANCTIONED is the allowlist. PENDING_ADR
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
  // js-yaml: frontmatter parse/emit only. New YAML use cases need
  // a fresh ADR; the allowlist entry is narrow on purpose.
  'js-yaml',
  // mailparser: RFC 5322/MIME email parsing only. Does not cover
  // .msg/OLE parsing — that input fails loud with a typed error instead.
  'mailparser',
  // RichDocument markdown/HTML adapters; narrow parse/sanitize surface only.
  'unified',
  'remark-parse',
  'remark-gfm',
  'rehype-parse',
  'rehype-sanitize',
]);

// node-webvtt was removed: zero in-tree usage. New deps may not
// enter this map — the ratchet only releases via SANCTIONED.

// @lancedb/lancedb and apache-arrow are declared in optionalDependencies, not
// SANCTIONED: the retrieval-adapter contract
// (lib/storage/retrieval-adapter.mjs) treats LanceDB as one adapter among
// possible others, with a dependency-free keyword/BM25 fallback, so core does
// not require a vector database (directive §13). Re-promoting either package
// to a core `dependencies` entry needs a fresh ADR, same as any other
// unaccounted-for dependency.

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

test('LanceDB + apache-arrow stay optional, never forced into core', () => {
  for (const dep of ['@lancedb/lancedb', 'apache-arrow']) {
    assert.ok(
      !(dep in (pkg.dependencies || {})),
      `${dep} must live in optionalDependencies (see docs/decisions/adr/0081-lancedb-optional-retrieval-adapter.md) — the keyword/BM25 adapter is the zero-dependency default`,
    );
    assert.ok(
      dep in (pkg.optionalDependencies || {}),
      `${dep} should be declared in optionalDependencies so the vector-backed retrieval adapter remains an opt-in capability`,
    );
  }
});

test('local-embedding ML stack stays optional, never forced into core', () => {
  assert.ok(
    !('@huggingface/transformers' in (pkg.dependencies || {})),
    '@huggingface/transformers must not ship in dependencies (see docs/decisions/adr/0014-local-embeddings-optional.md) — the in-tree hashing embedder is the zero-dependency default',
  );
  assert.ok(
    !('@huggingface/transformers' in (pkg.optionalDependencies || {})),
    '@huggingface/transformers must not ship in optionalDependencies — consumer installs inherit a vulnerable transitive chain (audit-published-artifact gate)',
  );
  assert.ok(
    '@huggingface/transformers' in (pkg.devDependencies || {}),
    '@huggingface/transformers should be declared in devDependencies for repo-local ONNX embedding experiments',
  );
});
