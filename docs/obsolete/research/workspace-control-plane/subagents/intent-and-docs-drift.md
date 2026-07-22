---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Intent Reconstruction & Docs-Drift Report (Wave 0)

Produced 2026-07-17 by a bounded read-only investigation agent; edited for format by the
program lead. Notes: `.cx/context.md` does not exist — resumable context lives at
`.construct/context.md` (itself evidence of the path migration below). CHANGELOG history
starts at 1.3.0 (2026-06-29); earlier history trimmed.

## 1. Product intent

**Northstar (STRATEGY.md:19-35):** "One person, or a small team, can run a real software
organization from a single AI interface." Explicitly "organizational intelligence that
accumulates," not "another coding agent." Dogfood test: Construct runs the construct repo.

| Ambition | Evidence | Status |
|---|---|---|
| Persona/specialist orchestration (one front door, 12-specialist team behind) | `personas/construct.md`, `lib/orchestration-policy.mjs`, `specialists/org/` | **Load-bearing** |
| Hard gates / contracted evidence loop ("the loop is the product") | `lib/hooks/`, `lib/comment-lint.mjs`, `lib/contracts/`, `tests/hooks/no-skip-vars.test.mjs` | **Load-bearing** |
| Intake → triage → task-graph pipeline | `lib/intake/classify.mjs`, `lib/graph/` | **Load-bearing** |
| Oracle meta-controller (L0.5 overseer) | `lib/oracle/`, ADR-0043 | **Load-bearing** |
| Document I/O pipeline (docling ingest + export) | `lib/document-extract/`, `lib/document-export.mjs` | **Load-bearing** (active Unreleased work) |
| Artifact governance / manifest SSoT | `specialists/artifact-manifest.json`, `lib/artifact-loop-core.mjs` | **Load-bearing but partial** (manifest linkage "honestly empty" per architecture.mdx:376) |
| Beads-driven delivery | `.beads/`, `lib/beads-client.mjs` | **Load-bearing** |
| MCP tool broker | `lib/mcp/` | **Split:** direct dispatch load-bearing; *brokered* dispatch staged/experimental (architecture.mdx:494, construct-9oi4.10) |
| Deterministic flow engine | `lib/flows/`, ADR-0067 | **Built, delegation path dead** (no live caller, architecture.mdx:237) |
| Embedded Contract Layer | `lib/embedded-contract/` (5 contracts × 3 surfaces) | **Load-bearing** (parity-tested) |
| Org profiles / verticals | `lib/scopes/`, profile-lifecycle.md | **Infra load-bearing, adoption decorative** (STRATEGY:137 admits no non-rnd customer) |
| Org Studio + participation rules | `lib/org-studio/`, `lib/registry/org-api.mjs`, ADR-0070 | **Load-bearing code, undocumented** |
| Orchestration runtime + host seats | `lib/orchestration/runtime.mjs`, ADR-0063 | **Load-bearing** |
| Team/enterprise multi-tenant | `lib/queue/pg-queue.mjs`, `lib/team/` | **Mostly decorative** (README capability table: stub / not implemented) |
| Local conversation UI / dashboard / TUI | removed at 1.3.0 (ADR-0039/0041) | **Abandoned** — OpenCode-first replaced it |

**Diluted/decorative:** team+enterprise modes, brokered MCP, the flow-engine delegation
port, non-rnd profile verticals, `docs/roadmap.md` (empty generated placeholder).

## 2. Docs drift — claims vs code

`docs/guides/concepts/architecture.mdx` is unusually current (ADR-0091/0074, recent beads).
Drift concentrates in README.md, STRATEGY.md, and coverage gaps.

**Stale / misleading:**

1. **README treats `.cx/` as the canonical runtime state tree** — 13 references including a
   whole section (README:149-151 "`construct init` writes a runtime state tree at `.cx/`",
   plus `.cx/context.md`:85, `.cx/observations/`:147, `.cx/traces/`:151,
   `.cx/construct_guide.md`:45). Code contradicts: `lib/config-dir.mjs:28`
   `CONFIG_DIR_NAME = '.construct'` (ADR-0074); `lib/init-unified.mjs` writes `.construct/`
   and no longer scaffolds `.cx/inbox/`. `.cx` survives only as a backward-detection marker.
   **The state-layout section of the README is wrong.** Highest-impact doc fix.
2. **STRATEGY.md:60/79/117 claims the 29→12 specialist consolidation (ADR-0065) is "not yet
   applied."** Code: exactly 12 `cx-*.md` prompts and 12 org records;
   architecture.mdx:498-500 correctly says applied. STRATEGY (2026-07-06) went stale when
   the consolidation landed.
3. **`docs/README.md:36` copy-paste bug** — "`.construct` vs `.construct`" (operands
   identical).
4. **architecture.mdx:352 uses `construct matrix build`** — `matrix` is registered only as a
   deprecated alias of `graph` (`lib/cli-commands.mjs:1352`). Canonical prose should say
   `construct graph build`.
5. **`docs/roadmap.md`** is an empty placeholder ("_No roadmap items tracked yet._") yet
   linked from `docs/README.md:60` as the Roadmap.

**Implemented but absent from architecture.mdx** (0 mentions): Org Studio
(`lib/org-studio/server.mjs`, `construct studio`), participation rules (ADR-0070,
`construct participation`), scope/profile lifecycle (`lib/scopes/lifecycle.mjs`), packs as
the persona-resolution boundary (passing mentions only), multi-PM workspaces
(`construct workspace`), customer profiles, certification, headhunt/domain overlays,
cross-project synthesize.

## 3. Versioning / cleanup hygiene

The project has a strong no-backwards-compat stance (STRATEGY:78 "clean breaks, not
migration shims"; STRATEGY:128 "No `v2/`, no `b2/`"). Most "legacy"-named code is **live
self-healing migration**, not dead shims:

| Path | What | Verdict |
|---|---|---|
| `lib/reconcile/legacy-layout-migration.mjs` | pre-ADR-0074 `.cx/`+`.construct/` → `.construct/` | Live migration |
| `lib/reconcile/legacy-guide-decommit.mjs` / `legacy-skills-cleanup.mjs` / `legacy-doctrine-strip.mjs` | ADR-0027 relocations, frontmatter fixes, doctrine collapse | Live |
| `lib/config/legacy-config-migration.mjs` | pre-XDG config → XDG (ADR-0045) | Live |
| `lib/install/legacy-global-cleanup.mjs` | opt-in global-footprint strip | Live |
| `lib/migrations/v2-unified-registry.mjs` | registry schema stamp (consolidated contracts/teams JSON) | Live migration (name predates this program's no-version-name rule; rename candidate) |
| `lib/storage/embeddings-legacy.mjs` | **Misnamed** — active `hashing-bow-v1` fallback embedder, 8 importers | Live and load-bearing; rename candidate (`embeddings-hashing.mjs`) |
| `scripts/patch-registry-readers-v2.mjs` | one-shot codemod | **Likely spent** — removal candidate |
| `lib/deprecate.mjs` | deprecation-notice utility, 28 importers | Live utility |
| `construct matrix`, `--scope` flag, `construct chat`, `--legacy-extractor` | deprecated aliases / opt-in fallbacks | Live deprecated surfaces |

**Clean breaks already executed** (confirming the stance): `specialists/contracts.json` /
`teams.json` deleted (1.3.0); conversation UI + dashboard + desktop chat + Ink TUI removed
(1.3.0); `orchestration_delegation_next` MCP tool removed (ADR-0074/construct-1in3v);
`lib/intake/daemon.mjs` deleted.

## Cleanup recommendations (highest signal)

1. Rewrite README `.cx/` state-tree section and all runtime references to `.construct/`.
2. Update STRATEGY.md — the 12-specialist consolidation is done, not pending.
3. Fix `docs/README.md:36` duplicate-string bug.
4. Replace `construct matrix build` → `construct graph build` in architecture.mdx.
5. Rename `lib/storage/embeddings-legacy.mjs` (active fallback mislabeled "legacy").
6. Verify and remove `scripts/patch-registry-readers-v2.mjs` (spent one-shot).
