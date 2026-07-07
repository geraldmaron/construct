/**
 * Live LLM smoke for every cx-specialist that ships with Construct.
 *
 * For each entry in specialists/org, load the prompt and run one
 * cheap completion against a canonical input. Assert only that the response
 * is non-empty + bounded in length. Catches "this specialist's prompt is
 * broken / unloadable / unparseable" regressions.
 *
 * Pinned to openai/gpt-4o-mini via OpenRouter for determinism — earlier
 * use of `openrouter/auto` routed some specialists to slow upstreams that
 * blew through the per-test timeout. Aggregate cost is still bounded by
 * the harness cap.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmHarness } from '../_lib/openrouter-llm.mjs';
import { loadRegistry } from '../../../lib/registry/loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });

const CANONICAL_PROMPT = 'A teammate proposes shipping a feature flag system. In one paragraph, what is your single most important first observation?';

const specialists = Object.values(registry.specialists ?? {})
  .filter((s) => s.promptFile && !s.skip_live_test)
  .map((s) => ({ name: s.name, promptFile: s.promptFile }));

for (const spec of specialists) {
  test(`cx-${spec.name} responds to a canonical prompt`, { timeout: 90_000 }, async (t) => {
    const llm = createLlmHarness({ capUsdCents: 50 });
    if (!llm.available) { t.skip(llm.skipReason); return; }

    let prompt;
    try {
      prompt = readFileSync(join(REPO_ROOT, spec.promptFile), 'utf8');
    } catch (e) {
      assert.fail(`failed to read prompt file ${spec.promptFile}: ${e.message}`);
    }
    assert.ok(prompt.length > 50, `cx-${spec.name} prompt suspiciously short (${prompt.length} chars)`);

    // Try once with a 30s per-call timeout, retry once on LLM_TIMEOUT.
    // Two timed-out attempts in a row is real OpenRouter unavailability,
    // not a code regression — skip rather than red the whole gate.

    let result;
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        result = await llm.complete({
          system: prompt,
          user: CANONICAL_PROMPT,
          maxTokens: 350,
          temperature: 0.4,
          timeoutMs: 30_000,
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err.code !== 'LLM_TIMEOUT') throw err;
      }
    }
    if (lastErr) { t.skip(`cx-${spec.name}: ${lastErr.message} (after 2 attempts)`); return; }

    assert.ok(result.text.length > 60, `cx-${spec.name}: response too short (${result.text.length} chars)`);
    assert.ok(result.text.length < 5000, `cx-${spec.name}: response too long (${result.text.length} chars)`);
  });
}

test('roster size sanity check', async (t) => {
  const llm = createLlmHarness({ capUsdCents: 50 });
  if (!llm.available) { t.skip(llm.skipReason); return; }

  // Cost guard per-test, not cumulative across the file — each harness
  // instance starts at zero. Asserting roster size catches the registry
  // shrinking unexpectedly between releases. construct-rf26.11 consolidated
  // the 29-specialist roster to 12 (orchestrator + 11 workers).

  assert.ok(specialists.length >= 12, `expected ≥12 cx-specialists in registry; got ${specialists.length}`);
});
