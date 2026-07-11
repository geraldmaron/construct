<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0075: Explicit MCP install states — silence unconfigured servers

- **Date**: 2026-07-07
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: ADR-0066 (config-layer footprint — host config disposition), ADR-0064 (language & runtime strategy — MCP role in the integration surface)

> **Reconciliation note (2026-07-10, `refactor/consolidate-project-config-dir` merge):** this ADR was
> authored on that branch as ADR-0070 and renumbered to 0075 on staging, where 0070 was already
> taken (participation pipeline and rules schema).

<!-- Owning specialist: cx-architect. -->

## Problem

The MCP lifecycle is implicit: Construct discovers MCPs from a catalog, writes all catalog entries to host config (e.g., Claude.app settings, ~/.claude/settings.json), and then doctor/status commands warn about any optional MCPs that are not running. This creates three problems:

1. **Spurious warnings.** A user may have authenticated an MCP in the catalog (e.g., via a Claude.app connector) without intending to use it in Construct; their host config records that authentication, but Construct treats it as a misconfiguration and warns constantly.

2. **Config noise.** Authenticated-but-not-installed optional MCPs pollute host config, making it harder to see which integrations are actually active. A clean config should show only servers the user has explicitly chosen to use.

3. **Asymmetric auth tracking.** MCP protocols (stdio, HTTP) retrieve credentials from environment or transport-specific auth (e.g., HTTP Bearer token), so authentication is not inherently tied to whether a server is *installed* in the Construct sense. Construct should not write host config entries for servers that are only authenticated via those mechanisms, not explicitly chosen.

The current approach assumes one host (human) and one tool (Construct) and one config, so "authenticated in the catalog" and "should be in Construct's config" are synonymous. That assumption breaks when the same host config is shared across multiple tools or when a user enrolls one service for Claude.app but not for Construct.

## Context

MCP discovery is decoupled from Construct: the MCP SDK publishes a canonical catalog (MCPs.json or similar); Claude and other tools enumerate the catalog and prompt users to authorize. Construct imports that catalog (or reads it from the host config) and auto-discovers servers the host has authenticated. The current model writes all authenticated servers to `.claude/settings.json` the first time Construct runs, assuming they are all intended for Construct use.

Auth credentials in MCP protocols are managed separately: stdio MCPs read credentials from `STDIO_CREDENTIALS` (or similar env vars), HTTP MCPs use Bearer tokens in the `Authorization` header, and some MCPs support API keys in headers. A server can be authenticated (credentials available in the environment) without being *installed* (declared in Construct's host config). Conversely, a server can be *listed* in the catalog without being *authenticated* (no credentials available).

The construct-mcp server is a special case: it is internal to Construct and should be auto-wired whenever a Construct host integration is selected, regardless of catalog state.

## Decision

MCP lifecycle states are:

1. **Catalog** — the MCP is known and discoverable (listed in MCPs.json or another authoritative catalog), but the user has not enrolled it. **No auth, no config entry.**

2. **Installed** — the user has explicitly chosen to enroll this MCP for use in Construct (via `construct mcp install <name>`, a declarative config entry, or an integration selector UI). An installed MCP is written to active host config and Construct will attempt to start it. **May or may not have auth.**

3. **Enabled** — the MCP is installed AND has been verified to be healthy in this session or the last one. **Auth must be present; no warnings.**

4. **Healthy** — the MCP is enabled and has passed all runtime checks (process started, MCP protocol handshake, initial capability discovery). **Auth present, runtime verified.**

**Authentication is independent:** an MCP can be authenticated (credentials available) without being installed (never explicitly chosen). Construct does not write authenticated-but-not-installed servers to host config.

**construct-mcp exception:** when a Construct integration is explicitly selected (e.g., "use Construct as the active orchestrator"), construct-mcp is auto-installed regardless of catalog state. It does not require authentication (it runs in-process).

## Rationale

- **Silence spurious warnings.** Doctor and status only warn about installed MCPs that lack auth or fail health checks. Catalog-only and auth-only servers are ignored.
- **Clean host config.** Active config entries represent explicit user intent, not the union of all authenticated catalogs. A user who has authenticated an MCP for Claude.app but not for Construct sees no Construct config entry for it.
- **Future-proof auth.** As MCP auth becomes more sophisticated (per-session tokens, OAuth flows, key rotation), Construct's config layer can remain a *declaration of intent* while credentials live in environment variables or a separate credential store, out of the config file.
- **Independence of host tools.** Multiple tools can share the same host config without interfering: Claude uses it for Claude.app, OpenCode for OpenCode, Construct for Construct. Each tool reads only the MCPs it installed.

## Rejected alternatives

- **Implicit auto-installation on first auth.** Keep the current behavior: any authenticated MCP is automatically installed and written to config. Rejected because it does not solve the config-noise or host-tool-independence problems; a user who authenticates one service for one tool has it pop up in all tools' configs.
- **Flag-based filtering.** Mark each MCP entry in host config with metadata (`enabled: true` / `false`). Rejected because it still writes all authenticated servers to config, polluting it; filtering in the config reader is weaker than not writing them in the first time.
- **Separate credential store.** Move all MCP credentials out of environment vars and host config into a locked secrets file. Rejected because it requires infrastructure (key management, secure storage per platform) beyond what MCP SDK provides; MCP protocols already support env-var auth, so the simpler path is to use that.

## Consequences

- **Host config generation** (`lib/host-disposition.mjs`, `lib/mcp/config-sync.mjs`) writes only installed MCPs, not the full catalog. Installation is declared in `.construct/workflow.json` / `.construct/org/` or selected via a UI, not auto-detected.
- **Doctor and status** distinguish catalog state from active config:
  - `construct mcp list` shows all catalog MCPs with their state: `[ ] catalog-only`, `[+] installed`, `[✓] enabled`, `[✓] healthy`.
  - `construct doctor` warns only about installed MCPs that fail health checks, not catalog-only or auth-only entries.
  - `construct status` surfaces active MCPs, not the full catalog.
- **MCP install/uninstall** commands surface explicitly:
  - `construct mcp install <name>` adds it to the installed list and writes to host config.
  - `construct mcp uninstall <name>` removes it from installed and host config.
  - No implicit installation on first auth.
- **construct-mcp auto-wiring** checks: if any Construct integration is selected in the org config, auto-add construct-mcp to the installed list (or handle it in the runtime, not the config).
- **Optional MCPs in onboarding** (e.g., GitHub, OpenRouter) are presented as explicit install choices, not auto-detected from the catalog.
- **Backwards compatibility:** projects using the old implicit-auto-install model will see their old MCP config entries in host config, but Construct will not add new entries until explicitly installed. A migration note directs users to `construct mcp uninstall <name>` for MCPs they no longer want, cleanly removing them from config.

## Reversibility

One-way door in practice: once a user runs `construct mcp install github` explicitly and removes implicit entries via `construct mcp uninstall`, reverting to the implicit model would require re-writing the catalog to host config. But the install/uninstall commands provide a clean path forward and backward, so the core decision (catalog/installed/enabled/healthy as independent states) is easily reversible if a better model is discovered.

## References

- MCP SDK: crypto/stdio protocol, HTTP Bearer auth, CLI discovery
- ADR-0066 (config-layer footprint — host config is one surface of the config layer)
- ADR-0064 (language & runtime strategy — MCP role in language/runtime integration)
- Claude.app connector model: separate auth and enrollment decisions
