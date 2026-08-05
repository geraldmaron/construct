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
