# Corpus provenance

All base material is real public content from the Argo CD project
(github.com/argoproj/argo-cd, Apache-2.0), retrieved 2026-08-05. The corpus
and the system it measures must not share an author, so the base documents are
verbatim copies; everything this project added is a plant, and every plant is
listed here. The fetched originals are kept in `raw/` so each edit is
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

Authored by `qwen3.6:35b` running locally under Ollama, not by the session
that wrote the lenses these plants measure. That session chose no document,
wrote no sentence, and picked no keyword; it inserted the paragraphs and
formatted the answer-key entries. The independence is partial and is stated
wherever these findings are scored: the five concern definitions given to the
authoring model came from the same session that wrote the lenses, so the
plants are independent in document choice, mechanism, wording, and keywords,
but share a taxonomy with what they measure.

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
