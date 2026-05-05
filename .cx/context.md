# Session Context
Last saved: 2026-05-01 17:55

## Focal Sources (Anchors)

### GitHub Repos
- hashicorp/project-iverson
- hashicorp/cloud-reliability
- hashicorp/team-delivery-intelligence

### Jira Projects
- RLBLT
- DI
- RRM

### Ambient Sources (All Other Accessible Repos/Projects)
- Auto-ignored by provider_fetch
- Accessible via rovo_search for explicit queries

## Chain-Following Rules
- Metadata captured for 1-hop links from anchor items
- Linked items are NOT auto-fetched unless in focal sources or explicitly queried
- FRB/PLAT/PLCC tickets are ambient — only surfaced via rovo_search or explicit request

## Search Strategy

| Tool | Scope | Stores Observations? | Cost |
|---|---|---|---|
| `provider_fetch` | Focal sources only (cheap API) | Yes | Free |
| `rovo_search` | All accessible sources (AI search) | No | Rovo credits |
| `memory_search` | Local observation store | N/A | Free |

## Embedding Model
- Default: local ONNX (Xenova/all-MiniLM-L6-v2, 384d)
- Configurable via CONSTRUCT_EMBEDDING_MODEL env var
- Options: local, openai, ollama, hashing

## Vector Storage
- Primary: Postgres with pgvector (HNSW index)
- Fallback: Local JSON vector index
- Auto-synced every 5 minutes by embed daemon

## What was in progress
- Reopened roadmap work into fresh issues after tracker cleanup.
- Completed `construct-nye`: dashboard source/build sync is now a first-class repo command and CI/release check.
- Completed `construct-mvf`: local deploy/runtime contract is fixed and documented.
- Completed `construct-1yu`: local auth metadata groundwork is wired through server and dashboard surfaces.
- Remaining ready work: `construct-dj5` (live AWS deploy validation) and `construct-bo7` (real provider-backed OAuth/RBAC).

## Session efficiency snapshot
155 reads · 96 unique files · 59 repeated reads · 67 large reads · 2294 KB read

## Open issues
- `construct-dj5` — live AWS deploy validation for ECS runtime contract
- `construct-bo7` — OAuth provider login and role-based auth implementation
