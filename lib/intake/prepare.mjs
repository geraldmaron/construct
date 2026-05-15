/**
 * lib/intake/prepare.mjs — turn a fresh inbox ingestion into an R&D intake packet.
 *
 * Called by `InboxWatcher.poll()` after each successful file ingestion.
 * Four deterministic preparation steps, then write the result to the
 * intake queue:
 *
 *   1. Suggest a docs lane via lib/docs-routing.mjs (postmortem? PRD?).
 *   2. Query the corpus via lib/storage/hybrid-query.mjs for top-K existing
 *      docs related to the new content. Uses the file's filename + first
 *      paragraph as the query (no LLM call needed for retrieval).
 *   3. Extract a short excerpt of the new content for the agent to see
 *      without reopening the file.
 *   4. Run classifyRdIntake to produce the R&D triage object (intake type,
 *      owner persona, recommended chain, action, risk).
 *
 * The agent — invoked manually or via session-start hook nudge — reads
 * the resulting `.cx/intake/pending/<id>.json` and does the real
 * comparison work (overlap with existing PRD? contradicts ADR? new RFC
 * candidate?). The daemon never calls an LLM. This separation keeps the
 * daemon cheap and predictable; the model spend stays with the agent.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildHybridSearchResultsAsync } from '../storage/hybrid-query.mjs';
import { suggestDocsLaneForFile } from '../docs-routing.mjs';
import { createIntakeQueue } from './queue.mjs';
import { classifyRdIntake } from './classify.mjs';

const DEFAULT_RELATED_LIMIT = 5;
const EXCERPT_CHARS = 800;
const QUERY_CHARS = 500;

export async function prepareIntakeForIngestedFile({
  rootDir,
  ingestedFile,
  env = process.env,
  relatedLimit = DEFAULT_RELATED_LIMIT,
  hybridSearchFn = buildHybridSearchResultsAsync,
  queue,
  readFileFn = readContent,
  classifyFn = classifyRdIntake,
} = {}) {
  if (!rootDir) throw new Error('prepareIntakeForIngestedFile: rootDir is required');
  if (!ingestedFile?.sourcePath) throw new Error('prepareIntakeForIngestedFile: ingestedFile.sourcePath is required');

  const extracted = readFileFn(ingestedFile.outputPath) || '';
  const query = buildQuery(ingestedFile.sourcePath, extracted);

  let related = [];
  try {
    const search = await hybridSearchFn(rootDir, query, { limit: relatedLimit, env });
    related = (search?.results || []).map((hit) => ({
      path: hit.source_path || hit.id,
      title: hit.title || hit.id,
      score: hit.score,
      summary: hit.summary || '',
    }));
  } catch (err) {
    related = [];
    if (process.env.CONSTRUCT_DEBUG_INTAKE === '1') {
      process.stderr.write(`[intake:prepare] hybrid search failed: ${err.message}\n`);
    }
  }

  const lane = suggestDocsLaneForFile(ingestedFile.sourcePath, extracted) || null;
  const triage = classifyFn({
    sourcePath: ingestedFile.sourcePath,
    extractedText: extracted,
    related,
  });

  const entry = {
    intake: {
      sourcePath: ingestedFile.sourcePath,
      outputPath: ingestedFile.outputPath,
      characters: ingestedFile.characters,
      knowledgeSubdir: ingestedFile.knowledgeSubdir,
    },
    triage,
    suggestion: lane ? { lane, source: 'docs-routing.suggestDocsLaneForFile' } : null,
    related,
    excerpt: extracted.slice(0, EXCERPT_CHARS),
    query,
  };

  const intakeQueue = queue || createIntakeQueue(rootDir, env);
  return intakeQueue.enqueue(entry);
}

function buildQuery(sourcePath, extracted) {
  const filename = path.basename(sourcePath, path.extname(sourcePath))
    .replace(/[-_]+/g, ' ')
    .trim();
  const firstParagraph = (extracted || '').split(/\n\s*\n/).find((p) => p.trim().length > 20) || '';
  const combined = `${filename}\n\n${firstParagraph}`.slice(0, QUERY_CHARS).trim();
  return combined || filename || 'untitled intake';
}

function readContent(outputPath) {
  if (!outputPath || !existsSync(outputPath)) return '';
  try {
    const text = readFileSync(outputPath, 'utf8');
    const marker = text.indexOf('## Extracted Content');
    if (marker !== -1) return text.slice(marker + '## Extracted Content'.length).trim();
    return text;
  } catch {
    return '';
  }
}
