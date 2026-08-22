/**
 * hosts/cursor/pin.ts — the Cursor CLI version this adapter is written
 * against and every behavior it depends on, each one a named expectation the
 * probe (`npm run probe:cursor`) re-verifies against a live binary.
 *
 * Subscription capacity, like the Codex host: `cursor-agent status` answers
 * with the signed-in Cursor account, and dispatch spends whatever plan that
 * account carries. What makes this host distinct is its catalog: one binary
 * serves many vendors' families (claude, gpt, gemini, kimi, grok and more via
 * `--list-models`), so family membership is a fact about the *named model*,
 * never about the host — and an unnamed model resolves to no family at all
 * rather than to a guess.
 *
 * When the probe fails: re-verify against the new version, update
 * PINNED_VERSION, and update whichever expectations moved.
 */

import type { ModelTier } from '../../kernel/brief/tiers.ts';

/**
 * The version this adapter was verified against end to end.
 * `cursor-agent --version` prints one line of date-stamped build id.
 */
export const PINNED_VERSION = '2026.08.11-e8db854';

export interface Expectation {
  readonly name: string;
  readonly claim: string;
}

/** Measured on the pinned version, on a Cursor subscription login, 2026-08-11. */
export const EXPECTATIONS: readonly Expectation[] = [
  {
    name: 'version-flag-reports-the-version',
    claim: '`cursor-agent --version` prints a single date-stamped build line, e.g. `2026.08.11-e8db854`.',
  },
  {
    name: 'status-is-non-interactive',
    claim:
      '`cursor-agent status` exits 0 without prompting and names the ' +
      'signed-in account; signed out it exits nonzero saying "Not logged in".',
  },
  {
    name: 'print-json-emits-one-envelope',
    claim:
      '`cursor-agent -p --output-format json <prompt>` prints a single JSON ' +
      'envelope: type "result", subtype "success", is_error, the reply under ' +
      '`result`, `session_id`, and a `usage` object of camelCase token counts.',
  },
  {
    name: 'usage-counts-tokens-not-dollars',
    claim:
      '`usage` reports inputTokens, outputTokens, cacheReadTokens, ' +
      'cacheWriteTokens and no cost field: subscription spend is honestly ' +
      'unmeasured on this host, never zero.',
  },
  {
    name: 'workspace-trust-gates-headless-runs',
    claim:
      'In an untrusted directory a `-p` run exits 1 asking for workspace ' +
      'trust instead of running; `--trust` grants it for the invocation, so ' +
      'the adapter passes `--trust` and confines the workspace to the task dir.',
  },
  {
    name: 'unknown-model-fails-hard',
    claim:
      'An unrecognised `--model` name is refused (exit 1, the catalog echoed ' +
      'back) rather than silently served by a default: what ran is what was ' +
      'requested, or nothing ran.',
  },
  {
    name: 'envelope-never-names-the-model',
    claim:
      'Under `--output-format json` — what the adapter uses — the result envelope does not name the model that served it, ' +
      'so modelRan is honestly empty unless the request named one — in which case unknown-model-fails-hard makes the ' +
      'request itself the evidence. NOT true of every format: measured on the pinned version, `--output-format ' +
      'stream-json`\'s `system`/`init` event carries a `model` field naming the resolved model directly — "Auto" with no ' +
      '`--model` given, a concrete resolved name like "GPT-5.1 Medium" when one is. The adapter does not use stream-json ' +
      'today; if dispatch ever adopts it, re-read this expectation before trusting an empty modelRan.',
  },
  {
    name: 'catalog-is-multi-vendor',
    claim:
      '`cursor-agent --list-models` names models from several vendors ' +
      '(claude, gpt, gemini and others), so family membership is resolved ' +
      'per named model and an unnamed model belongs to no family.',
  },
  {
    name: 'plan-mode-is-read-only',
    claim:
      '`--mode plan` denies writes from the dispatched agent: asked to ' +
      'create a file, it proposes instead and no file appears. The adapter ' +
      'dispatches in plan mode because a review role must not have the ' +
      '`-p` default of full write-and-shell access.',
  },
];

/**
 * Which of the models reachable through this host sit at which capability
 * tier. Multi-vendor, so the table carries the families with defensible
 * entries and answers null for the rest — and null means "no tier claim",
 * which degrades a declared floor rather than satisfying it.
 */
const CURSOR_TIERS: readonly { readonly match: RegExp; readonly tier: ModelTier }[] = [
  { match: /^claude-(fable|opus)|^claude-4\.\d+-opus/i, tier: 'frontier' },
  { match: /^claude-.*sonnet|^claude-sonnet/i, tier: 'capable' },
  { match: /^claude-.*haiku/i, tier: 'capable' },
  { match: /^gpt-5[^\s]*-(mini|nano)/i, tier: 'capable' },
  { match: /^gpt-5/i, tier: 'frontier' },
];

/** The tier of a model name, or null when this pin does not recognise it. */
export function tierOfModel(model: string | undefined | null): ModelTier | null {
  if (!model) return null;
  return CURSOR_TIERS.find((entry) => entry.match.test(model))?.tier ?? null;
}
