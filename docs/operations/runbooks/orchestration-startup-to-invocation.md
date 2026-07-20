# Runbook: Startup to successful orchestration invocation

- **Service**: orchestration readiness + MCP dispatch
- **Owner**: operator
- **Last tested**: 2026-07-20
- **Severity**: SEV-3 (onboarding path; no runtime mutation)

## Goal

Take a fresh Construct project from install through a verified orchestration attachment and one successful `orchestration_run` invocation (or an honest PLAN-only outcome when no provider key is configured).

## Prerequisites

- Construct installed (`npm i -g @geraldmaron/construct` or a local checkout on PATH)
- A git project with `construct init` completed (creates `.construct/`)
- A supported host: Claude Code, OpenCode, Codex, VS Code/Copilot, or Cursor

## Steps

### 1. Install and initialize

```bash
cd /path/to/your-project
construct init
construct doctor
```

Confirm `construct doctor` exits 0. Read the last line for EXECUTE vs PLAN (`specialists will EXECUTE` requires `orchestration.workerBackend=provider` plus a materialized provider key on MCP-only hosts).

### 2. Sync host adapters

```bash
construct sync
```

Project sync writes the Construct front door, MCP config, skills, and hooks under the project. Restart the host session after sync so MCP tools reload.

### 3. Verify orchestration attachment

From the project root:

```bash
construct orchestrate preflight --json
```

Inspect:

- `verdict` / `attached` / `reasonCode` / `nextStep`
- `mttrSummary` (when prior preflight events exist): mean recovery time across fail-to-pass transitions
- `missingTools` (should not include `orchestration_run` once the host session is attached)

If preflight fails with `tool_unlisted` before opening a host, omit `--no-probe` to probe the local MCP server, or pass observed tools from the host session:

```bash
construct orchestrate preflight --observed-tools=orchestration_policy,call --reachable-tools=orchestration_run --json
```

### 4. Configure EXECUTE when needed (MCP-only hosts)

On Codex, VS Code/Copilot, and Cursor, set in `construct.config.json`:

```json
{
  "orchestration": {
    "workerBackend": "provider"
  }
}
```

Export a materialized key in the MCP server environment (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `OPENAI_API_KEY`). Re-run preflight until `workerBackend` and credential fields show EXECUTE-capable values.

Claude Code and OpenCode can EXECUTE through the host session without a provider key.

### 5. Classify, then invoke

**From the host chat (MCP):**

1. Call `orchestration_readiness` (same contract as CLI preflight)
2. Call `orchestration_policy` with the user request and scope estimates
3. When the track is not immediate, call `orchestration_run` with the same request

**From the shell:**

```bash
construct orchestrate run "Summarize the README and list open risks" --json
```

For a remote team service:

```bash
export CONSTRUCT_ORCHESTRATION_URL=https://your-service
export CONSTRUCT_ORCHESTRATION_TOKEN=...
construct orchestrate run "..." --remote --json
```

### 6. Confirm success

- CLI `--json` output shows honest terminal status (`completed`, `completed-prepare-only`, or `degraded`) with a non-empty `specialists` array when specialists were dispatched
- Host backend runs may return `awaiting-host` until the host submits `orchestration_task_result` with `accepted: true`

Poll status:

```bash
construct orchestrate status <runId> --json
```

## Failure recovery

| Symptom | Next action |
|---|---|
| `tool_unlisted` | `construct sync`, restart host, rerun preflight |
| `server_unreachable` | `construct doctor`, verify MCP command path |
| `host_not_attached` | Open the host session in the project directory |
| PLAN-only on MCP host | Set `workerBackend: provider` and a materialized key |
| `awaiting-host` forever | Host must call `orchestration_task_result` for each materialized task |

## References

- `construct-0h5r0` (this runbook)
- `docs/guides/start/connect-your-editor.mdx`
- `lib/orchestration/readiness.mjs`
- `docs/operations/runbooks/host-adapter-certification.md`
