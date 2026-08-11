/**
 * hosts/codex/pin.ts — the Codex CLI version this adapter is written against
 * and every behavior it depends on, each one a named expectation the probe
 * (`npm run probe:codex`) re-verifies against a live binary.
 *
 * Why this host exists at all: `codex login status` on a machine signed in
 * through ChatGPT answers "Logged in using ChatGPT" — the binary spends the
 * user's subscription, not an API key. Construct ships no runtime (commitment
 * 1), so subscription capacity becomes dispatchable exactly here: through the
 * vendor's own CLI, authenticated however the user already authenticated it.
 *
 * When the probe fails: re-verify against the new version, update
 * PINNED_VERSION, and update whichever expectations moved.
 */

import type { ModelTier } from '../../kernel/brief/tiers.ts';

/**
 * The version this adapter was verified against end to end.
 * `codex --version` prints exactly one line in `codex-cli <semver>` form.
 */
export const PINNED_VERSION = 'codex-cli 0.145.0';

export interface Expectation {
  readonly name: string;
  readonly claim: string;
}

/**
 * Every behavior the adapter depends on, written as claims the probe checks.
 * All were measured on the pinned version, on a ChatGPT-subscription login,
 * on the dates the claims mention.
 */
export const EXPECTATIONS: readonly Expectation[] = [
  {
    name: 'version-flag-reports-the-version',
    claim: '`codex --version` prints a single line: `codex-cli <semver>`.',
  },
  {
    name: 'login-status-is-non-interactive',
    claim:
      '`codex login status` exits 0 without prompting and names the auth ' +
      'method (measured: "Logged in using ChatGPT", printed on stderr).',
  },
  {
    name: 'exec-json-emits-jsonl-events',
    claim:
      '`codex exec --json <prompt>` prints one JSON object per line: ' +
      '`thread.started` (with `thread_id`), `turn.started`, `item.completed` ' +
      '(whose `item.type` "agent_message" carries the reply text), and ' +
      '`turn.completed` (with a `usage` object of token counts).',
  },
  {
    name: 'usage-counts-tokens-not-dollars',
    claim:
      '`turn.completed.usage` reports input_tokens, cached_input_tokens, ' +
      'cache_write_input_tokens, output_tokens, reasoning_output_tokens — ' +
      'and no cost field. Subscription spend is not meterable per run, so ' +
      'cost is honestly unmeasured on this host, never zero.',
  },
  {
    name: 'failed-turn-exits-nonzero',
    claim:
      'A turn that fails emits `turn.failed` with an error message and the ' +
      'process exits 1 (measured via an unsupported model name). Exit 0 with ' +
      'no agent_message is therefore format drift, not a failed run.',
  },
  {
    name: 'unknown-model-fails-hard',
    claim:
      'An unrecognised `-m` name is rejected by the backend (HTTP 400 relayed ' +
      'in `turn.failed`) rather than silently served by a default model. The ' +
      'inverse of the Claude host\'s silent-fallback hazard: what ran is what ' +
      'was requested, or nothing ran.',
  },
  {
    name: 'events-never-name-the-model',
    claim:
      'No JSONL event names the model that served the turn, so modelRan is ' +
      'honestly empty unless the request named one — in which case ' +
      'unknown-model-fails-hard makes the request itself the evidence.',
  },
  {
    name: 'stdin-must-stay-closed',
    claim:
      'With stdin piped, `codex exec` reads it and appends a `<stdin>` block ' +
      'to the prompt ("Reading additional input from stdin..."), so the ' +
      'adapter spawns with stdin ignored.',
  },
  {
    name: 'isolation-flags-hold',
    claim:
      '`--ephemeral` persists no session files, `--ignore-user-config` skips ' +
      '~/.codex/config.toml while auth still resolves through CODEX_HOME, ' +
      '`--skip-git-repo-check` permits non-repo working dirs, and ' +
      '`-s read-only` denies writes from model-run commands.',
  },
  {
    name: 'output-last-message-writes-the-reply',
    claim:
      '`-o <file>` writes exactly the final agent message text, which the ' +
      'adapter prefers over reassembling it from events when both exist.',
  },
];

/**
 * Which of the models reachable through this host sit at which capability
 * tier. Beside the pin because it is a claim about the outside world that
 * rots silently; the kernel compares ordinals and never learns these names.
 *
 * Unlike the Claude host, an unknown name cannot run at all (see
 * unknown-model-fails-hard), so null here means "will be refused", not
 * "will silently run something else".
 */
const CODEX_TIERS: readonly { readonly match: RegExp; readonly tier: ModelTier }[] = [
  { match: /^gpt-5[^\s]*-(mini|nano)/i, tier: 'capable' },
  { match: /^gpt-5/i, tier: 'frontier' },
];

/** The tier of a model name, or null when this pin does not recognise it. */
export function tierOfModel(model: string | undefined | null): ModelTier | null {
  if (!model) return null;
  return CODEX_TIERS.find((entry) => entry.match.test(model))?.tier ?? null;
}
