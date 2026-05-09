<!--
docs/getting-started.md — Construct onboarding guide: 10-minute path from install to first agent run.

Covers npm install, first-run wizard, project init, and core concepts.
-->

# Getting Started with Construct

This guide takes you from zero to a running Construct session in under 10 minutes.

## Install

```bash
npm install -g @geraldmaron/construct
```

Or run without installing:

```bash
npx @geraldmaron/construct setup
```

Verify the install:

```bash
construct doctor
```

A healthy install shows all checks green. If anything is red, follow the inline fix hint or see [docs/operations/troubleshooting.md](operations/troubleshooting.md).

## First-run wizard

Run `construct setup` once after install. It configures your user environment interactively:

```bash
construct setup
```

The wizard:

1. Writes `~/.construct/config.env` with your API keys and model preferences
2. Starts a managed local Postgres instance (used for observations and sessions)
3. Generates shell completions for bash or zsh

To accept defaults without pausing at prompts:

```bash
construct setup --yes
```

To skip managed Postgres (if you are supplying your own database):

```bash
construct setup --yes --no-docker
```

## Initialize a project

Inside any project directory:

```bash
cd ~/my-project
construct init
```

This stages `.cx/` — the project-local state directory — with:

- `.cx/context.md` — active project context injected at session start
- `.cx/context.json` — machine-readable state mirror
- A documentation lane scaffold (`docs/`) with the preset you choose

Optional flags:

```bash
construct init --docs-preset=product   # PRDs, ADRs, runbooks
construct init --with-architecture     # also create docs/architecture.md
```

## Your first agent run

Sync the agent adapter files so Claude Code (and any other host) can find your agents:

```bash
construct sync
```

Then open Claude Code in the project directory. At session start, Construct injects a context block showing:

- The working branch
- Active workflow status
- Prior observations from previous sessions

Start asking questions or issuing tasks — your agents are ready.

## Key concepts

### Agents

Agents are named AI personas with distinct roles (engineer, architect, PM, security reviewer, etc.). They live in `agents/registry.json`. `construct list` shows all available agents.

### Personas

Personas are the system prompts attached to agents. They define tone, decision boundaries, and skill sets. Files live in `personas/`. Edit them freely and run `construct sync` to propagate changes to all host platforms.

### Skills

Skills are domain knowledge playbooks (security, design, web performance, etc.) injected into agent context on demand. They live in `skills/`. `construct skills scope` classifies which skills are relevant for the current project's tech stack.

### Hooks

Hooks are small Node scripts that run before and after each tool use in your AI session. They enforce guardrails (no secrets committed, no force-push to main), record the audit trail, inject session context, and recover from errors. Hook files live in `lib/hooks/`. See [docs/reference/hooks.md](reference/hooks.md) for the full inventory.

## Useful next steps

| Task | Command |
|---|---|
| See all commands | `construct --help` |
| Import seed observations | `construct bootstrap` |
| Check memory layer | `construct memory stats` |
| List agents | `construct list` |
| Open dashboard | `construct serve` |
| Run health check | `construct doctor` |
