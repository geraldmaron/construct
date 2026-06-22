---
title: Hooks
description: Hooks fire during Claude Code sessions, on file edits, commits, pushes, and prompts. Generated from lib/hooks/.
---

> Generated from `lib/hooks/`. Re-run `construct docs:site` to refresh.

Hooks are wired in `platforms/claude/settings.template.json` and execute as child processes during Claude Code sessions. Each hook reads JSON on stdin, performs its check or transform, and exits with a status that signals whether the surrounding tool call should proceed.

| Hook | Description |
|---|---|
| `adaptive-lint` | PostToolUse auto-formatter and debug-log detector. |
| `agent-tracker` | Task tool lifecycle hook: records dispatch + |
| `artifact-release-gate` | PostToolUse advisory structure/visual gate for typed docs. |
| `audit-reads` | post-Read state tracker. |
| `audit-trail` | append-only audit log of every mutation Construct |
| `bash-output-logger` | persists long Bash outputs to disk and nudges |
| `block-no-verify` | refuse `git commit/push/merge --no-verify`. |
| `ci-status-check` | UserPromptSubmit hook: inject remote CI status into agent context. |
| `comment-lint` | PostToolUse hook: enforce the comment policy at write time. |
| `config-protection` | protects code-quality config from being weakened. |
| `context-watch` | monitors cumulative token usage and injects |
| `context-window-recovery` | Context window recovery hook — detects near-limit context and suggests compaction. |
| `dep-audit` | PostToolUse / Write|Edit (async) |
| `doc-coupling-check` | PostToolUse hook: nudge when code edits aren't paired with doc updates. |
| `edit-accumulator` | accumulates edited paths for the next |
| `edit-error-recovery` | Edit error recovery hook — recovers from failed edit attempts and suggests fixes. |
| `edit-guard` | Edit guard hook — validates old_string exists in target file before allowing edits. |
| `graph-impact-advisory` | PostToolUse hook: test-impact advisory on code edits. |
| `guard-bash` | Guard bash hook — blocks dangerous shell commands from running unreviewed. |
| `mcp-audit` | MCP audit hook — logs all MCP tool calls for observability and review. |
| `mcp-health-check` | MCP health check hook — verifies MCP servers are reachable before tool use. |
| `model-fallback` | Provider-aware model fallback hook. |
| `orchestration-dispatch-guard` | backstop against solo-authoring an orchestrated deliverable. |
| `policy-engine` | consolidated session policy enforcement hook. |
| `post-merge-docs-check` | PostToolUse / Bash (async) |
| `post-merge-tracking` | close beads referenced by a merged PR. |
| `pre-compact` | Pre-compact hook — prepares context summary before compaction runs. |
| `pre-push-gate` | PreToolUse / Bash |
| `proactive-activation` | Event-driven specialist activation. |
| `readme-age-check` | Stop hook (async) |
| `registry-sync` | Registry-change reminder hook. |
| `rule-verifier` | Stop hook that audits the session for |
| `scan-secrets` | Scan secrets hook — detects potential secrets in files before they are committed. |
| `session-optimize` | Session end optimization hook — triggers agent optimization for low-performers. |
| `session-reflect` | Session end auto-reflect hook. |
| `session-start` | Session start hook — emits resumable project context at the start of each session. |
| `session-tracking-refresh` | keep the project's tracking |
| `stop-notify` | Stop notify hook — emits a session summary notification when Claude stops. |
| `stop-typecheck` | Stop typecheck hook — runs TypeScript type-check at session end and records result. |
| `test-watch` | PostToolUse / Bash (async) |
