# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-05-08

Initial public release.

Construct ships as a local-first agent orchestration layer for OpenCode, Claude Code, and other coding surfaces, with a single user-facing persona that routes work across specialist agents and keeps shared project state aligned.

### Highlights

- **Distribution** — three install modes: project-pinned npm devDependency, global npm install, and bootstrap shims (`.construct/run.mjs` + `bootstrap.sh` + `bootstrap.ps1`) for non-Node projects. `construct init --devcontainer` for VS Code teams.
- **Provider system** — capability-driven contract with five built-in providers (GitHub, Atlassian Jira, Atlassian Confluence, Slack, Salesforce), per-provider circuit breakers, and a stable plugin contract for custom providers.
- **Plugin retrieval engine** — six-layer plugin contract (Embedder, Chunker, Indexer, Fuser, Reranker, Compressor) with RRF + MMR defaults and an eval harness covering Recall@k, MRR, and NDCG.
- **Security middleware** — CSRF double-submit, CORS allowlist, token-bucket rate limiting, structured JSON-line logger. Multi-token dashboard auth with per-token roles.
- **Reliability** — runtime contract enforcement (`enforcePacket` with chain-hashed JSONL violation log), embed daemon supervision (launchd / systemd / Task Scheduler), full system backup with SHA-256 manifest.
- **Storage** — hybrid file-state + Postgres+pgvector + JSON vector index fallback, configurable embedding models (local ONNX, OpenAI, Ollama, hashing).
- **AWS deploy** — Terraform modules for ECS/Fargate ≥ 2 tasks behind ALB with sticky sessions, RDS with pgvector parameter group, Secrets Manager, CloudWatch alarms, multi-stage hardened Dockerfile.
- **CI/Release** — matrix CI (ubuntu/macos × Node 20/22 + real Postgres + gitleaks), release pipeline producing Node SEA binaries per OS/arch, Docker GHCR push + Trivy scan, npm publish with provenance.
- **Documentation** — full doc set: getting-started, installation guides, provider guides, operations runbooks, security, AWS deploy, CLI/config/hooks/MCP-tools reference. Deprecation infrastructure and semver policy.

### Hard release-gate contracts

Every commit and PR is enforced against the same five local gates and the canonical commit + PR templates:

- `npm test`
- `node bin/construct lint:comments`
- `node bin/construct docs:verify`
- `node bin/construct docs:update --check`
- `npm run lint:templates`

Shortcut: `npm run release:check`. Full policy in `rules/common/release-gates.md`.
