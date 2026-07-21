---
title: What next
description: From first-success to actually using Construct day-to-day.
---

You have Construct installed, a project initialized, agents synced, and you've dispatched your first task. Now what.

## Things to read once

| If you want to understand... | Read |
|---|---|
| Why Construct works the way it does | [Architecture](/guides/concepts/architecture) |
| Pick solo / team / enterprise | [Deployment model](/guides/concepts/deployment-model) |
| How signals become triaged R&D work | [Intake and triage](/guides/concepts/intake-and-triage) |
| The Worker Profile model | [Worker Profiles reference](/guides/reference/worker-profiles) |
| What blocks commits and why | [Gates and enforcement](/guides/concepts/gates-and-enforcement) |
| The durable-state story | [Beads and state](/guides/concepts/beads-and-state) |

## Things you might want to do

| If you want to... | Go to |
|---|---|
| Extend Worker Profiles or Workspace Presets | [Worker Profiles reference](/guides/reference/worker-profiles) and [Workspace Preset lifecycle](/guides/concepts/workspace-preset-lifecycle) |
| Inspect what agents are running and why | [Inspect running agents](/guides/cookbook/inspect-running-agents) |
| Fix a CI failure or a blocked commit | [Fix a policy violation](/guides/cookbook/fix-a-policy-violation) |
| Connect to GitHub, Jira, Slack, or Salesforce | [Configure providers](/guides/cookbook/manage-providers) |
| Swap out the LLM or embedding model | [Plug in your own LLM](/guides/cookbook/plug-in-your-own-llm) |
| Use Construct conversationally | [Connect your editor](/guides/start/connect-your-editor) |
| Check fleet health with Oracle | `construct oracle status` — see [Architecture](/guides/concepts/architecture) |
| Run Construct on AWS | [Deploy to AWS](/operations/deploy/aws) |

## Reference, when you need it

- [CLI reference](/guides/reference/cli) — every command, every flag.
- [Configuration](/guides/reference/config) — env vars, config files, what each does.
- [Hooks](/guides/reference/hooks) — the hooks that fire on file edits, commits, pushes, prompts.
- [MCP tools](/guides/reference/mcp-tools) — tools exposed to Claude Code / OpenCode via MCP.

## When something breaks

- Run `construct doctor` first. Almost everything points at a specific fix.
- Check the [troubleshooting guide](/operations/troubleshooting) for known patterns.
- In `solo` mode (the default), Construct runs entirely locally. If a cloud API is down, you can still work from `plan.md`, `.construct/context.md`, the latest handoff, beads, git, and the local vector index. See [deployment model](/guides/concepts/deployment-model) for team/enterprise options.
