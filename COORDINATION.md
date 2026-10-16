# COORDINATION.md — Claude Code ↔ Codex CLI

Single source of truth for how the two coding agents cooperate in **this** repo.
`CLAUDE.md` pulls this in (`@COORDINATION.md`); `AGENTS.md` points here. Keep the
model in this one file so the two agent files never drift.

## The bridge
- Claude Code calls Codex through the `codex` MCP server (`codex mcp-server`).
- Codex calls Claude Code through the `claude` MCP server (`claude mcp serve`).
- The mechanism is configured globally (Claude user config + `~/.codex/config.toml`),
  which is what makes the bridge work on any clone. This repo also keeps a local
  `.mcp.json` declaring the `codex` bridge for Claude Code; it is gitignored because it
  holds machine-specific absolute paths, so it does not travel with commits.

## Roles — lead and delegate
Whoever the human starts the session with is the **lead** for that session. The lead
owns `HANDOFF.md`, holds the plan, and decides what to delegate. The other agent is the
**delegate**: it executes one scoped request and returns a result. One driver, one
source of session state.

Two sanctioned patterns (choose per task):
- **A — Plan → Implement → Review.** Lead plans and writes the brief; delegate implements
  the scoped change; lead reviews the diff before it reaches the human.
- **B — Implement → Cross-review.** Lead implements; delegate reviews against the plan.
  Cross-model review is the highest-value use of the bridge — each model catches the
  other's blind spots.

Default when unsure: pattern A, with Codex taking well-specified, self-contained
implementation and the opposite model acting as an independent reviewer.

## Rules that prevent the known failure modes
1. **Depth = 1.** A delegate must NOT call back across the bridge — no agent-calls-agent
   loops. (Matches Codex `[agents] max_depth = 1`.)
2. **One writer per file.** The lead assigns a surface area; the delegate stays inside it.
   Never let both agents edit the same file at the same time.
3. **Sequential by default.** Only one agent edits the working tree at a time; control
   passes through `HANDOFF.md`. For genuinely parallel work give each agent its own **git
   worktree** (one task → one branch → one worktree → one agent) and never run
   `git checkout`/`switch` in a tree the other holds.
4. **Bounded cost.** Delegate calls are single, non-interactive, and scoped. No fan-out
   unless the human asks.
5. **Merge discipline.** Merge one branch at a time, rebase on updated main first, keep
   worktrees short-lived.
6. **Single sources of truth.** This file is the coordination model; `HANDOFF.md` is live
   session state. Instructions live once (here), never copied into both agent files.

## Model selection

Delegate calls inherit the delegating CLI's **configured default model** — do not hardcode
an expensive model per call (no `-m`/`--model` flag or `-c model=` override in the bridge
registrations, `.mcp.json`, or the invocation itself). Cost stays controlled in one place:
Codex's default lives in `~/.codex/config.toml` (`model`), Claude's in its own settings.
Pick by task: a cheaper/faster model for routine or mechanical delegate work, a stronger
model only for deep review or genuinely hard implementation. If you must override for a
single invocation, do it explicitly, sparingly, and note why in `HANDOFF.md`. This rides on
the depth-1 lead/delegate rule: the lead chooses the model for what it delegates; the
delegate does not escalate on its own.

## Handoff protocol
Read `HANDOFF.md` at the **start** of a work session; update it at the **end**. It is the
baton: it names who holds control, what was done, the current state, the next step, open
questions, and which files are owned or in flight. One writer at a time; overwrite stale
content rather than logging history.

## Repo quick-reference
- Stack: TypeScript Node package (npm), src/ + tests/ (node --test)
- Install: `npm install` · Build: `npm run build` · Test: `npm test` · Typecheck: `npm run typecheck` · Lint: `npm run lint`
