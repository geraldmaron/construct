<!--
tests/helpers/README.md — Supported test helpers for host-config isolation.

Documents the sterile host sandbox (sterile-host-env.mjs), the suite-level
fingerprint guard wired into scripts/run-tests.mjs, the git-repo sandbox, and the
Ollama recording proxy. Read before writing any test that touches HOME, the
OpenCode config, Claude settings, or the Ollama model store.
-->

# Test helpers

## `sterile-host-env.mjs` — sterile host sandbox (supported helper)

Tests that exercise `construct sync`, OpenCode config writes, or Ollama
provisioning mutate **real user state** — `~/.config/opencode/opencode.json`,
`~/.claude/settings.json`, `~/.claude.json` (Claude Code's user-scope MCP
servers), the Ollama model store. The local-model investigation
(bead `construct-k6fu`) polluted the live `opencode.json` and created real Ollama
variants because its harness ran against the real machine. This helper exists so
that can never happen again.

It is the standard lightweight alternative to a full VM/container for config
tests: **hermetic env isolation (XDG base-dir spec) + CLI stubbing + a footprint
diff.**

### `createHostSandbox({ ollamaModels, stubOllama })`

Returns `{ root, env, ollamaStateFile, cleanup }`. Redirects every host path into
a temp root via `HOME` + the XDG base-dir variables (`XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`) + `OLLAMA_MODELS`, and (when
`stubOllama`, the default) puts a deterministic node `ollama` stub first on
`PATH`. The stub emits the exact text shapes `lib/ollama/provision-context.mjs`
parses (`list` table; `show` Model/Capabilities/Parameters blocks) and records
`create` into `ollamaStateFile` — so provisioning logic runs end to end without
reaching the real daemon. Pass `env` to `spawnSync`/`execFileSync` so the child
reads and writes only inside the sandbox.

```js
const sandbox = createHostSandbox({
  ollamaModels: [{ name: "qwen2.5-coder:7b", params: "7.6B", trainedCtx: 32768, tools: true, numCtx: null }],
});
try {
  const r = spawnSync(process.execPath, ["lib/ollama/provision-context.mjs", "--num-ctx=32768"], {
    env: sandbox.env, encoding: "utf8",
  });
  // assert against r.stdout and the sandbox state file
} finally {
  sandbox.cleanup();
}
```

### `fingerprintRealConfigs()` / `assertRealConfigsUnchanged(before)`

Hash the real protected paths plus the durable Ollama model set (sorted names —
`ollama list`'s SIZE/MODIFIED columns are volatile and would flap). Take a
fingerprint before a test, assert it unchanged after; a drift throws
`Sterile violation — real host config changed: <path>`. The suite runner
(`scripts/run-tests.mjs`) wraps the **entire** `node --test` run in this guard,
so any test that leaks a write into real host config fails the whole run with the
drifted path named — no per-test annotation required.

### Live `opencode run` is opt-in

Driving `opencode run` headlessly under a fresh sterile `HOME` stalls (first-run
migration + `.env.op` resolution), so the live A/B harness
(`tests/e2e/local-model-ab.mjs`) is **not** part of `npm test` — it has no
`.test.mjs` suffix, is run by hand, and deliberately uses the real `HOME` because
that is the only path that boots `opencode run` reliably. The unit path that the
suite *does* run (`tests/capabilities/orchestration.routing/opencode.test.mjs`)
needs neither Ollama nor an LLM: it drives the real config writer and Modelfile
builder over a temp file and pure functions.

## `sterile-env.mjs` — git-repo sandbox

Older helper: a fresh git repo + neutralized AI env vars for tests that need an
isolated project directory but not the full host-config fingerprint guard.

## `ollama-record-proxy.mjs` — recording reverse-proxy

Sits between OpenCode and Ollama (point the provider `baseURL` at it), forwards
to real Ollama, and measures the outbound payload: tool count, system-prompt and
total input token estimates, and which sampler params survive the `/v1`
boundary. Used by the opt-in A/B harness to quantify what reaches the model.
