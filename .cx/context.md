# Session Context
Last saved: 2026-05-22

## What was in progress

Large architecture pass on `dev` branch. All changes committed and ready to push.

## What was done this session

### Committed (d21b175)
- Read-tracker delta batching, host parity across Claude Code/Codex/OpenCode/Cursor/Copilot, small-model support in prompt-composer

### Pending commit (all staged, tests pass 66/66)

**Strategy & intelligence:**
- Multi-scope strategy store (`lib/strategy-store.mjs`) — `.cx/knowledge/decisions/strategy/{scope}.md`
- Strategy never auto-updates from ingested documents — explicit user action only
- `/api/strategy` GET/PUT and `/api/recommendations` GET/PATCH dashboard endpoints
- `db/schema/004_recommendations.sql` and `005_strategy.sql`
- Workspace type field + overlay auto-selection in prompt-composer
- Template conflict detection + resolution (`lib/init-update.mjs`)
- Auto-sync on git merge/checkout (`.beads/hooks/post-merge`, `post-checkout`)

**Research & personas:**
- `cx-researcher` rewritten to principal/academic standard — most-recent-first, domain starting points, URL verification, scope boundary vs cx-ux-researcher and cx-rd-lead
- `rules/common/research.md` — recency-first, domain starting points table, URL verification requirement
- `skills/roles/researcher.md` — new anti-patterns: wrong starting point, unverified URLs; self-check updated
- `templates/docs/research-brief.md` — structured source table, per-finding observation/inference/confidence
- Research grounding added to cx-ux-researcher, cx-explorer, cx-rd-lead
- Strategy grounding added to cx-business-strategist and cx-rd-lead

**Full persona alignment pass:**
- Fake Tool Contract stubs removed from cx-qa, cx-security, cx-sre, cx-ai-engineer, cx-platform-engineer, cx-data-analyst, cx-orchestrator
- cx-orchestrator rewritten — references real `agents/contracts.json`, fictional MCP tools removed, routing table added
- cx-docs-keeper — fake Tool Contracts and Parallel Execution boilerplate removed
- Role manifest fences fixed: business-strategist, legal-compliance, orchestrator
- Platform-engineer typos fixed

**CI hardening:**
- Dead `lib/evals/**` filter removed; `tests/engine-eval-retrieval.test.mjs` added to retrieval filter
- `skills/**`, `rules/**`, `templates/**` added to agents filter
- npm cache added to test matrix
- Weekly gitleaks schedule added
- Dead `master` triggers removed from docs.yml and pages.yml
- docs.yml bot push hardened with `git pull --rebase`
- Trivy pinned off `@master` → `@0.28.0`
- Release gate: `doctor` + `docs:verify` added
- Dependabot added (`.github/dependabot.yml`) for npm + actions
- `aws-smoke.yml` migrated from static credentials to OIDC
- Terraform `1.7` → `~> 1.9` in deploy.yml and aws-smoke.yml
- Terraform Plan hardened: exit code 2 = valid, PR comment always posted, job fails on real errors
- npm publish: OIDC Trusted Publishers (no static token) with `--provenance`

## Open questions / follow-up
- Set up npm Trusted Publisher on npmjs.com (one-time): package → Settings → Trusted Publishers → add GitHub Actions with repo + workflow file name
- Postgres end-to-end test needs real Docker infrastructure
- File-based team mode (git-tracked `.cx/` for small teams without Postgres) — tracked as open bet

## Architecture decisions made
- Strategy store: multi-scope directory `.cx/knowledge/decisions/strategy/{scope}.md`, never auto-updated
- Recommendation store: P0-P3 scoring, Postgres dual-mode, JSONL fallback
- Prompt pipeline: strategy fragment at priority-3, workspace-type overlay auto-selection
- Research policy: most-recent-first (not year-hardcoded), domain-specific authoritative starting points
