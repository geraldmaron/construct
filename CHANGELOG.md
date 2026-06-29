# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Seeded the generated-asset quality fixture corpus (`construct-cuxq.10.1`): intentionally-bad anti-fixtures under `tests/fixtures/asset-quality/` driven by a declarative registry (`anti-fixtures.json`), with `tests/asset-quality/anti-fixtures.test.mjs` asserting each anti-fixture is rejected by its target audit (`lintDocPresentation`, `auditDeckMarkdownLayout`). Placeholder and empty-section cases are explicitly skipped as pending `construct-cuxq.2.2`, so the coverage gap stays visible rather than silently passing. Known-good goldens are unchanged.
- Added an orchestration readiness preflight for GitHub issue #323. `construct orchestrate preflight --json` and the flat MCP `orchestration_readiness` tool now report whether `orchestration_policy` and `orchestration_run` are attached/reachable, with a typed `reasonCode`, deterministic next step, redacted diagnostic bundle, and local readiness event.

## [1.3.2] - 2026-06-29

### Fixed

- `tests/certification/artifacts/gate-matrix.json` no longer churns on every run. `writeArtifactGateMatrixDoc` stamped a `generatedAt: new Date().toISOString()` into this tracked artifact, so the artifact-gates test rewrote it with a fresh timestamp each run — producing a perpetual timestamp-only diff. The field was write-only (never read; the matrix content is the signal), so it's dropped and the committed file is now deterministic.

### Security

- GitHub MCP wiring now defaults to **OAuth**, matching GitHub's hosted remote server (`https://api.githubcopilot.com/mcp/`) and the 2026 MCP standard (OAuth 2.1 + PKCE for remote HTTP servers). `construct mcp add github` writes a URL-only entry with **no Authorization header and no token on disk**; the host (Claude Code `claude mcp login github`, OpenCode `opencode mcp auth github`, VS Code/Cursor sign-in prompt) runs the one-click browser flow and stores the credential in its own secure store. This removes the previous behavior of embedding the literal `gh` token verbatim into every host config (`~/.claude/settings.json`, `.claude/settings.json`, `~/.config/opencode/opencode.json`, `.vscode/mcp.json`).
- A PAT remains available as an explicit opt-in fallback for headless/CI via `construct mcp add github --token`. Even then the credential is emitted as a host-resolved env reference — Claude `${GITHUB_TOKEN}`, VS Code/Cursor `${env:GITHUB_TOKEN}`, OpenCode `{env:GITHUB_TOKEN}` — never the literal value. `lib/mcp-platform-config.mjs` builds the entries; `tests/mcp-secret-ref.test.mjs` guards both the OAuth (no-header) default and the no-literal-leak property of the PAT path.

## [1.3.1] - 2026-06-29

### Fixed

- Project-mode Claude Code hooks no longer crash when Claude Code runs a hook from a working directory other than the project root. The generated `.claude/settings.json` hook commands now anchor on `node "${CLAUDE_PROJECT_DIR:-.}/.construct/run.mjs"` instead of a bare relative `.construct/run.mjs`, which previously failed with `Cannot find module …/.construct/run.mjs` (cjs/loader) on every Bash tool call when the cwd was `$HOME`. Existing installs self-heal on `construct sync` / `construct upgrade`.
- `construct doctor consistency` no longer reports 38 non-actionable package-internal warnings on a clean init. `roles-drift` was counting a specialist's own `id` and `name` as two owners (every specialist read as "ambiguous after normalization"); `mcp-drift` was scraping every `export function` in `lib/mcp/tools/*.mjs` (sweeping in private helpers like `exec`/`read_json`) and matching against a brittle `name === '<tool>'` dispatch pattern that the `xxxTool`→`'xxx'` naming convention never satisfied. Both checks are now correct at the source, and a genuinely dead `getTeam` import was removed from the MCP server.

### Changed

- `construct doctor consistency` separates operator tiers: user-actionable findings show by default, while package/maintainer diagnostics (`mcp-drift`, `roles-drift`) are summarized as a count and surfaced in full only under `construct doctor consistency --strict` (`--all`/`--debug`). A clean tree now reads `0 warning(s)`.

## [1.3.0] - 2026-06-29

This release makes OpenCode the primary conversation surface, retires the web/dashboard tier in favor of a terminal-first architecture, and consolidates the legacy registries into a single unified registry (RFC-0004). It contains two breaking changes — see **Removed**.

### Added

- Agent-reachable MCP tool surface: `find_tool` intent-driven tool discovery (ADR-0048), an artifact loop, and OpenCode auth hardening.
- Intent-driven, team-aware orchestration: requests route to teams with blocked-decision handling; typed team integration sources drive scoped `provider_fetch` reads.
- Oracle governance: swarm dispatch, a `cross-team-handoff-blocked` synthesized signal, and team governance oversight.
- Demo plug-in layer: `demo init --from-project`, an expanded canonical catalog of 6 terminal scenarios, and a self-demo guided tour via bare `construct`.
- `construct` CLI primitives: a `display-width` primitive and a shared presentation core with clickable links and chat ticker/wrap fixes.
- `registry:validate --unified` gates the unified registry (RFC-0004 Phase 1.4).

### Changed

- OpenCode is now the first-class conversation surface. `construct sync` installs the front-door agent, MCP wiring, and runtime plugin; the `construct` CLI remains setup/admin/headless infrastructure.
- The previous local conversation-loop capability has been replaced by `surfaces.opencode-primary` in the capability registry.
- All registry consumers (MCP `list_teams`/`get_team`, policy-inventory, staleness graph, doctor watchers) now read the unified registry instead of the legacy `contracts.json`/`teams.json` files.
- Demo execution is recording/tour oriented: VHS and Playwright surfaces are supported, with printed script steps as fallback.
- Research-shaped host conversations now classify through `orchestration_policy` and execute through `orchestration_run`; the OpenCode front-door prompt no longer implies that `workflow_invoke` itself performed evidence gathering.
- OpenCode now emits its host-facing MCP tool ids in the front-door prompt (`construct-mcp_orchestration_policy` / `construct-mcp_orchestration_run`) so research routing can execute instead of failing host-side tool validation.
- PDF artifact generation now preserves ordered-list numbering, loosens body and heading spacing, and widens page margins so published PRDs, decisions, research briefs, and generic PDFs read like release-grade documents instead of cramped exports.
- Bare `construct` launches chat; `construct chat` is deprecated.
- CI gates run through thin `npm run` wrappers over `bin/construct`; the workflows no longer re-spell the underlying commands.

### Removed

- **Breaking:** the `chat --web` browser launcher has been removed. Construct chat is terminal-only; there is no web/browser surface to launch.
- **Breaking:** the legacy `contracts.json` contract files have been deleted. Readers now resolve contracts from the unified registry; any consumer reading `specialists/contracts.json` directly must migrate to the unified-registry shape.
- Retired the dashboard web app and HTTP server, the native desktop chat window, and the dead Ink TUI — Construct is terminal-first (ADR-0039/0041 amended).
- Removed Construct's local conversation UI implementation, related package surface, docs page, and surface-specific tests.
