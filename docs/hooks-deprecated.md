<!--
docs/hooks-deprecated.md — record of hooks removed from lib/hooks/ and where their behavior now lives.

Every removed hook must have an entry here before its file is deleted.
This file is the authoritative ledger; do not infer hook history from git blame alone.
-->

# Deprecated Hooks

Hooks are removed when their behavior is absorbed into a consolidated hook, moved into
declarative rules, or expressed as persona/skill guidance. Removal without an entry here
is a policy violation — `construct doctor` checks this ledger against the hooks manifest.

## Removed in P2 consolidation

### bootstrap-guard.mjs
- **Event:** PreToolUse
- **Behavior:** Blocked write and bash operations until the session was grounded (workflow
  state loaded, context read). Exited 2 on violations.
- **Absorbed by:** `lib/hooks/policy-engine.mjs` — `bootstrap` rule in `rules/policy/bootstrap.yaml`

### drive-guard.mjs
- **Event:** Stop
- **Behavior:** Blocked the Stop event when drive mode was active and acceptance criteria
  were not yet met. Tracked per-criterion evidence.
- **Absorbed by:** `lib/hooks/policy-engine.mjs` — `drive` rule in `rules/policy/drive.yaml`

### task-completed-guard.mjs
- **Event:** PreToolUse (`workflow_update_task`)
- **Behavior:** Required verification evidence before allowing implement-phase task status
  to be set to `done`. Exited 2 without evidence.
- **Absorbed by:** `lib/hooks/policy-engine.mjs` — `task` rule in `rules/policy/task.yaml`

### workflow-guard.mjs
- **Event:** UserPromptSubmit
- **Behavior:** Routed significant work through workflow state. Warned when non-trivial
  Bash or Edit operations ran without an active workflow task set.
- **Absorbed by:** `lib/hooks/policy-engine.mjs` — `workflow` rule in `rules/policy/workflow.yaml`

### mcp-task-scope.mjs
- **Event:** PreToolUse (MCP tool calls)
- **Behavior:** Warned when MCP tools were called outside the declared task scope. Provided
  attribution and audit trail entries per call.
- **Absorbed by:** `lib/hooks/policy-engine.mjs` (scope check) + `lib/hooks/mcp-audit.mjs`
  (attribution and audit trail)

### repeated-read-guard.mjs
- **Event:** PreToolUse (Read)
- **Behavior:** Warned after a file was read more than a configurable threshold within a
  session. Used the session-efficiency store populated by read-tracker.mjs.
- **Absorbed by:** `rules/common/efficiency.md` (agent guidance) + `lib/hooks/read-tracker.mjs`
  (already records reads; session-start surfaces the efficiency digest)

### continuation-enforcer.mjs
- **Event:** Stop
- **Behavior:** Checked workflow state for incomplete tasks and blocked the Stop event when
  high-priority work was unfinished.
- **Absorbed by:** `personas/construct.md` — loop guard and drive-mode sections enforce
  continuation discipline at the persona level; `policy-engine.mjs` drive rule covers the
  blocking case.

### teammate-idle-guard.mjs
- **Event:** PostToolUse (Task)
- **Behavior:** Tracked agent start times and emitted a warning when a dispatched agent
  appeared idle beyond the idle threshold.
- **Absorbed by:** `commands/build/feature.md` — build command guidance covers agent
  dispatch expectations and timeout handling.

### console-warn.mjs
- **Event:** PostToolUse (Edit/Write)
- **Behavior:** Detected `console.log` and `console.debug` statements in edited files and
  emitted a non-blocking warning.
- **Absorbed by:** `lib/hooks/adaptive-lint.mjs` — lint pass now flags debug logging.
