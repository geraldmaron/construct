/**
 * tests/contracts-construct-handoff.test.mjs — construct→orchestrator handoff enrichment.
 *
 * Bare `{ goal }` packets from MCP validate must enrich before shape checks so
 * incomplete callers do not flood contract-violations.jsonl.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichConstructOrchestratorHandoff,
  needsConstructHandoffEnrichment,
  CONSTRUCT_ORCHESTRATOR_REQUIRED,
} from '../lib/contracts/construct-handoff.mjs';
import { validateHandoff } from '../lib/contracts/validate.mjs';

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
    const result = validateHandoff({
      producer: 'construct',
      consumer: 'cx-orchestrator',
      id: 'construct-to-orchestrator',
      artifact,
      enforcement: 'block',
    });
    assert.equal(result.ok, true, result.errors?.join('; '));
  });
});
