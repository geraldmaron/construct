/**
 * Live LLM test for reviewer's plan-challenge mode (the devil-advocate
 * overlay folded into reviewer at construct-rf26.11).
 *
 * Loads the actual specialist prompt from `specialists/prompts/reviewer.md`,
 * runs it against a deliberately-flawed proposal via OpenRouter, and asserts:
 *   1. Response is non-empty + bounded length.
 *   2. Response challenges at least one specific element of the proposal
 *      (cites it back by name or quoted phrase).
 *   3. Response uses pushback-shaped language (assumption, risk, fail,
 *      what-if, question marks).
 *   4. Total per-suite spend stays under the cost cap.
 *
 * Skipped when OPENROUTER_API_KEY is absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmHarness } from '../_lib/openrouter-llm.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PROMPT = readFileSync(resolve(REPO_ROOT, 'specialists', 'prompts', 'reviewer.md'), 'utf8');

const FLAWED_PROPOSAL = `
Proposal: rewrite the auth layer to use JWT tokens stored in localStorage.

Rationale:
- Localstorage is simpler than cookies.
- JWTs are stateless so the server doesn't need a session store.
- Users have asked for "single sign-on" so we'll add Google OAuth.
- We'll ship this in 2 weeks, no rollback plan needed since it's an
  obvious improvement.
- Token expiry: 90 days (so users don't have to log in again).

Acceptance:
- Existing users can still log in.
- Tests pass.
`.trim();

test('reviewer produces critical pushback against an obviously-flawed proposal (plan-challenge mode)', { timeout: 120_000 }, async (t) => {
  const llm = createLlmHarness({ capUsdCents: 20 });
  if (!llm.available) { t.skip(llm.skipReason); return; }

  // Pinned to the harness default (openai/gpt-4o-mini). Retry once on
  // timeout before giving up — the merged reviewer prompt is longer than the
  // standalone devil-advocate prompt was, so 45s per attempt is realistic.

  let result;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      result = await llm.complete({
        system: PROMPT,
        user: `Switch to plan-challenge mode. Challenge this proposal. Be specific about which assumptions you attack and why.\n\n${FLAWED_PROPOSAL}`,
        maxTokens: 700,
        temperature: 0.3,
        timeoutMs: 45_000,
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'LLM_TIMEOUT') throw err;
    }
  }
  if (lastErr) { t.skip(`${lastErr.message} (after 2 attempts)`); return; }

  assert.ok(result.text.length > 200, `expected substantial pushback (>200 chars); got ${result.text.length}`);
  assert.ok(result.text.length < 6000, `bounded output (<6000 chars); got ${result.text.length}`);

  const lower = result.text.toLowerCase();

  // Pushback-shape: at least 3 of these signal words should appear.
  // The specialist prompt itself emphasizes assumption / risk / fail.

  const signals = ['assumption', 'risk', 'fail', 'what if', 'security', 'xss', 'token', 'rollback', 'expire', 'localstorage', 'csrf'];
  const hit = signals.filter((s) => lower.includes(s));
  assert.ok(hit.length >= 3, `expected ≥3 pushback signals; found: ${hit.join(', ')} in response`);

  // Cite a specific element of the proposal (one of the obvious smells).

  const specifics = ['localstorage', '90 day', 'rollback', 'jwt', 'sso', 'oauth'];
  const citedSpecifics = specifics.filter((s) => lower.includes(s));
  assert.ok(citedSpecifics.length >= 2, `expected ≥2 cited specifics from proposal; found: ${citedSpecifics.join(', ')}`);

  console.log(`[reviewer plan-challenge] spent ${llm.totalCents()}¢ over ${llm.callsMade()} call(s) — hit signals: ${hit.join(', ')}`);
});
