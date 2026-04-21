# Construct — Claude Code Integration

This project uses Construct. Personas and specialists are defined in `agents/registry.json` and synced to Claude Code via `construct sync`.

## Workflow roles

Construct is the only intended user-facing surface.

- **Planning** — requirements, strategy, architecture
- **Implementation** — builds features and fixes bugs
- **Validation** — quality gates, security, accessibility
- **Research** — docs, debugging, codebase exploration
- **Operations** — releases, dev servers, health checks

## Usage

Talk to Construct normally. It routes complex work through the full pipeline internally:
plan → implement → validate → operate

For simple tasks, Construct can act directly without exposing internal routing.

All 26 internal specialists (cx-engineer, cx-security, cx-devil-advocate, etc.) are available as subagents.

## Tool Calls

When using Bash, always provide both `command` and `description` string fields. Do not emit XML-style fallback tool calls.

## Cross-Tool Memory

Cass MCP provides session memory across tools. Use `memory_search` to find prior context.
