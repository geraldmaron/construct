/**
 * hosts/claude/pin.ts — the Claude Code CLI version this adapter is written
 * against, and every behavior it depends on, written down as named
 * expectations. Same discipline as hosts/opencode/pin.ts: a host upgrade must
 * fail loudly at the probe, not silently at a run.
 *
 * The Claude Agent SDK and the `claude` binary are the same runtime; the
 * adapter shells out to the binary (`claude -p --output-format json`) rather
 * than importing the SDK package, because the repo ships zero dependencies and
 * the binary is the surface the SDK itself wraps.
 *
 * Probing costs real money on this host — there is no free local model. The
 * probe script keeps it to one haiku one-liner (about $0.02) and puts the
 * expensive expectation behind an explicit flag.
 */

export const PINNED_VERSION = '2.1.216 (Claude Code)';

export interface Expectation {
  readonly name: string;
  readonly claim: string;
}

export const EXPECTATIONS: readonly Expectation[] = [
  {
    name: 'version-flag-reports-the-version',
    claim: '`claude --version` prints a single line naming the version.',
  },
  {
    name: 'result-envelope-is-one-json-object',
    claim:
      '`claude -p --output-format json` writes exactly one JSON object to stdout: ' +
      'type "result", with the text under `result`, the run id under `session_id`.',
  },
  {
    name: 'cost-is-reported-in-total-cost-usd',
    claim:
      'The envelope carries `total_cost_usd` as a number and `num_turns` as a ' +
      'positive count — so the spend ceiling genuinely binds on this host, ' +
      'unlike a local model that reports zero out of zero measurements.',
  },
  {
    name: 'model-usage-names-the-model-that-ran',
    claim: 'The envelope `modelUsage` keys name the model(s) that actually served the run.',
  },
  {
    name: 'an-unknown-model-runs-the-default-silently',
    claim:
      'Passing `--model no-such-model-xyz` does NOT fail. Measured on the pinned ' +
      'version: the run succeeded on claude-opus-4-8 — the session default — at ' +
      'thirteen times the cost of the haiku run requested alongside it. The flag ' +
      'is a preference, not a constraint, and the adapter must therefore verify ' +
      'the model that ran and surface drift, because a typo becomes a silent ' +
      'upgrade to the most expensive tier. This expectation costs real money to ' +
      'probe (the fallback run bills at the default model), so the probe only ' +
      'checks it under --spend-fallback.',
  },
  {
    name: 'success-sets-exit-zero-and-is-error-false',
    claim: 'A completed run exits 0 with `is_error: false` and subtype "success".',
  },
];
