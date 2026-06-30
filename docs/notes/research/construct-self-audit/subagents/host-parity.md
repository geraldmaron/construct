---
intake: none
---

# Subagent Evidence Report: Host parity audit

> Agent C · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Construct's host parity system distinguishes between file-config existence (file parity) and actual host installation/capability (capability parity). The parity.mjs module checks six hosts by examining config files, agent/MCP registries, and file presence, classifying uninstalled hosts as absent and passing parity when all installed hosts have synced content. However, no degradation messaging occurs when hosts with partial artifacts exist but lack config files. The system treats file presence as ground truth and does not emit warnings when capabilities diverge between hosts or when an expected host is missing, leaving discoverability gaps for users with heterogeneous setups.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Parity audits file existence, not capability | `lib/parity.mjs:293-315` — checkCursor() returns status absent when ~/.cursor/mcp.json missing, regardless of ~/.cursor/ dir presence. Test confirms: cursor dir exists but no mcp.json reports not installed | confirmed |
| No degradation message for missing-but-expected hosts | `lib/parity.mjs:439-450` — Summary generation (lines 439-450) maps status absent to not installed; no special messages for hosts expected by entry.platforms filter or registry | confirmed |
| Capability matrix is hardcoded in platforms/capabilities.json | `platforms/capabilities.json, lib/platforms/capabilities.mjs` — Six hosts defined with canonical attributes: hasNativeSubagents (Claude/OpenCode true, others false), MCP support, config format, local-model provisioning. Registry loaded as data by lib/platforms/capabilities.mjs for sync and init | confirmed |
| Host detection uses binary presence checks, not capability probes | `lib/host-capabilities.mjs:108-119,160-261` — detectHostCapabilities() checks: version string via command, file existence (VS Code settings.json, Cursor mcp.json, .github/prompts). No probe of MCP server responsiveness or actual agent execution | confirmed |
| Entry platform filtering exists but is not used in current registry | `lib/parity.mjs:13-14,104-108` — Code comment: entry.platforms is an allowlist that filters surfaces; documented in lib/parity.mjs:13-14. No grep hits in specialists/org files show any platforms field in actual entries | confirmed |
| Cursor adapter config written but tool reports not installed when binary absent | `lib/host-capabilities.mjs:109, scripts/sync-specialists.mjs:290-293` — sync-specialists.mjs writes ~/.cursor/mcp.json when cursor in HOST_SELECTION (line 293). detectHostCapabilities checks cursor binary first (line 109), reports missing if not in PATH even when config exists. Test: no cursor binary, ~/.cursor/ present, reports not installed | confirmed |
| Parity passes when any installed host matches expected, misses cross-host capability drift | `lib/parity.mjs:438, test output: vscode ok (4/0 mcps)` — checkParity() line 438: ok = true when every surface is ok\|absent\|legacy-install. Hosts with different MCP server counts (eg VS Code 4/0) pass as ok. No check for capability alignment across selected hosts | confirmed |
| MCP server parity allows extras, not missing; host discrepancy silent | `lib/parity.mjs:126-128` — mcpStatus() line 127: missing.length===0 means ok. Host with extra MCP servers (e.g. VS Code has construct-mcp,context7,playwright,sequential-thinking) reports ok. No metric for server-count parity across hosts | confirmed |
| No degradation message when local model degradation occurs during orchestration | `lib/embedded-contract/execution.mjs:145, lib/parity.mjs` — embedded-contract/execution.mjs reports degradationReason only in the execution-capability contract response, not emitted to user. Host using local model marked as degraded but no MCP tool warns user proactively | likely |
| Codex MCP server credential resolution differs from OpenCode but parity checks only file existence | `docs/guides/reference/mcp-tools.md:26-35, lib/parity.mjs:231-240` — docs/guides/reference/mcp-tools.md line 33: Codex omits unresolved tokens at sync time; OpenCode defers to runtime. lib/parity.mjs checkCodex() only checks agents/*.toml files, not token state | confirmed |

## 3. Confirmed gaps

- No user-facing degradation message when a host is installed but reports as not-installed due to missing config file (e.g. Cursor binary absent but ~/.cursor/mcp.json written)
- No capability-discovery tool that tells users which orchestration modes are available given their installed host set (MCP-orchestrated vs full-native vs prompt-only)
- No parity check that MCP servers are actually reachable/responsiveness from a host at sync time or at query time; assumes file-presence equals capability
- No registry of expected MCP servers per host-capability-level; parity allows silent drift in MCP count between hosts without warning
- No degradation message when orchestration degrades to prompt-only or same-family-fallback at runtime; execution-capability contract is buried in MCP response
- entry.platforms filtering is implemented but never used in registry; appears to be a capability that was planned but not populated in specialists/org
- Codex token resolution happens at sync time (omit unresolved) while OpenCode defers to runtime (defer reference); parity does not detect this host-specific behavior difference

## 4. Unconfirmed concerns

- Whether .cursor dir existence (observed ~18 subdirs on test machine) without mcp.json indicates partial install or just stale artifacts from prior sessions; parity has no semantic understanding of this
- Whether detectHostCapabilities probing binaries in PATH is sufficient; some CI/container setups may have editors available but not in PATH
- Whether the platforms capability matrix should gate agent/skill dispatch or if all agents should be available on all hosts (current: no platforms filtering in use)
- Whether MCP extra servers on VS Code (playwright, sequential-thinking) are user-added or Construct-added; parity allows them without distinguishing provenance

## 5. Registry / config / schema opportunities

- Move hardcoded mcpStatus(), checkCursor(), checkCodex(), etc. logic into a registry-driven host-check table: {hostId, configPath, kind, extension, expectedKey, ...} so new hosts/checks need only registry entry
- Expose entry.platforms as actual data by populating it in specialists/org for agents that should not run on certain hosts, enabling sync to skip/warn for incompatible combinations
- Add a degradation-reason field to host-check results so sync can emit specific warnings: not-installed, config-missing, mcp-unresolvable, token-unset, server-unreachable
- Create a host-capability-availability MCP tool or CLI command that returns {requestedHost, available, degradationReason, fallbackHosts} to give users discoverability

## 6. Tests needed

- Test: parity reports when entry.platforms filters a host but that host is installed and expected (currently no filtering is active)
- Test: sync handles Cursor-not-in-PATH but mcp.json already present (should it update? should it warn?)
- Test: parity detects when VS Code MCP server list diverges from Cursor/Codex and surfaces it as a multi-host capability drift warning
- Test: degradation message surfaces to user when local model is used in orchestration (currently only in embedded-contract response)

## 7. Docs needed

- Update docs/guides/reference/mcp-tools.md section on host wiring to explain degradation modes: what happens when Codex token is unresolved vs VS Code MCP offline vs OpenCode subagent runtime limit
- Document the reconciliation question in docs/guides/concepts/: .cursor dir existence without mcp.json indicates what? Is it a partial install that sync should complete or stale artifacts?
- Document entry.platforms field in specialists/org-schema or doc-guides so developers can declare host-specific entries (currently defined in code but never used)

## 8. Migration concerns

- ADR-0027 defines disposition (ignored vs tracked vs asked-before-modify) but does not address capability parity; users upgrading from versions where hosts diverged in MCP content may not get alignment
- Legacy v1.0.10 user-scope orchestrator at ~/.claude/ is detected as legacy-install but users who also have Cursor/VS Code may not know those need migration too

## 9. Questions for Opus

- Should entry.platforms be populated in the current registry to enable capability-aware sync, or is it a future feature? Code is wired but data is absent.
- When Cursor binary is absent but ~/.cursor/mcp.json exists (from a prior sync), should the next sync update it, leave it, or warn? Currently treated as not-installed.
- Is host capability parity (e.g. all orchestrated hosts have same MCP server set) a requirement, or is per-host MCP drift acceptable? Current parity allows silent drift.
- The degradation-reason contract is only returned via execution-capability MCP tool; should users get a sync-time warning when a host cannot reach a required MCP server?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- Add bead: Host parity checks by capability, not just file existence. Entry point: read the platforms capability matrix and the parity results together to emit discoverability warnings
- Add bead: Multi-host orchestration readiness. When user has both Claude Code (native) and VS Code (MCP-orchestrated), are they correctly wired to share context and dispatch chains?
- Add bead: Degradation messaging on sync. When constructCapabilitiesActive degrades from full-orchestrated to prompt-only or same-family-fallback, emit a user-visible warning with the reason

