---
title: Reference
description: Look up CLI commands, hooks, MCP tools, config, specialists, and providers.
---

Reference is where you go when you know what you're looking for. For task-oriented walkthroughs, see [Cookbook](/guides/cookbook). For the *why* behind a subsystem, see [Concepts](/guides/concepts).

## CLI commands

[Every command, grouped by category →](/guides/reference/cli)

Generated from `lib/cli-commands.mjs`; refreshed by `construct docs:site`.

## Hooks

[All hooks that fire during Claude Code sessions →](/guides/reference/hooks)

Generated from `lib/hooks/`; each entry shows what triggers the hook and what it does.

## Specialists

[The construct persona + 28 specialists →](/guides/reference/specialists)

Generated from `specialists/org`; each entry shows the specialist's role, model tier, and one-line purpose.

## Config

[Environment variables and config files →](/guides/reference/config)

What every `CONSTRUCT_*` env var does, plus the structure of `~/.config/construct/config.env` and `.construct/context.json`.

## MCP tools

[Tools exposed to Claude Code / OpenCode via MCP →](/guides/reference/mcp-tools)

Each tool is invoked by the host editor; this page documents inputs, outputs, and capability scopes.

## Providers

[Built-in providers (GitHub, Jira, Confluence, Slack, Salesforce) →](/guides/reference/providers/overview)

Includes the capability matrix (read/write/search/watch/webhook) and the provider contract for custom plugins.

## Other

- [Security](/guides/reference/security) — the threat model, key boundaries, and what's protected by hard gates.
- [Standards](/guides/reference/standards) — comment policy, doc policy, commit policy.
- [Dependencies](/guides/reference/dependencies) — every dependency and why.
