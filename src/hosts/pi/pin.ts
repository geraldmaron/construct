/**
 * hosts/pi/pin.ts — the pinned pi CLI version and the behaviors
 * scripts/probe-pi-conformance.mjs checks against a live binary.
 *
 * "pi" here is the Pi coding agent, package `@earendil-works/pi-coding-agent`
 * (https://pi.dev) — NOT `@mariozechner/pi`, an unrelated package with
 * misleading metadata that points at the same GitHub repo. Verify the
 * installed package name before trusting anything named "pi" on a machine.
 *
 * pi is a probe target, not yet an execution adapter: "goose and pi are probe
 * targets pinned the same way OpenCode is" (STRATEGY). This file carries only
 * the claims a probe can check — spawn mechanics, output shape, exit codes —
 * not a HostAdapter. Building the adapter that dispatches real work to this
 * host is separate, later work; what a caller would need to trust first is
 * written down here.
 *
 * Like goose, pi is not one vendor's CLI: `--provider` and `--model` name any
 * of several dozen backends (subscriptions via OAuth, a long list of API-key
 * providers, and custom OpenAI/Anthropic/Google-compatible endpoints declared
 * in `~/.pi/agent/models.json`). Unlike goose, a fresh install has zero
 * providers configured — there is no ambient default to fall back to, silently
 * or otherwise.
 *
 * When the probe fails: re-verify against the new version, update
 * PINNED_VERSION, and update whichever expectations moved.
 */

import type { ModelTier } from '../../kernel/brief/tiers.ts';

/** The version this pin was verified against. `pi --version` prints one bare semver line. */
export const PINNED_VERSION = '0.84.2';

export interface Expectation {
  readonly name: string;
  readonly claim: string;
}

/**
 * Every behavior the probe checks. Measured on the pinned version, against a
 * local Ollama backend added by hand to `~/.pi/agent/models.json`
 * (`qwen3.5:4b`, zero-cost, so re-verification costs nothing), 2026-08-21.
 */
export const EXPECTATIONS: readonly Expectation[] = [
  {
    name: 'version-flag-reports-the-version',
    claim: '`pi --version` prints a single line: the bare semver, no prefix (e.g. `0.84.2`), then a newline.',
  },
  {
    name: 'print-is-the-documented-non-interactive-entry-point',
    claim:
      '`pi --print/-p "<prompt>" --provider <p> --model <m>` processes the prompt under the default `--mode text` and exits, ' +
      'rather than opening the interactive TUI. (Separately observed but NOT relied on: with `-p` omitted and stdin piped-but-' +
      'empty, pi also ran the prompt and exited cleanly rather than blocking — this is not documented behavior, only `--print` ' +
      'is, so a caller should keep passing it explicitly.)',
  },
  {
    name: 'zero-providers-are-configured-out-of-the-box',
    claim:
      'A fresh install ships an empty `~/.pi/agent/auth.json` and no default provider: `--list-models` reports "No models ' +
      'available" until a provider is authenticated via `/login` or declared in `~/.pi/agent/models.json`. A free/local ' +
      'provider (Ollama) is reached only by hand-authoring a `models.json` custom-provider entry (`api: "openai-completions"`, ' +
      'a `baseUrl`, a placeholder `apiKey`) — never by a bare `--provider ollama` flag alone.',
  },
  {
    name: 'mode-json-emits-ndjson-session-transcript',
    claim:
      '`--mode json` prints one JSON object per line: a leading `session` event carrying the session `id`, then per-turn ' +
      '`agent_start` / `turn_start` / `message_start` / `message_update` / `message_end` / `turn_end` events, closing with ' +
      'an `agent_end` event (carrying the full assembled `messages` array) followed by a terminal `agent_settled` event.',
  },
  {
    name: 'usage-cost-is-locally-computed-not-provider-reported',
    claim:
      'Every assistant message carries `usage: { input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost: { input, ' +
      'output, cacheRead, cacheWrite, total } }`. `cost` is calculated by pi from the per-token rates configured for that ' +
      'model (`models.json`\'s `cost` field, defaulting to all-zero when unset) — not a figure the provider returns. A ' +
      'locally-configured model with no rate set therefore reads as exactly free, identically to a genuinely free one.',
  },
  {
    name: 'unknown-model-is-forwarded-not-refused',
    claim:
      'An unrecognised `--model` value is NOT rejected client-side: pi prints `Warning: Model "<name>" not found for ' +
      'provider "<provider>". Using custom model id.` and still places the request. The failure, when there is one, comes ' +
      'from the provider — the inverse of codex/cursor\'s client-side refusal.',
  },
  {
    name: 'failed-turn-exits-nonzero-stdout-stays-clean',
    claim:
      'On a request the backend refuses (measured: the 404 from unknown-model-is-forwarded-not-refused), pi exits 1; the ' +
      'warning and the error detail both print to stderr, and stdout is empty. Contrast with goose, where the equivalent ' +
      'failure exits 0 with the error folded into ordinary assistant-role text.',
  },
  {
    name: 'tools-are-on-by-default',
    claim:
      'With no `--tools` / `--no-tools` / `--no-builtin-tools` flag, a coding-shaped local model may reach for the bash tool ' +
      'even on a trivial one-line prompt (measured: asked to reply "pong", `qwen3.5:4b` ran `echo \'pong\'` via the bash tool ' +
      'before also replying with text). A caller wanting a read-only or no-tool probe must pass one of those flags.',
  },
  {
    name: 'session-persists-by-default-keyed-by-cwd',
    claim:
      'pi writes a session file under `~/.pi/agent/sessions/<encoded-cwd>/` by default, keyed to the invoking working ' +
      'directory. `--no-session` suppresses that write entirely (verified: the session directory\'s file count was unchanged ' +
      'after a `--no-session` run).',
  },
  {
    name: 'rpc-mode-is-not-a-one-shot-json-mode',
    claim:
      '`--mode rpc` combined with `--print` and a positional prompt produced no output at all on either stream and exited 0 ' +
      '— it expects an RPC client driving it over stdin, not a single argv prompt, so it is not a substitute for `--mode json` ' +
      'in a probe or a spawn-and-collect adapter.',
  },
];

/**
 * Which of the models reachable through this host sit at which capability
 * tier. Beside the pin because it is a claim about the outside world that
 * rots silently; the kernel compares ordinals and never learns these names.
 *
 * Keyed as `provider/model`, matching how `--provider` and `--model` are
 * passed as two flags. pi is the most multi-vendor of the four hosts pinned
 * in this repo (dozens of built-in providers plus arbitrary custom ones), so
 * this table stays deliberately small and defensible; an unrecognised model
 * answers null rather than a guess.
 */
const PI_TIERS: readonly { readonly match: RegExp; readonly tier: ModelTier }[] = [
  { match: /^ollama\//i, tier: 'any' },
  { match: /^anthropic\/claude-(fable|opus)/i, tier: 'frontier' },
  { match: /^anthropic\/claude-(sonnet|haiku)/i, tier: 'capable' },
  { match: /^(openai|azure-openai-responses)\/gpt-5[^\s]*-(mini|nano)/i, tier: 'capable' },
  { match: /^(openai|azure-openai-responses)\/gpt-5/i, tier: 'frontier' },
];

/** The tier of a `provider/model` string, or null when this pin does not recognise it. */
export function tierOfModel(model: string | undefined | null): ModelTier | null {
  if (!model) return null;
  return PI_TIERS.find((entry) => entry.match.test(model))?.tier ?? null;
}
