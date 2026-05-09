<!--
docs/installation/local.md — Full local installation guide for Construct.

Covers npm global install, npx one-shot usage, first-run wizard options, and
how to verify the install with construct doctor.
-->

# Local Installation

## Requirements

- Node.js 20 or later
- npm 9 or later
- Docker Desktop (optional — for the managed local Postgres instance)

## Install globally

```bash
npm install -g @geraldmaron/construct
```

After install, the `construct` command is on your PATH.

## Run without installing

Use `npx` to run Construct without a global install:

```bash
npx @geraldmaron/construct setup
npx @geraldmaron/construct doctor
```

Every subsequent command works the same way with `npx @geraldmaron/construct <command>`.

## First-run wizard

Run `construct setup` once after install:

```bash
construct setup
```

What it does:

1. Creates `~/.construct/` — your user config directory
2. Writes `~/.construct/config.env` with API keys and model preferences you supply
3. Starts and configures a managed local Postgres container (Docker required)
4. Installs shell completions

### Wizard flags

| Flag | Effect |
|---|---|
| `--yes` | Accept sensible defaults at every prompt without pausing |
| `--no-docker` | Skip managed Postgres startup (supply `DATABASE_URL` yourself) |

### Non-interactive setup

For CI or scripted environments, set environment variables before running:

```bash
ANTHROPIC_API_KEY=sk-ant-... \
construct setup --yes --no-docker
```

## Verify the install

```bash
construct doctor
```

Doctor checks:

- Node and npm versions
- `~/.construct/config.env` present and readable
- Postgres reachable (if configured)
- Hook scripts present in the Claude Code settings file
- MCP server binary resolves correctly

All checks print `ok` on a healthy install. Failing checks print the error and a suggested fix.

## Update

```bash
construct update
```

This reinstalls the current checkout globally, re-runs `construct sync` to regenerate platform adapter files, and verifies all host configurations are current.

## Uninstall

```bash
npm uninstall -g @geraldmaron/construct
```

User data in `~/.cx/` and `~/.construct/` is not removed automatically. Delete those directories manually if you want a clean slate.
