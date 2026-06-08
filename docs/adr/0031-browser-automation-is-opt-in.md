---
intake: none
intake_rationale: footprint decision recorded from a "do we need Playwright at all" audit; primary evidence is repository code (file:line cites below) and prior ADRs 0024/0025/0027/0029.
last_verified_at: 2026-06-08
verified_by: construct · code audit of specialists/registry.json, platforms/claude/settings.template.json, lib/mcp-catalog.json, lib/mcp-manager.mjs, scripts/sync-specialists.mjs on branch feat/playwright-opt-in
---

# ADR 0031: Browser automation (Playwright MCP) is opt-in, not a default-managed MCP

- **Date**: 2026-06-08
- **Status**: proposed
- **Deciders**: Construct·Architect
- **Supersedes**: none
- **Extends**: [ADR 0024](0024-document-io-optional-capability.md) (rejected Puppeteer's bundled headless Chromium on footprint grounds — applies the same footprint test to the Playwright MCP), [ADR 0025](0025-explicit-activation-model.md) ("aware, never ambient" — a heavyweight capability no prompt invokes is ambient), [ADR 0027](0027-host-project-footprint-and-non-destructive-scaffolding.md) and [ADR 0029](0029-install-scopes-and-hook-budgets.md) (project-local-by-default; no silent heavyweight writes).

## Problem

The Playwright MCP server (`@playwright/mcp`) was written into **every** Construct project's Claude config by default, but it was not earning that ambient slot:

- **No prompt directs its use.** Neither `personas/construct.md`, `specialists/prompts/cx-qa.md`, nor `specialists/prompts/cx-researcher.md` instruct the agent to drive a browser, take screenshots, or run Playwright. `lib/mcp-catalog.json` lists it in `usedBy: [construct, cx-qa, cx-researcher]`, but that is a capability inventory, never a goal-directed instruction.
- **Redundant for the common case.** `cx-researcher` already has `WebSearch`/`WebFetch` (`specialists/registry.json:275`) and `context7` (core docs MCP) covers library/framework lookups. Playwright adds value only for *interactive* DOM/JS/screenshot work, which no prompt requests.
- **Heavyweight footprint.** `npx -y @playwright/mcp` downloads browser binaries (hundreds of MB) on first use — the exact cost [ADR 0024](0024-document-io-optional-capability.md) rejected Puppeteer for, and which `CHANGELOG.md` compares to `playwright install` pre-fetching browsers.
- **Inconsistent with its own opt-in model.** `lib/mcp-catalog.json` already classifies Playwright `category: "optional"` and a first-class opt-in command exists (`construct mcp add <id>`, `lib/mcp-manager.mjs:255`). But the project-scope sync (`scripts/sync-specialists.mjs`, `writeProjectClaudeSettings`) merges the full `platforms/claude/settings.template.json` `mcpServers` and the full `specialists/registry.json` `mcpServers` into every project regardless of catalog category — so Playwright was installed despite the opt-in model. (Global scope had already pruned it via the `GLOBAL_CLAUDE_MCP_IDS` allowlist; the inconsistency was project scope.)

The decision-forcing tension: keep browser automation as an ambient default for the rare case it might be used, or move it behind the existing explicit opt-in to honor the footprint doctrine while preserving the one genuine niche (cx-qa live web-UI testing).

## Decision

**Demote Playwright from the default-managed MCP set to explicitly opt-in. Keep the capability; drop the ambient install.**

- Remove `playwright` from `specialists/registry.json` `mcpServers` and from `platforms/claude/settings.template.json` `mcpServers` — the two sources `writeProjectClaudeSettings` merges into project config. Project sync no longer writes it.
- Retain the `playwright` entry in `lib/mcp-catalog.json` (`category: "optional"`), version-pinned to `@playwright/mcp@0.0.75` (no cold-start `@latest` resolution), so `construct mcp add playwright` installs it on demand.
- Because Playwright is no longer in the registry, the global prune (`syncGlobalClaudeMcpServers`) treats a user-added entry as a non-Construct MCP and leaves it alone — opt-in persists across `construct sync`.
- Document the opt-in in `specialists/prompts/cx-qa.md`: live-browser UI testing requires `construct mcp add playwright`.

Full deletion was rejected: QA browser-based UI testing (E2E, visual regression, keyboard/a11y of a live page) is a legitimate future need; the capability should remain one command away, not gone.

## Consequences

- **Footprint**: a fresh `construct init`/`sync` no longer carries a hundreds-of-MB browser-binary liability that no prompt exercises. Consistent with ADR-0024/0025/0027/0029.
- **Opt-in cost**: agents/users who genuinely need browser automation run `construct mcp add playwright` once. The capability is discoverable via `construct mcp list` (under "Enhancements").
- **Scope**: `construct mcp add` writes to the user's global `~/.claude/settings.json` (`lib/mcp-manager.mjs` `getClaudeSettingsPath`), so opt-in is per-user, not per-project. Acceptable because it is an explicit user choice, not a silent default; narrowing it to project scope is a follow-up if desired.
- **Follow-up (not in this ADR)**: the systemic fix is to make `writeProjectClaudeSettings` honor catalog `category` so *all* `optional`/`integration` MCPs (`memory`, `sequential-thinking`, `github`) follow the same opt-in rule at project scope — mirroring the `GLOBAL_CLAUDE_MCP_IDS` allowlist already used for global scope.
- **Coverage**: `tests/sync-contract.test.mjs` asserts project settings exclude `playwright` and that the global prune preserves a user-added `playwright` entry.
