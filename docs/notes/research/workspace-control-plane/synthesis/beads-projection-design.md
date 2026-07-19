---
intake: none
---

# Beads projection, field authority, and reconciliation (E8) — design

- **Bead**: construct-b0nny.27 (directive §17 E8)
- **Status**: reviewed before implementation (this document is acceptance criterion 1)
- **Depends on**: construct-b0nny.23 (E3 Work-spec model, `lib/planning/`), construct-b0nny.3/.12/.21 (E1 graph, `lib/graph/`)
- **Source model**: [docs/notes/research/workspace-control-plane/synthesis/target-model.md](target-model.md) concept 16 "Projection" (the *replace* verdict) and concept 5 "Work" (the projection source of truth)

## 1. Problem

Today Beads (`lib/beads-client.mjs`, `.beads/`) is treated as the tracker of record: sessions
create, claim, close, and depend beads directly, and no other store claims authority over the same
facts. target-model.md concept 16 reframes Beads (directive §9, quoted there: "If Beads remains it
is a projection adapter, not the domain model") from *domain model* to one **Projection adapter**:
the domain Work record (concept 5) is authoritative, and the bead is a downstream mirror carrying
only projected fields plus a field-authority map that declares which side owns each field.

Two hard constraints frame the work:

1. **bd must stay fully usable.** CLAUDE.md makes bd MANDATORY for all task tracking. This bead is
   strictly additive (target-model.md concept 16 "Deletion behavior": removing a Projection adapter
   leaves domain Work unaffected) — it must not modify `.beads/` schema or break any `bd` command.
2. **No lossy import.** Program rule 2 forbids silent data loss. This program already learned that
   `bd create --graph` is lossy — it drops parent/deps/acceptance-criteria (memory: "bd-graph-create
   lossy"; the safe path is scripted per-issue `bd create` + `bd dep add`). Whatever this bead builds
   must not repeat that lossiness.

## 2. Scope

In scope (bead requirements 1–4):

- A **field-authority** definition: which bd fields bd owns vs. which are projected from E1/E3 (§3).
- A **reconciliation** mechanism that detects drift between bd and the projected source — an ongoing,
  re-runnable sync, not a one-time import (§4).
- **Importers** that build Projection records from bd issues while preserving each issue's full raw
  record, even fields the model does not use (§5).
- **Validation** against this program's own bd history (construct-b0nny.1 … the whole construct-b0nny
  program) as the non-trivial corpus (§6).

Out of scope (non-goals): replacing bd or any `bd` command; a second tracker adapter (Jira/GitHub/
Linear — concept 16 "Extension" caps first-party adapters at ≤2 and defers them); auto-writing
reconciled values back into bd by default (§4.4 keeps the default detect-and-report, per concept 16
"Drift triggers reconciliation, not silent overwrite"); building the domain `work` store itself
(that is E3/future — this bead treats the imported projection's captured values as the domain
baseline until a `work` store exists).

## 3. Field authority (reviewed before implementation)

A Projection record (concept 16 schema) carries a `field_authority` map, `{field: domain | tracker}`.
The rule (concept 16 "Enforcement", directive §9): **a field owned by the domain is never
overwritten by the tracker, and a field owned by the tracker is never overwritten by the domain.**

bd's issue shape (observed from `bd list --all --json` on this repo — keys:
`id, title, description, status, priority, issue_type, assignee, owner, created_at, created_by,
updated_at, started_at, closed_at, close_reason, dependencies, dependency_count, dependent_count,
comment_count, parent, labels`) maps to authority as follows.

| bd field | authority | rationale |
|---|---|---|
| `status` | **tracker (bd)** | Live operational lifecycle. Sessions claim/close via `bd update`/`bd close`; the tracker is where in-flight state lives. The domain never clobbers it. |
| `assignee` | **tracker (bd)** | Live operational assignment, set in bd during work. |
| `owner` | **tracker (bd)** | Operational ownership recorded in bd. |
| `priority` | **tracker (bd)** | Live triage decision made in bd. |
| `labels` | **tracker (bd)** | Operational tagging (e.g. `execution-program`) applied in bd. |
| `started_at`, `closed_at`, `close_reason` | **tracker (bd)** | Tracker audit timestamps produced by bd lifecycle transitions. |
| `created_at`, `created_by`, `updated_at` | **tracker (bd)** | Tracker-owned provenance/audit metadata. |
| `dependencies` (edges) | **domain (E1/E3)** | Directive §16 (quoted in concept 7): "Bead/Assignment dependencies must derive from the graph, not narrative intuition." Dependency edges are the E3 decomposition's `dependsOn`, graph-checked by `lib/planning/decomposition-check.mjs`. Projected *into* bd, not authored in bd. |
| `parent` | **domain (E1/E3)** | The parent/child edge is graph structure (Work `contains` child Work, concept 5), projected from the decomposition, not a bd-authored fact. |
| `title` | **domain (E3)** | Mirrors the domain Work spec's title/objective (concept 16 example: "the Beads issue mirrors title/status/acceptance"). |
| `description` | **domain (E3)** | The what/why body — objective, requirements, acceptance criteria — is the Work spec (concept 6). The spec is the source; bd mirrors it. |
| `issue_type` | **domain (E3)** | Work shape (epic/task) derives from the Work/Plan topology (concept 5 "Extension"), not a bd-local choice. |
| `id` / `external_id` | **identity (shared)** | The bead id *is* the Projection's `external_id` (concept 16 schema); it links the mirror to its domain `work` id and is never rewritten by either side. |
| `dependency_count`, `dependent_count`, `comment_count` | **tracker (bd), derived** | bd-computed counts. Preserved in `raw_record`; never projected back. |

Design consequences:

- **Domain-owned field diverging in bd = drift/conflict** — the tracker edited a field it does not own.
  Reconciliation *reports* it and does not clobber (concept 16 "reconciliation detects and reports
  drift rather than clobbering").
- **Tracker-owned field diverging in bd = a normal bd update** — bd legitimately changed its own
  field; reconciliation *absorbs* it into the projection snapshot. Not a conflict.
- Every field, regardless of authority, is preserved verbatim in `raw_record` (§5).

## 4. Reconciliation mechanism

`reconcileProjection(projection, liveIssue, { domainRecord })` compares one stored Projection against
the current live bd issue (and, when available, the current domain-authoritative field values):

- For each **tracker-owned** field: if `liveIssue[field]` differs from the projection's last snapshot,
  record an **absorbed** update (the projection snapshot should adopt the live value).
- For each **domain-owned** field: the authoritative value is `domainRecord[field]` when a domain
  `work` store is supplied, else the projection's captured baseline. If `liveIssue[field]` differs
  from that authoritative value, record a **conflict** (domain drift) — reported, never clobbered.

Projection lifecycle (concept 16: `projected → reconciling → in_sync → drifted`):

- no differences → `in_sync`
- only absorbed (tracker-owned) updates → `reconciling` this pass, `in_sync` after the snapshot adopts
  them
- any domain-owned conflict → `drifted`

`reconcileAll(projections, liveIssues, opts)` folds the per-item results into one drift report
`{ inSync, absorbed, drifted, missing }`, where `missing` is a projection whose bead vanished from bd
(concept 16 "Deletion behavior": a deleted tracker item marks the Projection `drifted`, it does not
delete domain Work).

This is an **ongoing sync**, not a one-time import: it reads live bd on every run (`bd list --all
--json`, the same lock-free concurrent read `lib/beads-client.mjs` already uses) and diffs against the
durable projection store (§5), so drift that accumulates as bd is actively used is caught on the next
reconcile.

### 4.1 Write-back safety (the anti-lossiness rule)

Default reconciliation is **detect-and-report** and never mutates bd. When a caller explicitly opts to
re-project domain-owned dependency edges *into* bd, the plan is emitted as **per-edge `bd dep add`
commands** (`planDependencyProjection`), never `bd create --graph` — directly honoring the program's
standing lesson. The plan is dry-run by default; nothing reaches the bd shell boundary unless the
caller executes it, so the live tracker is never at risk during reconciliation or tests.

## 5. Importers and raw-record preservation

`importBeads(issues)` is **read-only relative to bd**: it consumes a bd snapshot (array of issues from
`bd list --all --json`) and builds one Projection record per issue. Because it never calls `bd
create`, it structurally cannot repeat the `bd create --graph` lossiness.

Each Projection (concept 16 schema, realized as plain JSON for a JSONL store):

```
Projection {
  id                # projection id: "beads:<external_id>"
  workspace         # deriveProjectKey(rootDir) — the one workspace identity (E2/M1)
  work              # domain work id this mirrors (null until a work store exists)
  tracker           # "beads"
  external_id       # the bead id
  field_authority   # { field: domain | tracker } (§3)
  state             # projected | reconciling | in_sync | drifted
  fields            # last-synced field values, split by authority
  raw_record        # the entire original bd issue, verbatim — the preserved source-of-import
  importedAt, reconciledAt
}
```

**Raw-record preservation** (concept 16 "Enforcement"; directive §14.16): `raw_record` is a deep clone
of the *entire* original issue object — including fields the new model does not use
(`dependency_count`, `dependent_count`, `comment_count`, `created_by`, `started_at`, `close_reason`,
…). Zero-data-loss is provable: for every imported issue, `raw_record` deep-equals the original. No
field is dropped, coerced, or summarized on the way in.

Durable store: `lib/tracker-projection/store.mjs` persists projections as JSONL under
`.construct/tracker-projections/beads.jsonl` (+ `meta.json`), reusing the atomic tmp-then-rename write
`lib/graph/store.mjs` already uses. JSONL keeps the store diff-clean and re-verifiable.

## 6. Validation corpus

The test corpus is this program's own bd history: `construct-b0nny` plus `construct-b0nny.1 … .31`
(including the `.5.1 … .5.6` spike sub-beads) — 38 real beads, snapshotted with `bd list --all
--limit 0 --json`. Because a sibling agent may touch bd concurrently, tests **snapshot** the corpus
(a captured JSON array) rather than reading live bd mid-assertion.

Acceptance-criterion tests:

- **Field authority**: a domain-owned field (e.g. `title`) edited in bd survives as a reported
  conflict, not a clobber; a tracker-owned field (e.g. `status`) edited in bd is absorbed.
- **Drift detection**: import the real corpus (all `in_sync`), then introduce an intentional
  domain-owned drift on one bead and assert `reconcileAll` reports exactly that bead as `drifted`
  with the drifted field named.
- **Raw-record preservation**: import all 38 program beads and assert every `raw_record` deep-equals
  its original, with zero data loss across every field.
- **Tracker independence**: the projection store is readable with bd absent (concept 16 test;
  directive §19) — the JSONL store needs no bd process to load.

## 7. Module layout

```
lib/tracker-projection/
  field-authority.mjs   # FIELD_AUTHORITY map + isDomainOwned/isTrackerOwned/authorityFor
  projection.mjs        # buildProjection(issue, opts) — pure, raw_record-preserving
  import-beads.mjs      # importBeads(issues) + snapshotBeads() (read-only bd read)
  reconcile.mjs         # reconcileProjection / reconcileAll / planDependencyProjection
  store.mjs             # JSONL durable persistence under .construct/tracker-projections/
  cli.mjs               # construct tracker-projection import|reconcile|status
```

The CLI sits *behind* bd (integration contract: bd stays the tracker CLI surface). It never issues a
bd write in normal operation; `import`/`reconcile`/`status` are read-and-diff operations over the
durable store.
