/**
 * tests/contracts-construct-handoff.test.mjs — construct→orchestrator handoff enrichment.
 *
 * Bare `{ goal }` packets from MCP validate must enrich before shape checks so
 * incomplete callers do not flood contract-violations.jsonl.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  enrichConstructOrchestratorHandoff,
  needsConstructHandoffEnrichment,
  CONSTRUCT_ORCHESTRATOR_REQUIRED,
} from '../lib/contracts/construct-handoff.mjs';
import { validateHandoff } from '../lib/contracts/validate.mjs';

// validateHandoff logs to contract-violations.jsonl when a producer/consumer
// pair has no matching contract or the artifact fails a check; without an
// explicit repoRoot the write falls back to cwd-based project-scope
// resolution and pollutes this repo's real .construct/ log (construct-cdvtm).

function withRepoRoot(run) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'construct-handoff-'));
  mkdirSync(join(repoRoot, '.cx'), { recursive: true });
  try {
    return run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

describe('construct-handoff', () => {
  test('needsConstructHandoffEnrichment is true for bare goal packets', () => {
    assert.equal(needsConstructHandoffEnrichment({ goal: 'add rate limiting' }), true);
    assert.equal(needsConstructHandoffEnrichment({
      goal: 'x',
      intent: 'implement',
      workCategory: 'feature',
      riskFlags: [],
      acceptanceCriteria: ['tests pass'],
    }), false);
  });

  test('enrichConstructOrchestratorHandoff fills required orchestration fields', () => {
    const enriched = enrichConstructOrchestratorHandoff({ goal: 'add rate limiting to the API' });
    for (const field of CONSTRUCT_ORCHESTRATOR_REQUIRED) {
      assert.ok(Object.prototype.hasOwnProperty.call(enriched, field), `missing ${field}`);
    }
    assert.equal(enriched.goal, 'add rate limiting to the API');
    assert.ok(enriched.riskFlags != null && typeof enriched.riskFlags === 'object');
    assert.ok(Array.isArray(enriched.acceptanceCriteria));
  });

  test('enriched bare goal passes validateHandoff for construct-to-orchestrator', () => {
    const artifact = enrichConstructOrchestratorHandoff({ goal: 'fix oracle hygiene bead' });
    const result = withRepoRoot((repoRoot) => validateHandoff({
      producer: 'construct',
      consumer: 'cx-orchestrator',
      id: 'construct-to-orchestrator',
      artifact,
      enforcement: 'block',
      repoRoot,
    }));
    assert.equal(result.ok, true, result.errors?.join('; '));
  });
});
