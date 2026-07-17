---
intake: none
---

# Workspace Control Plane Program — Charter

Started 2026-07-17 · Branch `feat/workspace-control-plane` · Epic `construct-b0nny`

Construct becomes a **workspace-level work and governance control plane over replaceable
human and AI execution runtimes**, founded on the dynamic capability/dependency graph as a
day-one operational subsystem. Full requirements: [directive.md](directive.md). Wave 0
evidence: [subagents/](subagents/) · Synthesis: [synthesis/](synthesis/).

## Operating rules

1. **Neutral names only.** No version-suffixed names ("v2", "next", "new-") in branches,
   modules, commands, docs, or beads. Things are named for their capability
   (workspace-control-plane, graph-foundation, …). The source PDF's filename is provenance
   metadata, nothing more.
2. **Old versions are cleaned up and reconciled, not abandoned.** Every replacement carries
   its deletion: superseded modules get deletion beads with criteria, migrated state gets
   reconciliation, deprecated surfaces get expirations, and installed artifacts (hooks,
   native triggers, launchd/systemd jobs) get uninstall paths. "Turn off the lights on the
   way out" is a program invariant, matching the repo's existing no-shim stance
   (STRATEGY.md: clean breaks, live self-healing migrations).
3. **Audit before replace.** No existing subsystem is rebuilt without an evidence-backed
   disposition (the graph audit already prevented one unnecessary rebuild — see
   [synthesis/consolidated-findings.md](synthesis/consolidated-findings.md) reconciliation 2).
4. **Evidence discipline.** Every load-bearing claim cites a path/sha/bead; `unverified`
   where thin. Agent-reported vs lead-confirmed is labeled.
5. **Waves need explicit maintainer opt-in.** This is a multi-week program; no mega-dispatch.
6. **Worktree isolation.** Program work happens in the program branch's own worktree; the
   primary checkout belongs to whichever session owns it. Shared tracker (beads) is the
   coordination point.
7. **Routing.** Per [subagents/routing-plan.md](subagents/routing-plan.md): strong single
   lead for verdicts/ontology/synthesis; bounded cheap workers for evidence; the
   `construct`/cx-operations chain for final bead filing.

## Wave plan × tracker

| Wave | Bead | Scope | Status |
|---|---|---|---|
| 0 | (this branch) | Baseline, truth map, graph audit, intent/drift, routing, synthesis, quick-win cleanups | **Done 2026-07-17** |
| 1 | `construct-b0nny.1` | Target product/conceptual model + work schemas (single lead) | Ready — needs opt-in |
| 2 | `construct-b0nny.2` → `.3` | Graph foundation design → build (port lib/graph onto relational store, incremental update, day-one milestone) | Blocked on Wave 1 |
| 2∥ | `construct-b0nny.4` | Retain/rebuild/replace/remove matrix + migration/cleanup strategy | Blocked on Wave 1 |
| 3 | `construct-b0nny.5` | Validation spikes A–F (disposable) | Blocked on Wave 2 |
| 4 | `construct-b0nny.6` | Executable bead program + neutral JSON export | Blocked on Waves 2∥/3 |
| — | `construct-b0nny.7`–`.11` | Independent cleanup/doc-debt beads (README `.cx/` rewrite, embeddings-legacy rename, scheduler + legacy-provider verification/removal, undocumented-systems docs) | Ready anytime |

## Wave 0 deliverables (this branch)

- [baseline.md](baseline.md) — repo state at cut, tooling health, incident record.
- [directive.md](directive.md) — condensed source-directive requirements (§-referenced).
- [subagents/execution-surfaces-truth-map.md](subagents/execution-surfaces-truth-map.md) —
  111-command CLI, 3 daemons, ~40 hooks, MCP call-gateway, duplication + dead-code
  inventory.
- [subagents/graph-and-state-audit.md](subagents/graph-and-state-audit.md) — graph reuse
  verdict (~60–70% substrate exists [source: that report's gap-table estimate];
  JSONL→relational port is the gap) + full state-store inventory.
- [subagents/intent-and-docs-drift.md](subagents/intent-and-docs-drift.md) — intent
  reconstruction, docs drift, versioning-hygiene inventory.
- [subagents/routing-plan.md](subagents/routing-plan.md) — dispatcher routing decision.
- [synthesis/consolidated-findings.md](synthesis/consolidated-findings.md) —
  reconciliations, amalgamation seed (D1–D9/X1–X5), assumption register (A1–A5), intent
  verdict, actions taken.
- Quick-win cleanups applied: spent codemod deleted, docs one-liners fixed, STRATEGY.md
  roster claims corrected (see synthesis § Immediate actions).
