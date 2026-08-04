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
  {
    name: 'mcp-config-is-read-from-a-path',
    claim:
      '`--mcp-config <path>` accepts a FILE PATH to a JSON document with an ' +
      '`mcpServers` map, launches each `type: "stdio"` entry with its `command`, ' +
      '`args` and `env`, and the launched server can serve tools/list and ' +
      'tools/call. The path form is what the adapter depends on: inline JSON is ' +
      'also accepted and must never be used, because argv is ps-visible and the ' +
      'role bearer travels in that env block.',
  },
  {
    name: 'mcp-config-flag-is-variadic',
    claim:
      '`--mcp-config` consumes EVERY following non-flag argument as another ' +
      'config path. Measured on the pinned version: `--mcp-config m.json mcp ' +
      'list` failed with "MCP config file not found: .../mcp" and ".../list". ' +
      'So the path must be followed immediately by another flag — which is why ' +
      'mcpArgsFor puts --strict-mcp-config next and never emits a bare ' +
      'positional after it. Getting this wrong swallows the prompt.',
  },
  {
    name: 'strict-mcp-config-excludes-the-users-own-servers',
    claim:
      '`--strict-mcp-config` makes the run use ONLY the servers in --mcp-config, ' +
      'ignoring the user and project MCP configuration. Without it a role would ' +
      'inherit whatever write surfaces the operator happens to have registered, ' +
      'and its authority is supposed to be exactly two writes. Probed indirectly: ' +
      'the result envelope carries NO server list on the pinned version (measured: ' +
      'its keys are type, subtype, is_error, ..., permission_denials, and there is ' +
      'no mcp_servers), and `claude mcp list` reports saved configuration rather ' +
      "than the run's, so neither is an observable. What the probe measures instead " +
      'is the tool surface that actually reached the model, by asking it to ' +
      'enumerate its tools: no `mcp__` name outside this config may appear. That is ' +
      "weaker than reading the host's own register and is recorded as weaker.",
  },
  {
    name: 'mcp-tool-names-are-namespaced',
    claim:
      'A tool named `submit_draft` on a server named `construct` reaches the ' +
      'model as `mcp__construct__submit_draft`, and that is the spelling ' +
      '`--allowedTools` matches. Measured on the pinned version: the model ' +
      'called it and the draft landed in the store attributed to the role.',
  },
  {
    name: 'bearer-appears-in-no-host-transcript',
    claim:
      'After a run whose MCP server env carried CONSTRUCT_ROLE_TOKEN, the bearer ' +
      'string appears in no file under the host session store (~/.claude/projects), ' +
      'not in the result envelope, and not in argv. Measured on the pinned ' +
      'version: zero hits. This is the whole reason the token goes through a ' +
      '0600 config file rather than the command line, so the probe greps for it ' +
      'rather than assuming.',
  },
];
