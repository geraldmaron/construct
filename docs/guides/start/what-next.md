---
title: What next
description: From first-success to actually using Construct day-to-day.
---

You have Construct installed, a project initialized, agents synced, and you've dispatched your first task. Now what.

Lean path first: keep using `@construct` and trust the hard gates. Beads, intake, and graph stay available — they are not day-1 mandatory. That is progressive disclosure (show the few options that serve most tasks; defer specialized ones until asked — [NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).

## Lean essentials (read when useful)

| If you want to understand... | Read |
|---|---|
| Why Construct works the way it does | [Architecture](/guides/concepts/architecture) |
| Pick solo / team / enterprise | [Deployment model](/guides/concepts/deployment-model) |
| The Worker Profile model | [Worker Profiles reference](/guides/reference/worker-profiles) |
| What blocks commits and why | [Gates and enforcement](/guides/concepts/gates-and-enforcement) |

## Power surfaces (when you need them)

| If you want to understand... | Read |
|---|---|
| How file signals become triaged work | [Intake and triage](/guides/concepts/intake-and-triage) |
| Durable multi-session tracking | [Beads and state](/guides/concepts/beads-and-state) |
| Task graphs from intake / change-intent | [CLI reference](/guides/reference/cli) (graph + intake verbs) |

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
- In `solo` mode (the default), Construct runs entirely locally. If a cloud API is down, you can still work from `plan.md`, `.construct/context.md`, the latest handoff, git, and the local vector index (plus Beads/intake if you already opted in). See [deployment model](/guides/concepts/deployment-model) for team/enterprise options.
