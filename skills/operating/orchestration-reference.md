# Orchestration Reference

Loaded on demand via `get_skill("operating/orchestration-reference")`.

This is the detailed reference for Construct's orchestration contract. The short essentials (session resumption, loop guard, terminal states, tool naming, observability) live in the per-agent prompt. Everything below is situational — load it when you hit a case it addresses.

## System model

Construct is the underlying orchestration system for the **current project**. Treat personas as phase owners, specialists as bounded workers, skills as execution playbooks, hooks as enforcement, `.cx/workflow.json` as durable task state, and memory/.cx artifacts as persistent project state.

## Perspective architecture

Each specialist carries a distinct cognitive profile shaped by professional prior, characteristic suspicion, and productive tension with adjacent roles. When you dispatch specialists, you are not delegating tasks — you are assembling perspectives. The value is not parallelism; it is forcing the same problem through genuinely different cognitive lenses in sequence. A plan challenged by cx-devil-advocate and reviewed by cx-reviewer is not slower — it is more likely to survive contact with reality.

## Execution contract

For every non-trivial task: classify intent, create or update `.cx/workflow.json`, route to the owning persona or specialist, execute with the relevant skill, dispatch independent work in parallel when supported, persist decisions/handoffs to memory or `.cx`, validate through the validation phase before release.

### Intent classes

- `research` — read-only investigation
- `implementation` — code changes
- `investigation` — debugging, tracing
- `evaluation` — quality gates, review
- `fix` — bug repair

Tag every workflow task with its intent class. Let intent drive agent selection and depth of work.

### Work categories

- `visual` (UI/CSS/design) → standard tier
- `deep` (complex reasoning, architecture) → reasoning tier
- `quick` (single-file, trivial) → fast tier
- `writing` (docs, prose) → fast tier
- `analysis` (data, metrics, review) → standard tier

## Workflow state

Task packets include an optional `mcpScope` field: list MCP server names relevant to this task (e.g. `["github", "context7"]`). The mcp-task-scope hook warns when out-of-scope MCPs are called. The mcp-audit hook records all MCP usage per task key to `.cx/mcp-audit.json`.

Every delegated task needs a stable `TASK_KEY`, `phase`, `owner`, `status`, `readFirst`, `doNotChange`, `acceptanceCriteria`, and `verification` evidence before done. Run `construct workflow align` at phase transitions.

## Native surfaces

Use native skills, plugins, slash commands, MCP tools, and project instructions when they exist and match the task. Agents define role, judgment, and handoffs; skills are the execution playbooks.

If a native skill or project instruction conflicts with this registry, obey the higher-priority system, tool, and repository instructions. Surface the conflict, the decision made, and any follow-up needed.

Do not duplicate skill internals inside agent prompts. Reference the relevant skill or workflow, then apply it to the current context.

## Handoff contract

For every non-trivial handoff:

- **TASK** (one atomic goal)
- **EXPECTED OUTCOME** (deliverable + acceptance signal)
- **REQUIRED TOOLS**
- **MUST DO** (exhaustive)
- **MUST NOT DO** (anticipate drift)
- **CONTEXT** (files, decisions, constraints)
- **READ FIRST**
- **DO NOT CHANGE**

Missing required fields mean the handoff is incomplete.

## Primary persona contract

Personas own user interaction. When a worker returns `NEEDS_MAIN_INPUT`, ask the question in the main session, update `.cx/workflow.json` to `blocked_needs_user`, then resume or re-dispatch the worker after the user answers.

## Parallel dispatch

When two or more specialists can work independently, write `[parallel: cx-agent-a, cx-agent-b]` before the handoff list and give each agent a disjoint scope. Do not mark dependent work as parallel.

## Horizontal routing

When your output directly feeds another specialist (e.g. security findings → cx-reviewer, architecture decisions → cx-engineer), write a handoff entity to the memory MCP using `create_entities` with name `handoff:{target-agent}` and `add_observations` with the payload: `{ from, goal, key_findings, files, constraints }`. The target specialist calls `search_nodes 'handoff:{my-agent-name}'` before starting work.

## Efficiency discipline

Before broad exploration, identify the smallest file set that can answer the question. Use workflow/context artifacts as cached state. Treat repeated large reads as a smell that should trigger compaction, summarization, or a narrower search strategy.

The `context-watch` hook fires at ~60% and ~80% context usage with compaction guidance; the `repeated-read-guard` hook blocks broad re-reads of files already in context.

## Token efficiency

Be surgical. Use `Grep` and `Glob` to narrow scope before `Read`. Prefer targeted reads under 400 lines; never exceed 1000 lines in one read. Avoid re-reading the same file unless something changed or a larger slice is necessary. Prefer parallel reads over sequential turns. In your responses, keep summaries under 100 words unless the user asks for more detail.

## Deliberation cap

If you reason about the same decision across two consecutive turns without a new file read, tool call, or user answer, stop. This is the signal you skipped a dispatch or a lookup. Either (a) call a doc/search tool, (b) return a `NEEDS_MAIN_INPUT` packet, or (c) commit to a default and note the assumption. Never a third round of internal debate.

## Speculation rule

When choosing between named options (SDK vs SDK, library vs library, pattern vs pattern), the answer comes from `context7_query-docs`, WebFetch, the user, or an explicit default — NOT from internal reasoning rounds. If you catch yourself weighing options in thinking without having read docs or asked, stop and do one of those three.

## Probe before bulk read

Before Reading any file with `limit > 200` or no limit, verify size first via Glob, `wc -l`, or a `limit=50` probe. A 220-line read on a 74-line file is the tell that this rule was skipped.

## Dispatch-first test

If work touches 3+ files across 2+ modules, or introduces a new contract/dependency/SDK, the persona must not produce the implementation plan itself — dispatch cx-architect. In-persona implementation planning for complex work is the primary failure mode this rule exists to prevent.

## Executive communication

Treat the user as the Customer and Executive. Proactive reporting on status, immediate escalation of strategic blockers, seeking input on all user-facing changes (UX/UI). When in doubt, clarify intent rather than assuming a product decision.

## Comment hygiene

Avoid pointless comments. Comment only for intent, invariants, non-obvious constraints, or operationally critical decisions.
