<!--
docs/how-to/how-to-providers.md — How to manage model providers and external data sources.

Covers listing current model tier assignments, changing a tier,
applying configuration via construct models, and adding/scoping external sources.
-->

# How to Manage Providers

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

Edit `~/.construct/config.env`:

```bash
CONSTRUCT_MODEL_REASONING=openrouter/anthropic/claude-opus-4
CONSTRUCT_MODEL_STANDARD=openrouter/anthropic/claude-sonnet-4-5
CONSTRUCT_MODEL_FAST=openrouter/google/gemini-flash-2-0
```

Then apply:

```bash
construct models --apply
```

`--apply` rewrites the per-host model config files (Claude Code `settings.json`, OpenCode config, etc.) so every harness picks up the new assignment immediately.

## Adding External Data Sources

Construct connects to external systems via providers. Only configured repos/projects are focal anchors — everything else is ambient (ignored by auto-fetch, searchable via Rovo).

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

Shows each agent's average quality score and trace count — useful for deciding which tier to bump up before a review.

## Dry-run prompt optimization

```bash
construct optimize cx-engineer --dry-run
```

Previews prompt changes inferred from low-quality traces without applying them.

## Apply prompt optimization

```bash
construct optimize cx-engineer
```

Rewrites the agent's system prompt slice in `registry.json` based on recurring failure patterns in Langfuse traces. Requires `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to be set.

## Verify after changes

```bash
construct doctor
construct diff
```

`doctor` confirms all integrations are healthy. `diff` shows which agent prompts changed since HEAD.
