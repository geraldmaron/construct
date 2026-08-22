/**
 * hosts/goose/pin.ts — the pinned goose CLI version and the behaviors
 * scripts/probe-goose-conformance.mjs checks against a live binary.
 *
 * goose is a probe target, not yet an execution adapter: "goose and pi are
 * probe targets pinned the way OpenCode is" (STRATEGY). This file
 * carries only the claims a probe can check — spawn mechanics, output shape,
 * exit codes — not a HostAdapter. Building the adapter that dispatches real
 * work to this host is separate, later work; what a caller would need to
 * trust first is written down here.
 *
 * goose differs from the codex and cursor probe targets in one load-bearing
 * way: it is not one vendor's CLI over one vendor's subscription. `--provider`
 * and `--model` name any of a dozen backends (openai, anthropic, ollama,
 * databricks, gemini-cli, claude-code, and more — including other
 * coding-agent CLIs shelled out to as "providers": on the machine this pin
 * was measured on, `goose configure` had already set `active_provider:
 * cursor-agent`). The probe always names both flags explicitly and never
 * dispatches through whatever a machine's config.yaml happens to default to.
 *
 * When the probe fails: re-verify against the new version, update
 * PINNED_VERSION, and update whichever expectations moved.
 */

import type { ModelTier } from '../../kernel/brief/tiers.ts';

/**
 * The version this pin was verified against. `goose --version` prints a
 * leading space before the semver, then a newline; PINNED_VERSION holds the
 * trimmed form, which is what the probe compares against.
 */
export const PINNED_VERSION = '1.46.0';

export interface Expectation {
  readonly name: string;
  readonly claim: string;
}

/**
 * Every behavior the probe checks. The full set was measured on the pinned
 * version against a local Ollama backend (`qwen3.5:4b`, zero-cost, so
 * re-verification costs nothing), 2026-08-21. The same date, the probe's
 * subscription-backed default (claude-code, per CLAUDE.md's sourcing rule —
 * `claude-code/claude-sonnet-5`, goose 1.46.0) was also run against all eight:
 * six held unchanged, and two — `a-failed-model-call-exits-0-and-reads-as-success`
 * and `no-session-skips-the-shared-session-store-but-not-the-request-log` —
 * diverge by provider. Those two claims state both providers' measured
 * behavior explicitly; the other six are not restated per-provider because
 * both runs agreed.
 */
export const EXPECTATIONS: readonly Expectation[] = [
  {
    name: 'version-flag-reports-the-version',
    claim: '`goose --version` prints a single line: a leading space, then the semver, then a newline. Compare trimmed.',
  },
  {
    name: 'run-accepts-a-prompt-non-interactively',
    claim:
      '`goose run -t "<text>" --no-session --quiet --provider <p> --model <m>` processes the prompt and exits without opening ' +
      'a session REPL; `-i <file>` (or `-i -` for stdin) is the file/stdin equivalent of `-t`.',
  },
  {
    name: 'explicit-provider-and-model-flags-override-a-configured-default',
    claim:
      '`--provider` and `--model` are separate flags, not a combined string. Omitting both falls back to `active_provider` / ' +
      '`GOOSE_PROVIDER` / `GOOSE_MODEL` from `~/.config/goose/config.yaml` — measured falling back to a DIFFERENT coding-agent ' +
      'CLI (`cursor-agent`, itself shelled out to as a "provider") on the machine this pin was written on. A caller that omits ' +
      'either flag does not fail; it silently dispatches through whatever the operator configured last.',
  },
  {
    name: 'quiet-is-required-for-clean-stdout-in-every-format',
    claim:
      'Without `--quiet`, an ASCII banner and a session-id line print to stdout ahead of the reply in the default `text` ' +
      'format, AND ahead of the JSON object under `--output-format json` — corrupting it as parseable JSON. `--quiet` is what ' +
      'suppresses that decoration; `--output-format json` alone does not.',
  },
  {
    name: 'output-format-json-is-one-object-not-ndjson',
    claim:
      '`--output-format json` prints exactly one JSON object to stdout (not line-delimited): `{ messages: [...], metadata: ' +
      '{...} }`. The reply is the last `content[].text` of the last `role:"assistant"` entry in `messages`.',
  },
  {
    name: 'usage-is-token-counts-only-no-cost-field',
    claim:
      'The top-level `metadata` object carries `total_tokens`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, ' +
      '`cache_write_input_tokens`, and `status`. There is no cost field at all, on any provider measured — cost accounting is ' +
      'not this host\'s job.',
  },
  {
    name: 'a-failed-model-call-exits-0-and-reads-as-success',
    claim:
      'Whether an unrecognised `--model` value produces a visible error depends on provider. Against ollama (measured ' +
      '2026-08-21: an unrecognised model tag, a 404), the request is caught and turned into an ordinary ' +
      '`role:"assistant"` text message reading "Ran into this error: …" — the process exits 0, `metadata.status` still ' +
      'reads "completed", and token counts read 0; nothing in the exit code or the JSON\'s structure distinguishes this ' +
      'from a real answer, only the assistant text does, and only by prose pattern-matching. Against claude-code ' +
      '(measured 2026-08-21, goose 1.46.0, requesting the deliberately-bogus model name ' +
      '`construct-probe-nonexistent-model`): goose does NOT reproduce that error text at all. The shelled-out `claude` ' +
      'CLI does not validate `--model` the way ollama\'s tag lookup does, so goose replies as if the call succeeded — ' +
      'exit 0, `metadata.status` "completed", ordinary assistant text, nonzero token counts. A caller cannot use this ' +
      'behavior to detect a bad `--model` value under claude-code; the error-text pattern-match only fires under ollama.',
  },
  {
    name: 'no-session-skips-the-shared-session-store-but-not-the-request-log',
    claim:
      'Each `goose run` writes a row (session id, working directory) into a single shared ' +
      '`~/.local/share/goose/sessions/sessions.db` unless `--no-session` is passed, which suppresses that write, on every ' +
      'provider measured. Whether `--no-session` also leaves the separate, always-on request log at ' +
      '`~/.local/state/goose/logs/llm_request.*.jsonl` untouched depends on provider. Against ollama (measured ' +
      '2026-08-21): that log stays active regardless of `--no-session` or `--quiet`, recording full request/response ' +
      'payloads — its mtime advances on every call. Against claude-code (measured 2026-08-21, goose 1.46.0): the log\'s ' +
      'mtime did NOT advance across any call in the run; the shelled-out `claude` CLI execution does not write to ' +
      'goose\'s own request log the way its native HTTP-backed providers do. A caller cannot use this log\'s freshness as ' +
      'a signal of request activity under claude-code.',
  },
];

/**
 * Which of the models reachable through this host sit at which capability
 * tier. Beside the pin because it is a claim about the outside world that
 * rots silently; the kernel compares ordinals and never learns these names.
 *
 * Keyed as `provider/model`, matching how `--provider` and `--model` are
 * passed as two flags (unlike cursor's self-describing catalog names). Goose
 * can also shell out to other agent CLIs as a "provider" (`cursor-agent`,
 * `claude-code`, `gemini-cli`); those name no model of their own in a form
 * this table can score, so they resolve to null — "unknown," not "any."
 */
const GOOSE_TIERS: readonly { readonly match: RegExp; readonly tier: ModelTier }[] = [
  { match: /^ollama\//i, tier: 'any' },
  { match: /^anthropic\/claude-(fable|opus)/i, tier: 'frontier' },
  { match: /^anthropic\/claude-(sonnet|haiku)/i, tier: 'capable' },
  { match: /^openai\/gpt-5[^\s]*-(mini|nano)/i, tier: 'capable' },
  { match: /^openai\/gpt-5/i, tier: 'frontier' },
];

/** The tier of a `provider/model` string, or null when this pin does not recognise it. */
export function tierOfModel(model: string | undefined | null): ModelTier | null {
  if (!model) return null;
  return GOOSE_TIERS.find((entry) => entry.match.test(model))?.tier ?? null;
}
