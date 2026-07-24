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

Worker Profiles execute real LLM reasoning only when both conditions are met:
1. `orchestration.workerBackend` is set to `"provider"`
2. A valid API key is available for the configured provider

#### 4a. Set the worker backend

In `construct.config.json`, set the orchestration worker backend:

```json
{
  "orchestration": {
    "workerBackend": "provider"
  }
}
```

Valid values: `"inline"` (planning-only, default), `"provider"` (executes via LLM API), `"host"` (host-managed execution).

#### 4b. Configure the API key

Set the appropriate environment variable for your LLM provider:

- **Anthropic**: `export ANTHROPIC_API_KEY="sk-ant-..."`
- **OpenRouter**: `export OPENROUTER_API_KEY="sk-or-..."`
- **OpenAI**: `export OPENAI_API_KEY="sk-..."`

Alternatively, use `construct models --apply` to store and manage credentials securely.

#### 4c. Verify EXECUTE is enabled

Re-run preflight and confirm the status shows EXECUTE-capable values:

```bash
construct orchestrate preflight --json | grep -E "workerBackend|hasAnthropicKey|hasOpenRouterKey|hasOpenAiKey"
```

Or check the doctor output:
```bash
construct doctor
```

Should show: `Worker Profiles will EXECUTE (provider <name> + key found)`

**Note**: Claude Code and OpenCode can EXECUTE through the host session without a provider key configured in the project.

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
