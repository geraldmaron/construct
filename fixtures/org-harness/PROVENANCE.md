# Corpus provenance

All base material is real public content from the Argo CD project
(github.com/argoproj/argo-cd, Apache-2.0), retrieved 2026-08-05. The base
documents are verbatim copies; everything this project added is a plant, and
every plant is listed here. The fetched originals are kept in `raw/` so each edit is
auditable as a diff.

## Base documents

| Corpus file | Origin |
| --- | --- |
| `strategy.md` | `docs/roadmap.md` at commit `7fac91022fbfac4ce774ec1ed24c56532261ec46` |
| `prd-progressive-sync-deletion.md` | `docs/proposals/deletion-strategy-progressive-sync.md` (HEAD, 2026-08-05) |
| `rfc-001-sync-impersonation.md` | `docs/proposals/decouple-application-sync-user-using-impersonation.md` |
| `rfc-002-manifest-hydrator.md` | `docs/proposals/manifest-hydrator.md` |
| `tickets/T-<n>.md` | issue `<n>` on argoproj/argo-cd, body verbatim (URL in each file's header) |

## Edits (the plants)

1. `strategy.md`, ApplicationSet section: added the paragraph ruling out
   ordered/automated deletion of ApplicationSet children (the C1 conflict with
   the PRD).
2. `tickets/T-26443.md`: added the push-to-stage observation paragraph
   (cross-reference X1 to rfc-002).
3. `tickets/T-26271.md`: added the paragraph noting failures correlate with
   the impersonation flag and the cluster credential is broad
   (cross-reference X2 to rfc-001).
4. `tickets/T-28511.md`: added the paragraph naming the rollingSync order and
   reverse deletion strategy (cross-reference X3 to the PRD).
5. `tickets/T-27949.md`: added the hydrator-pilot paragraph (one half of risk
   R2; the other half is rfc-002 as written).
6. `prd-progressive-sync-deletion.md`: frontmatter title only.
7. `notes/note-1.md`, `notes/note-2.md`: authored whole as the notes-drop
   scenario stimulus (notes play the user's own words, not measured material).

Risk R1 needed no edit: it falls out of combining rfc-001 with
`tickets/T-28695.md` as both stand. Ticket headers carry an origin line added
to every ticket file.

## Role-lens additions (2026-08-05, before the first run scored against them)

`tickets/T-27846.md` (progressive-sync metrics, verbatim, no edits) was added
as the sixteenth ticket so the analyst lens has ground truth to see. The
role-lens findings (TP1, A1, CP1, L1) in `answer-key.json` cite corpus text as
it already stood — they are labels over existing evidence, not new edits.


## Edits added 2026-08-10 (the wave-B plants)

Authored by `qwen3.6:35b` running locally under Ollama; the session that
wrote the lenses inserted the paragraphs and formatted the answer-key entries.

- `SA1` (strategy-alignment), inserted into `strategy.md` after the passage matching "First class support for ApplicationSet resources"; the finding requires reading it against `prd-progressive-sync-deletion.md`.
- `SD1` (system-design), inserted into `notes/note-1.md` after the passage matching "hydrator rollback work"; the finding requires reading it against `notes/note-2.md`.
- `OP1` (operations), inserted into `notes/note-2.md` after the passage matching "incident runbook says switch"; the finding requires reading it against `notes/note-1.md`.
- `UX1` (user-experience), inserted into `prd-progressive-sync-deletion.md` after the passage matching "Non-Goals"; the finding requires reading it against `strategy.md`.
- `TH1` (security), inserted into `notes/note-1.md` after the passage matching "diff story is fixed"; the finding requires reading it against `strategy.md`.

Known weaknesses in this batch, recorded before any run scored against it:
`TH1`'s mechanism overlaps the pre-existing `X2` impersonation finding, so a
run can reach it without the security reasoning it is meant to require; and
the authored register is more formal than the informal notes two of the
plants sit in, so a plant may be locatable by style rather than by synthesis.


### Replanted 2026-08-10 (third entry), committed before any run scored them

Nine plants, one per role that carries a depth claim, each keyed to the
territory in the table below rather than to a kind of finding. Drafted against
the corpus by authors who were kept away from the answer key, the previous
plants, and the recorded runs, so none of them could anchor on what already
failed. Inserted paragraphs, by role:

| Plant | Role | Inserted into | The mechanism |
| --- | --- | --- | --- |
| `L2` | legal | `rfc-002-manifest-hydrator.md`, `tickets/T-28239.md` | the hydrated branch credits a human author copied from the dry commit, and the only thing that could prove it defaults to off |
| `SA3` | strategy | `strategy.md` | controller sharding is unstaffed because the same pair owns the Stable-promotion punch list |
| `C2` | product | `prd-progressive-sync-deletion.md` | Reverse deletion's determinism promise assumes strictly sequential steps, against a proposal for concurrent ones |
| `TP2` | program | `tickets/T-28927.md` | a shape freeze at Stable forecloses an open proposal's restructuring, and neither ticket references the other |
| `A2` | analyst | `tickets/T-27949.md` | an asserted incidence rate with no counter that could confirm or refute it |
| `SD2` | architect | `rfc-002-manifest-hydrator.md` | proto2 `required` fields cannot be loosened once a second caller exists |
| `OP2` | operations | `tickets/T-28239.md` | a bad signing key crash-loops the fleet behind a generic pod-health alert |
| `UX2` | design | `tickets/T-27327.md` | a rejected push leaves the operator at a failed-push message with no cause and no way forward |
| `TH3` | security | `tickets/T-28239.md` | the signing key sits in the shared control-plane namespace, so anything with Secret reach there can produce commits verification trusts |

`CP1` is unchanged: it already discriminated, and it is the model the rest were
written against. Every retired plant keeps its paragraph in the corpus and its
grading exactly as recorded, so runs already scored stay readable.

Known risks, recorded here BEFORE any run is scored against these, rather than
discovered afterwards: five of the nine sit on the manifest-hydrator and
commit-signing material, so a run that sweeps that area may earn several; `L2`
and `TH3` share a document pair and are separated only by their term sets; and
`C2` and `TP2` both bear on the parallel-steps proposal, from different pairs.
The next sweep is what decides whether these held.

### Why the first batch could not discriminate (root cause, 2026-08-10)

The plants were keyed to a KIND of finding rather than to the territory a role
uniquely owns, and several roles ask overlapping questions. The clearest case:
`product` asks "do any two commitments contradict, strategy against
specification" and `strategy` asks "which recorded commitment does this
contradict". A plant keyed to a contradiction between the roadmap and the spec
therefore cannot separate them, no matter how its terms are written. It was
doomed by the question sets, not by its wording.

`CP1` survives for the mirror-image reason: it is keyed to which identity acts
and whose audit trail follows, and no other lens asks that.

So a discriminating plant is keyed to the OWNING LENS'S UNIQUE SLOT, not to a
generic conflict, risk, or cross-reference:

| Role | The territory only it asks about |
| --- | --- |
| compliance | which identity acts, and whose audit trail follows |
| legal | who authored a record, and what the organization is bound by |
| program | what an interim restriction blocks in a *different* workstream |
| product | a promise made twice, incompatibly, about scope |
| strategy | what gets displaced, unstaffed, or slipped by saying yes |
| architect | what becomes hard to undo, and the second consumer |
| operations | how anyone finds out at 3am, and what they can do then |
| design | where a person gets stuck with no way forward and no way back |
| security | what someone gains by making it break |
| analyst | what cannot be observed, and the missing baseline |

`engineering` gets no plant: no depth claim rests on it, deliberately and
permanently, because the hosts are the engineers. `X1` and `X2` remain as
cross-reference gates and stop being read as evidence about a role.

### Discrimination measured 2026-08-10 (the sweep that reopened the depth claims)

Every lens was dispatched once over this corpus, clean context, on the tuned
family, and the resulting matrix is
`runs/2026-08-10-claude-sweep.discrimination.json`. It asks of each planted
role finding which lenses earned it. The result: `CP1` is produced by its owner
and by nobody else; `SD1` and `OP1` are missed by their own lens; the remaining
ten (`A1`, `C1`, `L1`, `SA2`, `TH2`, `TP1`, `UX1`, `X1`, `X2`, `X3`) are also
produced by lenses that do not own them, up to nine non-owners for `C1` and
`SA2`.

Those ten cannot support a claim that the owning lens reaches depth, and this
is a property of the plants, not of the runs that scored against them. No
keyword set is being tightened in response: keywords are a proxy for stating a
mechanism, so narrowing them after seeing which lenses collided is both editing
a key to fit results and a change that moves the coincidence rather than
removing it. The plants stay exactly as they are, graded exactly as they were,
and are recorded here as not depth-bearing. Replacements have to be authored as
mechanisms only one lens has reason to look for, which is a corpus question
rather than a scoring one.

`SA2` is the sharpest case: it names the same mechanism over the same document
pair as `C1`, and its keyword sets are supersets of `C1`'s, so every claim that
earns `C1` earns `SA2` for free. It was never capable of measuring the strategy
lens.

### Retired 2026-08-10 (same day, before further runs)

`TH1` and `SA1` are retired and replaced by `TH2` and `SA2`. Both originals
were keyed on phrases quoted from the documents rather than on the mechanism,
and `TH1` was paired with a document that does not carry its mechanism at all,
so a run that reasoned correctly and cited the right pair still scored a miss.
The replacements key on mechanism vocabulary with alternatives. The plant
paragraphs already inserted in the corpus are unchanged; only the answer-key
entries that grade them were rewritten. Runs already scored against `TH1` and
`SA1` keep their recorded results.
