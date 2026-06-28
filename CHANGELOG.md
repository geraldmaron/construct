# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- OpenCode is now the first-class conversation surface. `construct sync` installs the front-door agent, MCP wiring, and runtime plugin; the `construct` CLI remains setup/admin/headless infrastructure.
- The previous local conversation-loop capability has been replaced by `surfaces.opencode-primary` in the capability registry.
- Demo execution is recording/tour oriented: VHS and Playwright surfaces are supported, with printed script steps as fallback.

### Removed

- Removed Construct's local conversation UI implementation, related package surface, docs page, and surface-specific tests.
