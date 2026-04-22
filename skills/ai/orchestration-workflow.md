<!--
skills/ai/orchestration-workflow.md — Construct Orchestration Workflow — Use this skill when the request involves agent orchestration, phase transitions,

Use this skill when the request involves agent orchestration, phase transitions, task keys, handoff quality, workflow state, or project alignment. ## Core Model
-->
# Construct Orchestration Workflow

Use this skill when the request involves agent orchestration, phase transitions, task keys, handoff quality, workflow state, or project alignment.

## Core Model

Construct is an executive-aligned, control-plane workflow:

- **Universal Orchestrator**: **Construct** is the single point of entry. It owns the outcome from strategy to production, dispatching specialists autonomously.
- **Executive Checkpoints**: High-gate phases (Planning and Verification) require explicit Customer/Executive sign-off via the dashboard or CLI.
- **Specialists**: `cx-*` agents own bounded work packages.
- **Skills**: Reusable execution playbooks (searched via `search_skills`).
- **Hooks**: Enforce continuity and system integrity (e.g. `pre-push-gate`, `dep-audit`).
- **Resumption Protocol**: Every new session MUST begin with `workflow_status` and `project_context` to prevent "state amnesia."
- **.cx/workflow.json**: The authoritative local task graph (Beads pattern).
- **Cass (Memory MCP)**: Preserves durable project context across sessions and platforms.

## Required State

For non-trivial work, create or update `.cx/workflow.json` with:

- `phase`: current phase (research, plan, implement, validate, operate)
- `currentTaskKey`: active task
- `tasks[].key`: stable `todo:N` key
- `tasks[].phase`: corresponding phase
- `tasks[].owner`: persona or cx-specialist
- `tasks[].status`: todo, in-progress, blocked, blocked_needs_user, blocked_needs_executive, done, or skipped
- `tasks[].readFirst`: files, docs, or memory queries to inspect first
- `tasks[].doNotChange`: protected files or surfaces
- `tasks[].acceptanceCriteria`: binary pass/fail checks
- `tasks[].verification`: evidence proving completion

## Commands

```bash
construct do "Goal"              # Unified natural language entry point
construct workflow approve       # Executive sign-off on current phase
construct workflow status        # Check alignment and progress
construct workflow align         # Sync state and identify drift
```

## Worker Packets

Specialists do not run open-ended conversations with the user. They return one terminal state:

- `DONE`: changed files, decisions, verification evidence
- `BLOCKED`: blocker, attempted steps, safest next action
- `NEEDS_MAIN_INPUT`: `{ taskKey, worker, blocker, question, safeDefault, context }`

When a worker needs user input, mark the task `blocked_needs_user`, return the `NEEDS_MAIN_INPUT` packet, and let the active persona ask the user in the main session.

## Phase Gates

Plan -> Implement:
- Requirements are explicit.
- Risks have been challenged.
- Tasks have TASK_KEY, owner, readFirst, doNotChange, and acceptance criteria.

Implement -> Validate:
- Implementation is complete.
- Verification evidence is recorded.
- Changed files are listed.

Validate -> Operate:
- CRITICAL and HIGH findings are resolved.
- Remaining risks are explicitly accepted.

Operate -> Done:
- Health checks pass.
- Rollback path is documented.
- Release or deployment status is recorded.

## Output Discipline

Keep orchestration mechanics mostly internal. The user should see:

- current phase
- current task or blocker
- decisions that changed the plan
- verification results

Do not dump full handoff templates unless the host cannot dispatch the next phase or the user asks to see the handoff.
