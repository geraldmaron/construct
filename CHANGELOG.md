# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- OpenCode is now the first-class conversation surface. `construct sync` installs the front-door agent, MCP wiring, and runtime plugin; the `construct` CLI remains setup/admin/headless infrastructure.
- The previous local conversation-loop capability has been replaced by `surfaces.opencode-primary` in the capability registry.
- Demo execution is recording/tour oriented: VHS and Playwright surfaces are supported, with printed script steps as fallback.
- Research-shaped host conversations now classify through `orchestration_policy` and execute through `orchestration_run`; the OpenCode front-door prompt no longer implies that `workflow_invoke` itself performed evidence gathering.
- OpenCode now emits its host-facing MCP tool ids in the front-door prompt (`construct-mcp_orchestration_policy` / `construct-mcp_orchestration_run`) so research routing can execute instead of failing host-side tool validation.
- PDF artifact generation now preserves ordered-list numbering, loosens body and heading spacing, and widens page margins so published PRDs, decisions, research briefs, and generic PDFs read like release-grade documents instead of cramped exports.

### Removed

- Removed Construct's local conversation UI implementation, related package surface, docs page, and surface-specific tests.
