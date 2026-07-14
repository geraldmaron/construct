/**
 * lib/skills/routing-bench.mjs — skill-routing retrieval benchmark.
 *
 * Drives lib/skills/router.mjs's suggestSkills through the shared
 * lib/evals/retrieval-bench.mjs harness (recall@5/precision@5/MRR/
 * mustNotInclude) against tests/fixtures/skill-routing/intents.json, so
 * routing-table and matcher changes get the same regression protection
 * the document-retrieval eval already has.
 */

import { readFileSync } from 'node:fs';
import { runRetrievalBench, formatBenchSummary } from '../evals/retrieval-bench.mjs';
import { suggestSkills } from './router.mjs';

export const DEFAULT_FIXTURE_PATH = new URL('../../tests/fixtures/skill-routing/intents.json', import.meta.url).pathname;

// The CI floor (construct-72gqn.6): below these, treat it as a routing
// regression, not noise. 0.8/0 are the exact thresholds the H4 plan named.

export const DEFAULT_THRESHOLDS = { minRecallAt5: 0.8, minMrr: 0 };

export function loadIntentFixtures(fixturePath = DEFAULT_FIXTURE_PATH) {
  return JSON.parse(readFileSync(fixturePath, 'utf8')).fixtures;
}

function makeSearch(rootDir) {
  return async (query) => {
    const { suggestions } = suggestSkills({ intent: query, rootDir, limit: 5 });
    return { ids: suggestions.map((s) => s.path) };
  };
}

export async function runSkillRoutingBench({ rootDir = process.cwd(), fixturePath = DEFAULT_FIXTURE_PATH, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const fixtures = loadIntentFixtures(fixturePath);
  return runRetrievalBench({ fixtures, search: makeSearch(rootDir), thresholds });
}

export { formatBenchSummary };
