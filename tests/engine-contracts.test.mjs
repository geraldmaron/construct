/**
 * tests/engine-contracts.test.mjs — Contract tests for the six-layer plugin engine.
 *
 * Verifies that:
 *   - All six layers resolve to a default plugin with no errors.
 *   - Each default plugin satisfies its contract.
 *   - The Embedder default reports dimensions consistent with the configured
 *     embedding model (defaults to local 384d ONNX).
 *   - Override plugins from .cx/plugins.json are loaded and contract-checked.
 *   - Failed overrides fall back to the default and surface in `errors`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after, beforeEach } from 'node:test';
import { resolveEngine, describeEngine } from '../lib/engine/registry.mjs';
import { LAYERS, checkContract, assertContract } from '../lib/engine/contracts.mjs';
import {
  createDefaultEmbedder,
  createDefaultChunker,
  createDefaultIndexer,
  createDefaultFuser,
  createDefaultReranker,
  createDefaultCompressor,
} from '../lib/engine/defaults.mjs';
import { resetEngine } from '../lib/engine/index.mjs';

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-engine-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetEngine();
});

describe('engine contracts', () => {
  it('LAYERS contains exactly the six expected layers', () => {
    assert.deepEqual([...LAYERS].sort(), [
      'chunker', 'compressor', 'embedder', 'fuser', 'indexer', 'reranker',
    ]);
  });

  it('default Embedder satisfies contract and declares positive dimensions', async () => {
    const embedder = createDefaultEmbedder();
    if (typeof embedder.init === 'function') await embedder.init();
    assertContract('embedder', embedder);
    assert.ok(Number.isInteger(embedder.meta.dimensions) && embedder.meta.dimensions > 0);
    assert.equal(typeof embedder.embed, 'function');
    assert.equal(typeof embedder.embedBatch, 'function');
  });

  it('default Chunker, Indexer, Fuser, Reranker, Compressor each satisfy contract', () => {
    assertContract('chunker', createDefaultChunker());
    assertContract('indexer', createDefaultIndexer());
    assertContract('fuser', createDefaultFuser());
    assertContract('reranker', createDefaultReranker());
    assertContract('compressor', createDefaultCompressor());
  });

  it('checkContract returns ok=false with an error for missing methods', () => {
    const broken = { meta: { id: 'broken' } };
    const r = checkContract('embedder', broken);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /required|missing/i);
  });

  it('resolveEngine returns all six layers from defaults with no errors', async () => {
    const { layers, sources, errors } = await resolveEngine({ rootDir: tmpDir });
    assert.deepEqual(errors, []);
    for (const layer of LAYERS) {
      assert.ok(layers[layer], `${layer} missing`);
      assert.equal(sources[layer], 'default');
      assertContract(layer, layers[layer]);
    }
  });

  it('describeEngine summary lists every layer with its plugin id and source', async () => {
    const desc = await describeEngine({ rootDir: tmpDir });
    assert.equal(desc.summary.length, LAYERS.length);
    for (const entry of desc.summary) {
      assert.ok(LAYERS.includes(entry.layer));
      assert.ok(entry.id && entry.id !== '(missing)');
      assert.equal(entry.source, 'default');
    }
  });
});

describe('engine plugin overrides', () => {
  it('loads a project-local plugin override from .cx/plugins.json', async () => {
    const cxDir = path.join(tmpDir, '.cx');
    const pluginPath = path.join(tmpDir, 'fake-fuser.mjs');
    fs.mkdirSync(cxDir, { recursive: true });
    fs.writeFileSync(pluginPath, `
      export function create() {
        return {
          meta: { id: 'fake-fuser-override', strategy: 'rrf-stub' },
          fuse(rankedLists) { return Object.values(rankedLists)[0] || []; },
        };
      }
    `);
    fs.writeFileSync(
      path.join(cxDir, 'plugins.json'),
      JSON.stringify({ plugins: [{ layer: 'fuser', package: pluginPath }] })
    );
    const { layers, sources, errors } = await resolveEngine({ rootDir: tmpDir });
    assert.deepEqual(errors, []);
    assert.equal(layers.fuser.meta.id, 'fake-fuser-override');
    assert.equal(sources.fuser, pluginPath);
  });

  it('falls back to default and records error when override fails contract', async () => {
    const cxDir = path.join(tmpDir, '.cx');
    const pluginPath = path.join(tmpDir, 'broken-embedder.mjs');
    fs.mkdirSync(cxDir, { recursive: true });
    fs.writeFileSync(pluginPath, `
      export function create() {
        return { meta: { id: 'broken' } };
      }
    `);
    fs.writeFileSync(
      path.join(cxDir, 'plugins.json'),
      JSON.stringify({ plugins: [{ layer: 'embedder', package: pluginPath }] })
    );
    const { layers, sources, errors } = await resolveEngine({ rootDir: tmpDir });
    assert.equal(layers.embedder.meta.id, 'construct-default-embedder');
    assert.equal(sources.embedder, 'default');
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /missing method|dimensions|required/);
  });

  it('rejects github: spec with a clear error', async () => {
    const cxDir = path.join(tmpDir, '.cx');
    fs.mkdirSync(cxDir, { recursive: true });
    fs.writeFileSync(
      path.join(cxDir, 'plugins.json'),
      JSON.stringify({ plugins: [{ layer: 'compressor', package: 'github:foo/bar#abc' }] })
    );
    const { errors } = await resolveEngine({ rootDir: tmpDir });
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /github:|not auto-installed/);
  });
});
