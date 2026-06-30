---
intake: none
---

# Host Capability Matrix — contract (host-parity-gate)

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Bead: `construct-rr63.4.1`
Enforces the host-parity-gate (risk R4). Companion test:
`tests/functional/host-capability-matrix.functional.test.mjs`.

## The gap this contract closes

`lib/parity.mjs` `checkParity()` judges each host by **config-file presence and content**, not by
**capability**. Verified directly (empty `homeDir`):

- Result shape is `{ ok, surfaces[], summary[] }`. Each surface is
  `{ surface, kind, status, dir|file|paths }` plus drift detail. There is **no** `callable`,
  `reachable`, `discoverable`, `degradationReason`, or `installed` field anywhere.
- A surface is `absent` when its config file/dir is missing → summarized as `"<host>: not installed"`.
- Overall `ok` is `true` when every surface is `ok` **or** `absent` **or** `legacy-install`.
- Therefore: a host with a config file listing the expected MCP servers reads as `ok` **whether or
  not the host is actually installed and able to call those servers**; and a fleet of entirely
  absent hosts still passes parity.

Motivating case (Phase-0 baseline): a `.cursor` adapter directory exists for a host that
`construct doctor` reports as **not installed** — file presence and capability have diverged, and
`checkParity` has no vocabulary to express it.

## What each current status proves / does not prove

| Current status | Proves | Does NOT prove |
|---|---|---|
| `absent` | the config file/dir is missing | the host is uninstalled (file could be pruned independently) |
| `ok` | the config file lists the expected MCP servers | the host is installed, discovers the tools, or can call them |
| `drift` | the config file's server set differs from expected | anything about runtime capability |
| `unreadable` | the config file exists but failed to parse | — |
| `legacy-install` | stale v1.0.10 artifacts present | — |

## Target capability dimensions (Wave-4 contract)

Each host surface should additionally report capability, distinct from file parity:

| Field | Meaning |
|---|---|
| `discoverable` | the host can enumerate Construct's tools/agents at runtime |
| `callable` | the host can actually invoke them (binary present + transport reachable) |
| `degraded` | capability is reduced below the host's expected tier |
| `degradationReason` | typed reason: `not-installed` · `config-missing` · `mcp-unresolvable` · `token-unset` · `server-unreachable` |
| `expectedTier` | the orchestration tier the host is expected to reach (below) |

## Host orchestration tiers (proposed — each row to be confirmed by the Wave-4 capability probe)

Grounded in current code signals (`lib/orchestration/runtime.mjs` `hostRole`, the
`orchestration-run.mjs` note that VS Code/Copilot and Cursor have "no subagent primitive", and the
`construct doctor` cross-surface line). Tiers are the **proposed** target, not an assertion of each
host's present runtime state:

| Host | Proposed tier | Expected degradation when unavailable |
|---|---|---|
| Claude Code | native subagent (`cli-direct`) | falls back to prompt-only |
| OpenCode | MCP-orchestrated (agents) | `server-unreachable` → prompt-only |
| VS Code / Copilot | MCP-orchestrated (`copilot-mcp`, no subagent primitive) | `mcp-unresolvable` → prompt-only |
| Cursor | MCP-orchestrated (no subagent primitive) | `not-installed` / `config-missing` |
| Codex | MCP-orchestrated | `token-unset` → prompt-only |

`[to verify in Wave 4]` — the per-host tier and degradation values above must be proven by an actual
capability probe before any of them is reported as fact. This document defines the **shape**; it does
not certify any host's live capability.

## Non-destructive constraint

Pruning a stale adapter (the `.cursor` case) is an **ask, not silent** action
(`construct sync --reconcile=adapter-prune`). The capability matrix must report the divergence; it
must not delete host artifacts on its own.

## Gate status

This contract + the companion characterization test open the host-parity-gate. The Wave-4
implementation bead (capability reporting + typed degradation, registry-driven host-check table) is
authored only after this gate is green.
