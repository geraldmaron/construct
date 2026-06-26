/**
 * lib/intake/prepare.mjs — turn a fresh inbox ingestion into an R&D intake packet.
 *
 * Triggered by `InboxWatcher.poll()` after each successful file ingestion.
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
 * After enqueue, fires a signal.promoted lifecycle event when the triage
 * confidence crosses SIGNAL_PROMOTION_THRESHOLD (matches the default
 * tag-vocabulary auto_threshold), so subscribers can act on confidently
 * typed signals without polling the queue.
 *
 * The agent — invoked manually or via session-start hook nudge — reads
 * the resulting `.cx/intake/pending/<id>.json` and does the real
 * comparison work (overlap with existing PRD? contradicts ADR? new RFC
 * candidate?). The daemon never calls an LLM; the separation keeps the
 * daemon cheap and predictable while model spend stays with the agent.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildHybridSearchResultsAsync } from '../storage/hybrid-query.mjs';
import { suggestDocsLaneForFile } from '../docs-routing.mjs';
import { createIntakeQueue } from './queue.mjs';
import { classifyRdIntake, suggestTags } from './classify.mjs';
import { detectCustomerMentions, linkSignalToCustomer, updateCustomerProfile } from '../embed/customer-profiles.mjs';
import { resolveActiveScope } from '../scopes/loader.mjs';
import { emitBestEffort as emitRoleEvent } from '../roles/event-bus.mjs';
import { gatherAttribution, stampAttribution } from './attribution.mjs';
import { MANIFEST_REL_PATH } from './manifest.mjs';
import { loadVocabulary } from '../tags/vocabulary.mjs';

const DEFAULT_RELATED_LIMIT = 5;
const EXCERPT_CHARS = 800;
const QUERY_CHARS = 500;

// Confidence at which a triage signal is considered "promoted" from
// uncertain to confidently classified. Mirrors the default tag-vocabulary
// auto_threshold.
const SIGNAL_PROMOTION_THRESHOLD = 0.70;

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
    const raw = await hybridSearchFn(rootDir, query, { limit: relatedLimit, env });
    // Test mocks return an array directly; production wrapper returns
    // { results: [...] }. Accept both shapes so suggestTags sees the
    // same `related` regardless of caller. Preserve `tags` for the
    // related-inherit suggestion path.
    const hits = Array.isArray(raw) ? raw : (raw?.results || []);
    related = hits.map((hit) => ({
      path: hit.source_path || hit.path || hit.id,
      title: hit.title || hit.id,
      score: hit.score,
      summary: hit.summary || '',
      tags: Array.isArray(hit.tags) ? hit.tags : undefined,
    }));
  } catch (err) {
    related = [];
    if (process.env.CONSTRUCT_DEBUG_INTAKE === '1') {
      process.stderr.write(`[intake:prepare] hybrid search failed: ${err.message}\n`);
    }
  }

  const lane = suggestDocsLaneForFile(ingestedFile.sourcePath, extracted) || null;
  // Resolve the active profile so non-RND projects route to their own table.
  // Falls back to rnd for any project without explicit configuration, which
  // preserves prior behavior for every existing user.
  const activeProfile = resolveActiveScope(rootDir);
  const triage = classifyFn({
    sourcePath: ingestedFile.sourcePath,
    extractedText: extracted,
    related,
    profile: activeProfile?.id,
  });

  // Detect customer mentions and update profiles
  const customerMentions = detectCustomerMentions(extracted.slice(0, 2000));
  const customers = customerMentions.map((c) => c.customerId);

  const droppedInfo = ingestedFile.droppedInfo ?? [];

  // Tag auto-attribution: deterministic suggestions from triage + related
  // doc inheritance, filtered against the project tag vocabulary. Vocab
  // load failures fall through with empty suggestions — never block the
  // packet write on a missing/malformed vocab file.

  let vocab = null;
  try { vocab = loadVocabulary(rootDir); }
  catch { vocab = null; }
  const tagSuggestions = suggestTags(triage, related, vocab);

  const baseEntry = {
    intake: {
      sourcePath: ingestedFile.sourcePath,
      outputPath: ingestedFile.outputPath,
      characters: ingestedFile.characters,
      knowledgeSubdir: ingestedFile.knowledgeSubdir,
      extractor: droppedInfo.length > 0 ? { droppedInfo } : undefined,
    },
    triage,
    suggestion: lane ? { lane, source: 'docs-routing.suggestDocsLaneForFile' } : null,
    related,
    excerpt: extracted.slice(0, EXCERPT_CHARS),
    query,
    customers: customers.length ? customers : undefined,
    tags: tagSuggestions.length > 0 ? tagSuggestions : undefined,
  };

  // Capability detection mirrors inbox.mjs: stamp provenance onto the packet
  // when the project's intake manifest is present (init scaffolds it for
  // archetype-enabled profiles). Keeps non-archetype packets shape-identical
  // to the pre-attribution behavior so downstream consumers see no diff.

  const archetypeOn = existsSync(`${rootDir}/${MANIFEST_REL_PATH}`);
  const entry = archetypeOn ? stampAttribution(baseEntry, gatherAttribution({ cwd: rootDir })) : baseEntry;

  const intakeQueue = queue || createIntakeQueue(rootDir, env);
  const result = intakeQueue.enqueue(entry);
  const intakeId = result?.id || '';

  // Promotion fires once a triage signal crosses the auto-classification
  // threshold, giving subscribers a chance to act on a confidently typed
  // signal without polling the intake queue.

  if ((triage?.confidence ?? 0) >= SIGNAL_PROMOTION_THRESHOLD && triage?.intakeType && triage.intakeType !== 'unknown') {
    emitRoleEvent('signal.promoted', {
      summary: `${triage.intakeType} (${triage.confidence.toFixed(2)})`,
      context: {
        intakeId,
        intakeType: triage.intakeType,
        confidence: triage.confidence,
        sourcePath: ingestedFile.sourcePath,
        primaryOwner: triage.primaryOwner,
      },
    });
  }

  // Update customer profiles with new evidence
  for (const mention of customerMentions) {
    try {
      const intakeType = triage?.intakeType || 'insight';
      const excerptPreview = (extracted || '').slice(0, 200).replace(/\n/g, ' ').trim();
      linkSignalToCustomer(mention.customerId, {
        id: intakeId,
        type: 'intake',
        sourcePath: ingestedFile.sourcePath,
        summary: `[${intakeType}] ${ingestedFile.sourcePath.split('/').pop()}${excerptPreview ? ` — ${excerptPreview.slice(0, 100)}` : ''}`,
      });
    } catch (err) {
      if (process.env.CONSTRUCT_DEBUG_INTAKE === '1') {
        process.stderr.write(`[intake:prepare] customer profile update failed for ${mention.customerId}: ${err.message}\n`);
      }
    }
  }

  return result;
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
