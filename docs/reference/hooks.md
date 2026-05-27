---
title: Hooks
description: Hooks fire during Claude Code sessions, on file edits, commits, pushes, and prompts. Generated from lib/hooks/.
---

> Generated from `lib/hooks/`. Re-run `construct docs:site` to refresh.

Hooks are wired in `platforms/claude/settings.template.json` and execute as child processes during Claude Code sessions. Each hook reads JSON on stdin, performs its check or transform, and exits with a status that signals whether the surrounding tool call should proceed.

| Hook | Description |
|---|---|
| `adaptive-lint` | PostToolUse auto-formatter and debug-log detector. |
| `agent-tracker` | Agent task lifecycle hook — tracks task start, completion, and handoffs. |
| `audit-reads` | opt-in tamper-evident log of every Read tool call. |
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
| `edit-accumulator` | Edit accumulator hook — batches and summarizes recent file edits for context. |
| `edit-error-recovery` | Edit error recovery hook — recovers from failed edit attempts and suggests fixes. |
| `edit-guard` | Edit guard hook — validates old_string exists in target file before allowing edits. |
| `env-check` | SessionStart |
| `guard-bash` | Guard bash hook — blocks dangerous shell commands from running unreviewed. |
| `mcp-audit` | MCP audit hook — logs all MCP tool calls for observability and review. |
| `mcp-health-check` | MCP health check hook — verifies MCP servers are reachable before tool use. |
| `model-fallback` | Provider-aware model fallback hook. |
| `policy-engine` | consolidated session policy enforcement hook. |
| `post-merge-docs-check` | PostToolUse / Bash (async) |
| `pre-compact` | Pre-compact hook — prepares context summary before compaction runs. |
| `pre-push-gate` | PreToolUse / Bash |
| `proactive-activation` | Event-driven specialist activation. |
| `read-tracker` | Read tracker hook — tracks file reads for efficiency analysis. |
| `readme-age-check` | Stop hook (async) |
| `registry-sync` | Registry sync hook — reminds to run construct sync after registry changes. |
| `rule-verifier` | Stop hook that audits the session for |
| `scan-secrets` | Scan secrets hook — detects potential secrets in files before they are committed. |
| `session-optimize` | Session end optimization hook — triggers agent optimization for low-performers. |
| `session-reflect` | Session end auto-reflect hook. |
| `session-start` | Session start hook — emits resumable project context at the start of each session. |
| `stop-notify` | Stop notify hook — emits a session summary notification when Claude stops. |
| `stop-typecheck` | Stop typecheck hook — runs TypeScript type-check at session end and records result. |
| `test-watch` | PostToolUse / Bash (async) |
