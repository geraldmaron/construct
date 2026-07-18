#!/usr/bin/env node
/**
 * scripts/reindex-retrieval-adapter.mjs — re-index the retrieval adapter's
 * derived search index from durable source data (construct-b0nny.20 / M5b).
 *
 * The retrieval adapter's index (LanceDB's observations_v1/documents_v1, or
 * the keyword adapter's observations.json/documents.json) is a derived
 * accelerator, never the source of truth: observation content lives in
 * lib/observation-store.mjs's per-record JSON files
 * (.construct/observations/<id>.json), and document content lives in the
 * project's own files (context.json, architecture.md, docs/README.md,
 * PRD/meta-PRD docs — see lib/storage/state-source.mjs). Rebuilding the index
 * from that source, into either adapter, therefore cannot lose data — this
 * script is the reversible "re-index behind the adapter boundary" step
 * disposition-matrix.md D6s requires before LanceDB's hard core import is
 * removed.
 *
 * Usage:
 *   node scripts/reindex-retrieval-adapter.mjs [--root=<dir>] [--adapter=lancedb|keyword|auto] [--dry-run]
 *
 * --dry-run reports how many observations/documents would be (re)written
 * without touching the target adapter's index. Skips any observation whose
 * adapter-side fingerprint (content hash + embedding model) already matches
 * the current content, mirroring lib/embed/reconcile.mjs's reconciliation
 * logic so re-running the script after a partial run is idempotent.
 */
import { parseArgs } from 'node:util';
import {
  listObservations,
  getObservation,
  observationSearchText,
  observationContentHash,
} from '../lib/observation-store.mjs';
import { embedText as embedTextEngine, getEmbeddingModelInfo } from '../lib/storage/embeddings-engine.mjs';
import { createRetrievalAdapter } from '../lib/storage/retrieval-adapter.mjs';
import { syncFileStateToSql } from '../lib/storage/sync.mjs';

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', default: process.cwd() },
      adapter: { type: 'string', default: 'auto' },
      'dry-run': { type: 'boolean', default: false },
      'skip-documents': { type: 'boolean', default: false },
    },
  });
  return {
    rootDir: values.root,
    adapterMode: values.adapter,
    dryRun: values['dry-run'],
    skipDocuments: values['skip-documents'],
  };
}

/**
 * Re-index every observation into the target adapter, skipping rows whose
 * fingerprint already matches (idempotent re-run). Returns per-row outcome
 * counts so both the CLI report and the functional test can assert on them.
 */
export async function reindexObservations(rootDir, { env = process.env, dryRun = false } = {}) {
  const adapter = await createRetrievalAdapter({ env, rootDir });
  const ids = (listObservations(rootDir, { limit: Number.MAX_SAFE_INTEGER }) || []).map((e) => e.id);
  const fingerprints = await adapter.getObservationFingerprints(ids);
  const currentModel = (await getEmbeddingModelInfo({ env })).model;

  const result = { total: ids.length, upToDate: 0, reindexed: 0, skippedMissing: 0, mode: adapter.mode };

  for (const id of ids) {
    const obs = getObservation(rootDir, id);
    if (!obs) {
      result.skippedMissing += 1;
      continue;
    }

    const searchText = observationSearchText(obs);
    const hash = observationContentHash(searchText);
    const fp = fingerprints.get(id);
    if (fp && fp.contentHash === hash && fp.model === currentModel) {
      result.upToDate += 1;
      continue;
    }

    if (dryRun) {
      result.reindexed += 1;
      continue;
    }

    const { embedding, model } = await embedTextEngine(searchText, { env });
    await adapter.storeObservation({ ...obs, embedding, contentHash: hash, model: model || currentModel });
    result.reindexed += 1;
  }

  await adapter.close();
  return result;
}

async function main() {
  const { rootDir, adapterMode, dryRun, skipDocuments } = parseCliArgs(process.argv.slice(2));
  const env = { ...process.env, CONSTRUCT_RETRIEVAL_ADAPTER: adapterMode };

  const obsResult = await reindexObservations(rootDir, { env, dryRun });
  console.log(
    `[reindex] observations — adapter=${obsResult.mode} total=${obsResult.total} ` +
    `reindexed=${obsResult.reindexed} up-to-date=${obsResult.upToDate} missing=${obsResult.skippedMissing}` +
    (dryRun ? ' (dry-run, no writes performed)' : ''),
  );

  if (!skipDocuments) {
    if (dryRun) {
      console.log('[reindex] documents — dry-run does not preview syncFileStateToSql; pass without --dry-run to sync');
    } else {
      const docResult = await syncFileStateToSql(rootDir, { env });
      console.log(
        `[reindex] documents — adapter=${docResult.backend} documentsSynced=${docResult.documentsSynced}`,
      );
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[reindex] failed: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
