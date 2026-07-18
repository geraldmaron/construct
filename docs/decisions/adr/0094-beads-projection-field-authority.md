<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0094: Beads is a projection with explicit field authority and detect-and-report reconciliation

- **Date**: 2026-07-18
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: realizes `docs/notes/research/workspace-control-plane/synthesis/target-model.md` concept 16 ("Projection", the *replace* verdict) and concept 5 ("Work", the projection source of truth); builds on `docs/decisions/adr/0026-beads-git-native-sync.md` (the Dolt-remote-as-source-of-truth constraint this leaves unchanged) and `docs/decisions/adr/0092-single-project-identity-derivation.md` (the one `deriveProjectKey` workspace id the projection store keys against); reuses `lib/planning/` (E3 Work-spec/decomposition) and `lib/graph/` (E1); design doc `docs/notes/research/workspace-control-plane/synthesis/beads-projection-design.md`; bead `construct-b0nny.27`

<!-- Owning specialist: cx-architect. -->

## Problem

Directive §17's E8 outcome, and target-model.md concept 16, reframe Beads from *domain model* to one
*projection adapter*: the domain Work record is authoritative and the bead is a downstream mirror.
Two constraints make the shape non-obvious. First, CLAUDE.md makes `bd` MANDATORY for all task
tracking, so the projection layer must be strictly additive — no `.beads/` schema change, no broken
`bd` command. Second, this program already learned that `bd create --graph` is lossy (it drops
parent/deps/acceptance-criteria; the safe path is scripted per-issue `bd create` + `bd dep add`), and
program rule 2 forbids silent data loss — so the importer must not repeat that lossiness, and no field
of an existing bead may be dropped on import.

Nothing in the product declared *which side owns which field* when the domain model and the tracker
disagree, which is exactly the "aspirational wiring / dual source of truth" failure mode (D6) this
program has repeatedly corrected.

## Decision

Add a read-behind projection layer (`lib/tracker-projection/`) that treats bd as a mirror of a
graph-informed Work model, with three load-bearing decisions:

1. **Explicit, per-field authority.** A `field_authority` map (`{field: domain | tracker}`) declares
   ownership. bd *owns* its live operational fields (`status`, `assignee`, `owner`, `priority`,
   `labels`, and the audit timestamps `created_at`/`updated_at`/`started_at`/`closed_at`/
   `close_reason`); the domain (E1 graph + E3 Work-spec) owns the *derived* fields (`dependencies` and
   `parent` edges — directive §16 "dependencies must derive from the graph, not narrative intuition" —
   plus `title`, `description`, `issue_type` which mirror the Work spec). A domain-owned field is
   never overwritten by the tracker and vice-versa (concept 16 "Enforcement"). The full table is §3 of
   the design doc.

2. **Detect-and-report reconciliation, never silent overwrite** (concept 16: "Drift triggers
   reconciliation, not silent overwrite"). Reconciliation reads live bd (`bd list --all --json`, the
   existing lock-free concurrent read) and diffs against the durable projection store. A tracker-owned
   field that changed in bd is *absorbed* into the snapshot; a domain-owned field that changed in bd is
   a *conflict* reported as `drifted`, never clobbered. Projection lifecycle is concept 16's
   `projected → reconciling → in_sync → drifted`. Default reconciliation mutates nothing in bd.

3. **Read-only, raw-record-preserving import.** `importBeads` consumes a bd snapshot and builds one
   Projection per issue; because it never calls `bd create`, it structurally cannot repeat the
   `bd create --graph` lossiness. Every issue's *entire* original record is preserved verbatim in
   `raw_record` — including fields the model does not use (`dependency_count`, `comment_count`,
   `created_by`, …) — so import is provably zero-loss (design doc §5). The optional write-back path
   emits per-edge `bd dep add` plans (dry-run by default), never `bd create --graph`.

The projection store is JSONL under `.construct/tracker-projections/` (atomic write reused from
`lib/graph/store.mjs`), keyed by the one `deriveProjectKey` workspace id. bd stays the tracker CLI
surface; `construct tracker-projection import|reconcile|status` sits behind it.

## Consequences

- **bd is unaffected.** No `.beads/` schema change, no `bd` command touched; the layer is read-behind
  and additive. Reverting this bead leaves bd working unchanged (concept 16 "Rollback").
- **Drift is observable, not silent.** A tracker edit to a domain-owned field surfaces as a reported
  conflict instead of quietly winning or being quietly clobbered — the D6 failure mode is gated by the
  drift-detection test.
- **Tracker independence** (directive §19): the projection store loads with bd absent.
- **Validated on real data.** The importer and reconciler are proven against this program's own 38-bead
  history (`construct-b0nny` … `.31`), snapshotted (not read live) to stay robust to concurrent bd
  writers.
- **Deferred.** A second adapter (Jira/GitHub/Linear) and a materialized domain `work` store are out of
  scope; until a `work` store exists, the imported projection's captured values serve as the domain
  baseline for reconciliation.
