<!--
docs/reference/hooks.md — Every hook: purpose, trigger, budget, and blocking scope.

Source: lib/hooks/*.mjs — each file carries @p95ms and @maxBlockingScope annotations.
Hook scripts run via construct hook <name> (wired in settings.json).
-->

# Hooks Reference

Construct hooks fire at specific Claude Code lifecycle events. They are registered in `.claude/settings.json` and invoked through `construct hook <name>`, which resolves to `node lib/hooks/<name>.mjs`.

Hook input arrives on `stdin` as a JSON object. Hooks exit 0 (allow), 2 (block and show stdout to user), or other (logged as error, treated as allow).

## Lifecycle events

| Event | When it fires |
|---|---|
| `SessionStart` | When a new Claude Code session begins |
| `PreToolUse` | Before a tool executes (can block with exit 2) |
| `PostToolUse` | After a tool executes (receives tool result) |
| `UserPromptSubmit` | When the user sends a message |
| `Stop` | When Claude signals it has finished a turn |
| `PreCompact` | Before context compaction |

## Hook inventory

| Hook | Trigger | p95 ms | Blocking | Purpose |
|---|---|---|---|---|
| `session-start` | SessionStart | 300 | Yes | Emits resumable project context (branch, workflow, prior observations, drop-zone files, embed status) |
| `env-check` | SessionStart | 20 | Yes | Validates required env vars are present; warns on session start if missing |
| `guard-bash` | PreToolUse / Bash | 5 | Yes (exit 2) | Blocks destructive shell commands: `rm -rf /`, force push to main, fork bombs, DROP TABLE/DATABASE |
| `edit-guard` | PreToolUse / Edit | 20 | Yes (exit 2) | Confirms `old_string` exists in the target file; prevents mismatched edits |
| `config-protection` | PreToolUse | 5 | Yes (exit 2) | Blocks edits to protected runtime config files without an explicit override |
| `policy-engine` | PreToolUse, Stop, UserPromptSubmit | 40 | Yes | Consolidated session policy enforcement (branch confirmation, approval boundaries) |
| `pre-push-gate` | PreToolUse / Bash git push | 30,000 | Yes (exit 2) | Validates branch, tests pass, and docs are current before `git push` |
| `mcp-health-check` | PreToolUse | 51 | Warn-only | Verifies MCP servers are reachable; emits a warning if unreachable |
| `context-watch` | UserPromptSubmit | 20 | Yes | Monitors cumulative token usage; suggests compaction near window limit |
| `scan-secrets` | PostToolUse / Edit, Write | 30 | Yes (exit 2) | Detects real API keys and tokens in written files; blocks the write |
| `audit-trail` | PostToolUse / Edit, Write, Bash, MultiEdit, NotebookEdit | 15 | No | Appends tamper-evident JSONL record to `~/.cx/audit-trail.jsonl` |
| `audit-reads` | PostToolUse / Read | 8 | No | Opt-in log of every Read tool call |
| `comment-lint` | PostToolUse / Edit, Write | 50 | No | Checks edited files against the comment policy; flags violations |
| `adaptive-lint` | PostToolUse | 800 | No | PostToolUse auto-formatter and debug-log detector |
| `read-tracker` | PostToolUse / Read | 10 | No | Tracks file reads for efficiency analysis (repeated-read detection) |
| `edit-accumulator` | PostToolUse / Edit | 10 | No | Batches recent file edits for context |
| `edit-error-recovery` | PostToolUse | 10 | No | Detects failed edits and suggests corrective actions |
| `bash-output-logger` | PostToolUse / Bash | 20 | No | Persists long Bash outputs to disk; nudges model to reference the file |
| `agent-tracker` | PostToolUse | 10 | No | Tracks task lifecycle for telemetry |
| `mcp-audit` | PostToolUse | 10 | No | Logs MCP tool calls for observability |
| `model-fallback` | PostToolUse | 150 | No | On retryable provider failure, selects a fallback model and writes it to `.env` |
| `context-window-recovery` | PostToolUse | 10 | No | Detects context-limit errors; suggests `/compact` with cooldown |
| `dep-audit` | PostToolUse / Write, Edit | 5,000 | No (async) | Audits new dependencies for known vulnerabilities after `package.json` changes |
| `registry-sync` | PostToolUse | 12,000 | No | Reminds to run `construct sync` after edits to `agents/registry.json` |
| `persona-validator` | PostToolUse | 600 | PostToolUse (async) | Tests optimized persona prompts against a validation suite |
| `pre-compact` | PreCompact | 100 | Yes | Prepares a context summary before compaction runs |
| `session-optimize` | Stop | 300 | No (async) | Triggers agent optimization for low-performing agents at session end |
| `stop-notify` | Stop | 500 | Yes | Emits session summary (cost, files changed, uncommitted work) when Claude stops |
| `stop-typecheck` | Stop | 2,000 | Yes | Runs TypeScript type-check at session end; records result for next session-start warning |

## Hook input shape

All hooks receive a JSON object on `stdin`:

```json
{
  "session_id": "abc123",
  "tool_name": "Edit",
  "tool_input": { "file_path": "...", "old_string": "...", "new_string": "..." },
  "tool_response": { ... },
  "cwd": "/path/to/project"
}
```

Fields vary by trigger: `PreToolUse` receives `tool_name`, `tool_input`, `cwd`; `PostToolUse` adds `tool_response`; `Stop` adds `transcript_path`.

## Testing a hook manually

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"},"cwd":"/tmp"}' | \
  node lib/hooks/guard-bash.mjs
echo "Exit: $?"   # 2 = blocked
```

## Adding a hook

1. Create `lib/hooks/<name>.mjs` with a `/** */` file header including `@p95ms` and `@maxBlockingScope`.
2. Read JSON input from `stdin`; write context injection to `stdout` (SessionStart hooks) or block with exit 2 (PreToolUse).
3. Register in the appropriate array in `platforms/claude/settings.template.json`.
4. Run `construct sync` to propagate the change to `.claude/settings.json`.
5. Test in isolation before committing — a broken hook blocks all tool use.
