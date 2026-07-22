---
title: Reference
description: Look up CLI commands, hooks, MCP tools, config, Worker Profiles, and providers.
---

Reference is where you go when you know what you're looking for. For task-oriented walkthroughs, see [Cookbook](/guides/cookbook). For the *why* behind a subsystem, see [Concepts](/guides/concepts).

## CLI commands

[Every command, grouped by category →](/guides/reference/cli)

Generated from `lib/cli-commands.mjs`; refreshed by `construct docs:site`.

## Hooks

[All hooks that fire during Claude Code sessions →](/guides/reference/hooks)

Generated from `lib/hooks/`; each entry shows what triggers the hook and what it does.

## Worker Profiles

[The `construct` front door + 12 Worker Profiles →](/guides/reference/worker-profiles)

Generated from `registry/worker-profiles/`; each entry shows the profile's model tier and one-line purpose.

[Coverage matrix →](/guides/reference/worker-profile-coverage-matrix) — skill emphasis, perspectives, guardrails, and pass/fail floor per profile.

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

- [Material pattern inventories](/guides/reference/material-pattern-inventories) — schema-validation, registration, and lifecycle/error/deprecation matrices (construct-tsyfe.1 investigation).
- [Security](/guides/reference/security) — the threat model, key boundaries, and what's protected by hard gates.
- [Standards](/guides/reference/standards) — comment policy, doc policy, commit policy.
- [Dependencies](/guides/reference/dependencies) — every dependency and why.
