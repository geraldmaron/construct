# Runbook: Surface Smoke Matrix (orchestration standing gate)

- **Service**: Construct orchestration (`orchestration_run`) across host surfaces
- **Owner**: operator
- **Last tested**: 2026-07-04
- **Severity**: SEV-2 (a red gate blocks release; it is a regression, not routine noise)

## What this gate proves

`tests/functional/surface-smoke-matrix.functional.test.mjs` drives a real
research request through the real entrypoint for every host surface Construct
ships an adapter for, and asserts on the **persisted run record** rather than
a return value:

- `run.execution.degraded === false`
- `run.execution.executionMode === 'construct-orchestrated'`
- `run.tasks` is non-empty
- the surface's own envelope (CLI `--json` stdout, or the MCP tool result)
  agrees with the on-disk record — no bare `'completed'` claim over a
  degraded run

It exists because incident `run-02158a157d53` showed readiness/preflight
passing while every run silently degraded to `construct-prompt-only` with
zero tasks, reported as a plain `completed`. A per-surface gate that reads the
durable run record (not the in-memory return value) catches that class of
defect even if one surface's adapter code diverges from another's.

## Surfaces covered

| Surface id | Real entrypoint driven | Notes |
|---|---|---|
| `cli` | `node bin/construct orchestrate run "<request>" --json` | Spawns the real binary. |
| `claude-code-mcp` | `lib/mcp/server.mjs` over stdio (`orchestration_run` tool) | Real `StdioClientTransport`, no daemon. |
| `vscode-mcp` | `lib/mcp/server.mjs` over stdio (`orchestration_run` tool) | Identical transport to `claude-code-mcp` — this codebase does not ship a separate per-host MCP server, so the two cells exercise the same code path under different labels. If a host-specific server is ever introduced, split this cell and point it at that server. |
| `hooks-session-start` | `lib/hooks/session-start.mjs` (stdin payload) chained into the CLI | `session-start.mjs` is a context-injection preamble — it reports an orchestration-readiness banner but carries no `orchestration_run` call itself (verified: no `request`/orchestration invocation in the hook source). This cell first asserts the hook exits 0 and surfaces the readiness banner, then drives the CLI on the identical env/cwd the hook established, proving a hook-started session can actually execute — not just report on itself. |

## Hermeticity

Every cell spawns its entrypoint through `sterileSpawnEnv()`
(`tests/helpers/sterile-env.mjs`, construct-neq9.4): HOME/XDG are pinned to a
fresh `mkdtempSync` root and nothing outside an explicit allowlist is
inherited from the runner's ambient env. The final test in the file
(`a poisoned parent env cannot mask a degraded cell`) poisons
`CONSTRUCT_MODEL_REASONING/STANDARD/FAST` in the real parent process and re-runs the
CLI cell, asserting the result is unchanged — proving the allowlist is
actually applied here, not just documented.

## Scope boundary: what this gate does NOT prove today

The stricter bar in construct-neq9.8's original spec — every task reaching
`status: 'done'` with real non-empty specialist output, and the researcher
task showing `webEvidence`/`webSearchRequests > 0` — requires the **provider**
worker backend, which calls hardcoded provider URLs
(`https://api.anthropic.com/...`, `https://openrouter.ai/...` in
`lib/orchestration/worker.mjs`) with no environment-configurable base URL.
That means:

- A real spawned subprocess (CLI or MCP-stdio child) cannot have its provider
  call redirected to a local mock the way `WEB_SEARCH_URL` already allows for
  web search — there is no `fetchImpl` to inject across a process boundary.
- Proving `done`/real-output/`webEvidence>0` on a real spawned surface
  therefore requires either live provider credentials (the repo's existing
  `CONSTRUCT_CERTIFY_LIVE=1` opt-in, see
  `tests/functional/real-llm-scenarios.functional.test.mjs`) or a production
  change adding an env-configurable provider base URL — out of scope for a
  test-only change.

This gate covers the `inline` worker backend by design: it proves the run is
non-degraded, orchestrated, and plans real tasks — the exact shape of the
incident this gate exists to catch — without requiring live credentials in
CI. If a fully-hermetic `done`/output/web-evidence proof is wanted without
live keys, file a follow-up to add a provider base-URL override to
`lib/orchestration/worker.mjs` (mirroring the existing `WEB_SEARCH_URL`
pattern) and extend this matrix's live-gated cell.

## Diagnostic steps

```mermaid
flowchart TD
  A[Gate red] --> B{Which surface(s) failed?}
  B -->|one| C[Diff that surface's envelope vs the on-disk run record]
  B -->|all| D[Check lib/embedded-contract/execution.mjs and lib/orchestration/runtime.mjs for a shared regression]
  C --> E{degraded true or tasks empty?}
  E -->|yes| F[Model resolution regressed — check resolveEmbeddedModel/resolveExecution]
  E -->|no, envelope mismatch| G[Envelope/disk parity bug — check the surface adapter, not the runtime]
```

1. Run the single failing cell directly for a fast loop:
   ```bash
   node --test tests/functional/surface-smoke-matrix.functional.test.mjs
   ```
2. If every surface fails identically, the regression is almost certainly in
   the shared runtime (`lib/orchestration/runtime.mjs`,
   `lib/embedded-contract/execution.mjs`), not a per-adapter bug.
3. If only one MCP-labeled surface fails while the other passes, that is a
   contradiction under the current architecture (both share
   `lib/mcp/server.mjs`) — check for a recently introduced host-specific
   branch.
4. Check the poisoned-parent-env test first if the failure is intermittent —
   an intermittent failure is a strong signal that `sterileSpawnEnv()`'s
   allowlist is not actually being applied at some call site.

## Remediation

- Model-resolution regression: fix `lib/embedded-contract/model-resolve.mjs` /
  `execution.mjs` so `resolveEmbeddedModel` resolves the tier again, then
  re-run this gate.
- Envelope/disk parity regression: fix the adapter (CLI command handler or
  the `orchestration_run` MCP tool) that shapes the envelope so it reflects
  `run.execution.degraded` faithfully — never hand-roll a separate
  `completed` status.
- Hermeticity regression (poisoned-env test fails): fix the spawn env
  construction to route through `sterileSpawnEnv()` instead of
  `{ ...process.env }`.

## Wiring

Run as part of the functional suite (`npm run test:functional`) and the
standing release gate:

```bash
node --test tests/functional/surface-smoke-matrix.functional.test.mjs
```

## References

- construct-neq9.8 (this gate), construct-neq9.4 (hermetic spawn envs),
  construct-neq9.2/.3 (fixture matrix and readiness parity this gate builds on)
- Incident run-02158a157d53
- `tests/functional/host-mcp-emulation.functional.test.mjs` (the MCP-stdio
  harness this matrix's MCP cells extend)
- `tests/functional/orchestration-mode-a.functional.test.mjs` (the CLI harness
  this matrix's CLI cell extends)
