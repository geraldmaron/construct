/**
 * tests/functional/hybrid-query-degraded-embedder.functional.test.mjs
 *
 * When the local ONNX embedding model isn't cached and allowRemoteModels=false,
 * embeddings-local.mjs silently degrades to the 256d hashing-bow-v1 adapter.
 * Querying an existing 384d LanceDB index with that vector is
 * indistinguishable from "no results" unless the caller checks for it.
 * Asserts buildHybridSearchResultsAsync fails loud, before reaching the
 * retrieval adapter, whenever the query embedding comes back degraded.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildHybridSearchResultsAsync } from '../../lib/storage/hybrid-query.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('search throws loudly instead of returning [] when the embedder silently degrades dimension', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-blf2r-'));
  const emptyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-blf2r-cache-'));
  try {
    const env = {
      ...process.env,
      CONSTRUCT_EMBEDDING_MODEL: 'local',
      // Empty, never-populated cache dir + allowRemoteModels=false (baked into
      // embeddings-local.mjs) forces a real degrade-to-hashing, not a mock.
      CONSTRUCT_EMBEDDING_CACHE_DIR: emptyCacheDir,
      CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
    };

    await assert.rejects(
      () => buildHybridSearchResultsAsync(rootDir, 'anything', { env }),
      /degraded away from the configured model/,
      'expected a loud degraded-embedder error, not a silent empty result',
    );
  } finally {
    rmTmpDir(rootDir);
    rmTmpDir(emptyCacheDir);
  }
});
