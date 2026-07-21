<!--
docs/hooks-deprecated.md: record of hooks removed from lib/hooks/ and where their behavior now lives.

Every removed hook must have an entry here before its file is deleted.
This file is the authoritative ledger; do not infer hook history from git blame alone.
-->

# Deprecated Hooks

Hooks are removed when their behavior is absorbed into a consolidated hook, moved into
declarative rules, or expressed as Worker Profile / skill guidance. Removal without an entry here
is a policy violation: `construct doctor` checks this ledger against the hooks manifest.

## Consolidation into `lib/hooks/policy-engine.mjs`

`policy-engine.mjs` is the consolidated hook for session policy. It is wired in `platforms/claude/settings.template.json` for three events:

- **PreToolUse** (matcher `Write|Edit|MultiEdit|NotebookEdit|TodoWrite|Bash`): bootstrap rule
- **Stop**: red-CI block, open-beads block, drive-mode criteria, drive-session advisory
- **UserPromptSubmit**: reserved; no-op today

### bootstrap-guard.mjs
- **Original event:** PreToolUse
- **Original behavior:** Blocked Write/Edit/Bash mutations until the session was grounded: either via `project_context` + `memory_search` MCP calls or 3+ exploratory reads.
- **Now:** `lib/hooks/policy-engine.mjs` PreToolUse handler. State persisted at `~/.construct/bootstrap-state.json`, scoped per-session, 24h TTL.

### drive-guard.mjs
- **Original event:** Stop
- **Original behavior:** Blocked Stop when drive mode was active and acceptance criteria lacked evidence.
- **Now:** `lib/hooks/policy-engine.mjs` Stop handler: drive section. Reads `.construct/drive-state.json` (per-project) and `~/.construct/drive-session.json` (global advisory).

### continuation-enforcer.mjs
- **Original event:** PostToolUse (TodoWrite)
- **Original behavior:** Reinforced TodoWrite usage to prevent premature stopping.
- **Now:** Two replacements that are policy-aligned with `CLAUDE.md:85` ("use bd, not TodoWrite"):
  - `policy-engine.mjs` Stop handler: `open-bd` section blocks Stop when any `bd list --status in_progress` issue is open. Bypass: `CONSTRUCT_STOP_OK_OPEN_BD=1`.
  - `policy-engine.mjs` Stop handler: drive section enforces criteria completion.

### console-warn.mjs
- **Original event:** PostToolUse (Edit/Write)
- **Original behavior:** Detected `console.log` / `console.debug` / `debugger` statements in edited files.
- **Now:** `lib/hooks/adaptive-lint.mjs:130`: `[adaptive-lint] console.log/debug in <file>:<loc>` advisory.

### read-tracker.mjs
- **Original event:** PostToolUse (Read)
- **Original behavior:** SHA-16 file-hash store at `~/.construct/file-hashes.json` for edit-guard staleness detection; recorded read deltas via `lib/read-tracker-store.mjs`.
- **Now:** `lib/hooks/audit-reads.mjs` stage 1 (always-on, runs regardless of `CONSTRUCT_AUDIT_READS`): same hash-store upsert + read-tracker delta + retention pruning. Folding into audit-reads fixed a quiet correctness bug: the prior split meant edit-guard's staleness check broke when audit-reads was off, because nothing else maintained the hash store.

### env-check.mjs
- **Original event:** SessionStart
- **Original behavior:** Compared `.env.example` vs `.env` and `process.env`; surfaced placeholder/missing required vars at session open.
- **Now:** `lib/hooks/session-start.mjs` `buildEnvCheckNote(cwd)` helper, appended to the existing session-start output as part of the unified tier-2 emission. One fewer SessionStart process spawn.

## Stalled-mid-consolidation hooks

These hooks were removed but the consolidated replacement is **not yet implemented** in `policy-engine.mjs`. Their behaviors are currently absent. Treat as known gaps:

### task-completed-guard.mjs
- **Was:** PreToolUse on `workflow_update_task`, required verification evidence before allowing status to be set to `done`.
- **Status:** Not implemented in policy-engine. The Stop-time `open-bd` check is a partial substitute (blocks Stop with open work) but doesn't gate the status transition itself.
- **Follow-up:** Add a `task` rule to `policy-engine.mjs` PreToolUse that checks `workflow_update_task` against the rule in `rules/policy/task.yaml`.

### workflow-guard.mjs
- **Was:** UserPromptSubmit; routed significant work through workflow state, warned when non-trivial mutations ran without an active workflow task.
- **Status:** Not implemented. `policy-engine.mjs` UserPromptSubmit handler is a no-op.
- **Follow-up:** Implement the `workflow` rule from `rules/policy/workflow.yaml`.

### mcp-task-scope.mjs
- **Was:** PreToolUse on MCP tool calls; warned when an MCP call was outside the declared task scope.
- **Status:** Not implemented. `mcp-audit.mjs` records attribution but does not enforce scope.
- **Follow-up:** Add MCP scope check to `policy-engine.mjs` PreToolUse.

### repeated-read-guard.mjs
- **Was:** PreToolUse on Read; warned after a file was read more than a configurable threshold within a session.
- **Status:** Declarative-only via `rules/common/efficiency.md`. Behavioral enforcement absent.

### teammate-idle-guard.mjs
- **Was:** PostToolUse on Task; tracked agent start times and warned on idle dispatched agents.
- **Status:** Declarative-only via `commands/build/feature.md`. Behavioral enforcement absent.

## New Stop-time policy added with this consolidation

These behaviors were never separate hooks but are new to `policy-engine.mjs` Stop:

- **red-CI block**: queries `gh run list --branch=<current> --limit=1`; exits 2 if last run failed and the agent edited code this session. Bypass: `CONSTRUCT_STOP_OK_RED_CI=1`.
- **open-bd block**: queries `bd list --status in_progress --json`; exits 2 if any issues are open. Bypass: `CONSTRUCT_STOP_OK_OPEN_BD=1`.
- **drive-session advisory**: reads `~/.construct/drive-session.json`; emits stderr advisory if `open: true`. Non-blocking.
