<!--
docs/installation/devcontainer.md — Devcontainer recipe for Construct.

Covers construct init --devcontainer, the shipped template, and how Construct
services and hooks wire up inside a container.
-->

# Devcontainer Setup

Construct ships a devcontainer template that wires up hooks, MCP server, and managed Postgres inside a container. All team members get an identical environment with no local install required.

## Initialize

Inside your project:

```bash
construct init --devcontainer
```

This writes `.devcontainer/devcontainer.json` from the shipped template at `templates/devcontainer/devcontainer.json`. If a `.devcontainer/devcontainer.json` already exists, Construct merges the Construct-specific sections rather than overwriting.

Open the project in VS Code (or GitHub Codespaces) and reopen in container when prompted.

## What the template provides

- **Node 20** base image with Construct pre-installed
- **Postgres 16** service container with pgvector extension
- **Environment variable forwarding** — `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and other `CONSTRUCT_*` vars are forwarded from the host or from Codespaces secrets
- **Port forwarding** — dashboard port 4242 and memory service port exposed
- **Post-create command** — runs `construct setup --yes --no-docker && construct sync` automatically on container first start

## Hook configuration inside the container

The devcontainer sets `CX_TOOLKIT_DIR` to the container's Construct install path so the MCP server and hook scripts resolve correctly regardless of where the project is mounted.

Hook commands in `.claude/settings.json` use the global `construct` binary:

```json
{ "type": "command", "command": "construct hook session-start" }
```

No shim is needed because `construct` is on the container PATH.

## Database

The Postgres service container starts automatically. `DATABASE_URL` is pre-set to point at it. The `pgvector` extension is enabled so the vector search path works without additional setup.

To inspect the database from inside the container:

```bash
psql "$DATABASE_URL"
```

## Codespaces secrets

When running in GitHub Codespaces, set these repository secrets:

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for model calls |
| `GITHUB_TOKEN` | Auto-provided by Codespaces; no manual setup needed |
| `LANGFUSE_PUBLIC_KEY` | Optional — enables trace observability |
| `LANGFUSE_SECRET_KEY` | Optional — required if `LANGFUSE_PUBLIC_KEY` is set |

Codespaces forwards repository secrets into the container environment automatically.

## Updating the template

If Construct ships a newer devcontainer template, regenerate your local copy:

```bash
construct init --devcontainer --force
```

`--force` overwrites the existing `.devcontainer/devcontainer.json`.
