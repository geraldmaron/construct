<!--
docs/hooks-inventory.md — classification of all hooks in lib/hooks/.

Four buckets: observability, guardrail, keep, and deprecated. Each hook has an
assigned event, approximate LOC, and a one-line description. Deprecated hooks are
removed from this table; see docs/hooks-deprecated.md for the removal ledger.
-->

# Hooks Inventory

Classification of all hooks in `lib/hooks/` into three active buckets plus a
deprecated ledger. Deprecated hooks are recorded in `docs/hooks-deprecated.md`.

- **observability** — logging, tracing, metrics; keep as hooks
- **guardrail** — policy enforcement on tool use; keep or consolidate
- **keep** — session lifecycle and recovery; does not fit other buckets

Hook count target: ≤ 30 (see projection below).

---

## observability

| Hook | Event | p95ms | What it does |
|---|---|---|---|
| `audit-trail.mjs` | PostToolUse | 15 | Append-only JSONL audit log for every mutation |
| `bash-output-logger.mjs` | PostToolUse | 20 | Saves long Bash stdout to `~/.cx/bash-logs/` |
| `mcp-audit.mjs` | PostToolUse | 10 | Logs every `mcp__*` call to `.cx/mcp-audit.json` |
| `read-tracker.mjs` | PostToolUse | 10 | SHA-256 file-read tracking and per-session efficiency stats |
| `agent-tracker.mjs` | PostToolUse | 10 | Records last dispatched subagent to `~/.cx/last-agent.json` |
| `stop-notify.mjs` | Stop | 500 | Session summary: cost, TS results, macOS notification |
| `context-watch.mjs` | UserPromptSubmit | 20 | Token usage monitoring and compaction recommendation |
| `edit-accumulator.mjs` | PostToolUse | 10 | Tracks files-changed count; queues TS files for end-of-session typecheck |

---

## guardrail

| Hook | Event | p95ms | What it does |
|---|---|---|---|
| `policy-engine.mjs` | PreToolUse, Stop, UserPromptSubmit | 40 | Consolidated policy: bootstrap, drive, task-completion, workflow routing |
| `guard-bash.mjs` | PreToolUse | 5 | Blocks destructive shell patterns (rm -rf /, force-push to main, DROP TABLE) |
| `scan-secrets.mjs` | PostToolUse | 30 | Blocks edits containing real secret patterns (API keys, PEM, tokens) |
| `config-protection.mjs` | PreToolUse | 5 | Blocks edits to protected config and meta-system files |
| `edit-guard.mjs` | PreToolUse | 20 | Blocks Edit when old_string not found; warns on stale file hash |
| `pre-push-gate.mjs` | PreToolUse | 30000 | Runs tests and build before git push |
| `mcp-health-check.mjs` | PreToolUse | 51 | Warns on calls to recently-failed MCP servers |
| `dep-audit.mjs` | PostToolUse | 5000 | Runs vulnerability audit after dependency manifest edits |

---

## keep (session lifecycle and recovery)

| Hook | Event | p95ms | What it does |
|---|---|---|---|
| `session-start.mjs` | SessionStart | 300 | Tiered context injection at session open |
| `env-check.mjs` | SessionStart | 20 | `.env.example` vs `.env` comparison |
| `pre-compact.mjs` | PreCompact | 100 | Context summary before compaction |
| `adaptive-lint.mjs` | PostToolUse | 800 | Auto-runs linter/formatter on edited file; flags debug logging |
| `comment-lint.mjs` | PostToolUse | 50 | Warns on missing headers and banned comment patterns |
| `stop-typecheck.mjs` | Stop | 2000 | Runs `tsc --noEmit` at session end |
| `edit-error-recovery.mjs` | PostToolUse | 10 | Recovery guide for failed Edit/Write calls |
| `context-window-recovery.mjs` | PostToolUse | 10 | Detects context-limit errors; saves recovery snapshot |
| `model-fallback.mjs` | PostToolUse | 100 | Detects rate-limit errors; invokes model failover |
| `registry-sync.mjs` | PostToolUse | 12000 | Runs `construct sync` after edits to `registry.json` |

---

## Hook count

| Bucket | Count |
|---|---|
| observability | 8 |
| guardrail | 8 |
| keep | 10 |
| **Total** | **26** |

Ceiling: 30. Adding a hook requires retiring one or explicit approval.

---

## SLA targets

| Event | Budget | Notes |
|---|---|---|
| SessionStart hooks | 300ms total | `session-start` + `env-check` combined |
| PreToolUse hooks | 50ms each | Must not visibly delay tool execution |
| PostToolUse hooks | 100ms each | Async hooks may spike briefly |
| Stop hooks | 2000ms total | User is waiting |
| UserPromptSubmit | 50ms each | Blocks user input |
| PreCompact | 500ms | One-time pause |

