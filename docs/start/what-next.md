---
title: What next
description: From first-success to actually using Construct day-to-day.
---

You have Construct installed, a project initialized, agents synced, and you've dispatched your first task. Now what.

## Things to read once

| If you want to understand... | Read |
|---|---|
| Why Construct works the way it does | [Architecture](/concepts/architecture) |
| Pick solo / team / enterprise | [Deployment model](/concepts/deployment-model) |
| How signals become triaged R&D work | [Intake and triage](/concepts/intake-and-triage) |
| The persona/specialist model | [Agents and personas](/concepts/agents-and-personas) |
| What blocks commits and why | [Gates and enforcement](/concepts/gates-and-enforcement) |
| The durable-state story | [Beads and state](/concepts/beads-and-state) |

## Things you might want to do

| If you want to... | Go to |
|---|---|
| Add a new specialist or persona to your team | [Add a custom agent](/cookbook/add-a-custom-agent) |
| Inspect what agents are running and why | [Inspect running agents](/cookbook/inspect-running-agents) |
| Fix a CI failure or a blocked commit | [Fix a policy violation](/cookbook/fix-a-policy-violation) |
| Connect to GitHub, Jira, Slack, or Salesforce | [Configure providers](/cookbook/manage-providers) |
| Swap out the LLM or embedding model | [Plug in your own LLM](/cookbook/plug-in-your-own-llm) |
| Run terminal chat on Construct's owned loop | [Construct chat](/cookbook/construct-chat) |
| Use the browser chat cockpit | [Construct chat](/cookbook/construct-chat) (see `--web` and dashboard `/chat`) |
| Check fleet health with Oracle | `construct oracle status` — see [Architecture](/concepts/architecture) |
| Run Construct on AWS | [Deploy to AWS](/deploy/aws) |

## Reference, when you need it

- [CLI reference](/reference/cli) — every command, every flag.
- [Configuration](/reference/config) — env vars, config files, what each does.
- [Hooks](/reference/hooks) — the hooks that fire on file edits, commits, pushes, prompts.
- [MCP tools](/reference/mcp-tools) — tools exposed to Claude Code / OpenCode via MCP.

## When something breaks

- Run `construct doctor` first. Almost everything points at a specific fix.
- Check the [troubleshooting guide](/operations/troubleshooting) for known patterns.
- In `solo` mode (the default), Construct runs entirely locally. If a cloud API is down, you can still work from `plan.md`, `.cx/context.md`, the latest handoff, beads, git, and the local vector index. See [deployment model](/concepts/deployment-model) for team/enterprise options.
