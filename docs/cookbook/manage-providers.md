---
title: Manage providers
description: "GitHub, Jira, Confluence, Slack, Salesforce: credentials, contracts, and the capability matrix."
---

Construct routes LLM calls across three tiers: **reasoning**, **standard**, and **fast**.
Each tier maps to a single model ID drawn from your configured provider (OpenRouter by default).

## List current assignments

```bash
construct models
```

Output:

```
Current model assignments:
  reasoning  openrouter/anthropic/claude-opus-4
  standard   openrouter/anthropic/claude-sonnet-4-5
  fast       openrouter/google/gemini-flash-2-0
```

## Change a tier

Edit `~/.construct/config.env` (preferred env keys — `CONSTRUCT_MODEL_*` is deprecated but still honored):

```bash
CX_MODEL_REASONING=openrouter/anthropic/claude-opus-4
CX_MODEL_STANDARD=openrouter/anthropic/claude-sonnet-4-5
CX_MODEL_FAST=openrouter/google/gemini-flash-2-0
```

Control which models appear in pickers via `construct.config.json`:

```bash
construct config set models.visibility.mode all_configured
construct models list
construct models list --json
```

Then apply:

```bash
construct models --apply
```

`--apply` rewrites the per-host model config files (Claude Code `settings.json`, OpenCode config, etc.) so every harness picks up the new assignment immediately.

## Subscription Bridges (Host-Native Models)

If you have an active subscription to GitHub Copilot or Anthropic (via Claude Code), you can utilize these models in OpenCode without needing additional API keys.

Construct automatically detects active sessions (e.g., via `gh auth status`) and provisions a local **Bridge Service** that acts as an OpenAI-compatible proxy.

### Use Copilot Models in OpenCode

1. Authenticate with GitHub: `gh auth login`
2. Start Construct services: `construct dev`
3. Open OpenCode: `opencode`
4. The models will be available as `github-copilot/gpt-4o`, `github-copilot/claude-3.5-sonnet`, etc.

See the [Host-Native Models guide](./use-host-native-models.mdx) for more details.

## Adding External Data Sources

Construct connects to external systems via providers. Only configured repos/projects are focal anchors: everything else is ambient (ignored by auto-fetch, searchable via Rovo).

### GitHub Repos

```bash
# In ~/.construct/config.env
GITHUB_REPOS=hashicorp/project-iverson,hashicorp/cloud-reliability,hashicorp/team-delivery-intelligence
```

### Jira Projects

```bash
# In ~/.construct/config.env
JIRA_BASE_URL=https://hashicorp.atlassian.net
JIRA_USER_EMAIL=your@email.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECTS=RLBLT,DI,RRM
JIRA_FETCH_RECENCY_DAYS=30
```

### Verify Provider Connections

```bash
construct providers test github
construct providers test jira
```

### Fetch from a Focal Source

```bash
construct provider_fetch "project iverson"
construct provider_fetch "RLBLT"
```

### Broad Search Across All Sources

```bash
# Uses Rovo AI search — returns excerpts, does NOT store in memory
construct rovo_search "Iverson reliability"
```

## Embedding Models

Construct uses neural embeddings for semantic search. The model is configurable via the dashboard or env vars.

### Available Models

| ID | Provider | Model | Dimensions | Cost |
|---|---|---|---|---|
| `local` | ONNX | Xenova/all-MiniLM-L6-v2 | 384 | Free |
| `openai` | OpenAI | text-embedding-3-small | 1536 | Paid |
| `ollama` | Ollama | nomic-embed-text | 768 | Free (local) |
| `hashing` | Local | hashing-bow-v1 | 256 | Free (legacy) |

### Change Embedding Model

```bash
# In ~/.construct/config.env
CONSTRUCT_EMBEDDING_MODEL=openai
OPENAI_API_KEY=sk-...
```

Or via the dashboard Models screen.

## List all agents with quality scores

```bash
construct optimize --list
```

Shows each agent's average quality score and trace count: useful for deciding which tier to bump up before a review.

## Dry-run prompt optimization

```bash
construct optimize cx-engineer --dry-run
```

Previews prompt changes inferred from low-quality traces without applying them.

## Apply prompt optimization

```bash
construct optimize cx-engineer
```

Rewrites the agent's system prompt slice in `registry.json` based on recurring failure patterns in telemetry traces. Requires `CONSTRUCT_TELEMETRY_PUBLIC_KEY` and `CONSTRUCT_TELEMETRY_SECRET_KEY` to be set.

## Verify after changes

```bash
construct doctor
construct diff
```

`doctor` confirms all integrations are healthy. `diff` shows which agent prompts changed since HEAD.
