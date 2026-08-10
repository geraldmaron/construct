---
description: canonical inline citation methodology for Construct artifacts.
enforced_by: lib/comment-lint.mjs, lib/artifact-release-gate.mjs, lib/artifact-link-validate.mjs
precedence_tier: correctness
---
# Citation Methodology

Every load-bearing claim needs a citation the reader can open. Citations are
inline first, then mirrored in References (or the type's Sources table). A bare
URL dump at the end of a doc is not enough.

## 1. Preferred inline forms (pick one per claim; stay consistent inside a doc)

1. **Linked short title** (default for product/engineering and research prose):

   `… ([Supabase Auth](https://supabase.com/docs/guides/auth); accessed 2026-07-21).`

2. **Repo path marker** (internal evidence):

   `… [source: skills/docs/prd-workflow.md#spine].`

3. **Footnote** (dense academic or legal prose):

   `… [^1]` with `[^1]: Title — https://… (accessed YYYY-MM-DD)` in References.

Do not invent a fourth house style mid-document. If the template already uses
Admiralty Sources tables, keep the table **and** cite inline at the claim.

## 2. What a citation must carry

| Element | Required |
|---|---|
| Resolvable target | `https://…` URL, or repo path that exists, or defined footnote |
| Access or publication date | `accessed YYYY-MM-DD` or source date on the same cite / Sources row |
| Match to claim | The opened page must support the specific claim (research.md §5) |

Research Sources tables still record class + Admiralty grade (ADR-0017). The
inline cite is how the reader jumps from the sentence to the evidence.

## 3. Link validation

- Every `http(s)` URL in a typed artifact must resolve before publish
  (`construct artifact validate … --check-links`, wired into `citationLint`).
- Prefer canonical document URLs over search-result or index pages.
- Mark unresolved URLs `[unverified]` or remove them. Do not ship 404s.
- Offline authoring may pass `--no-check-links`; that does not waive verification
  before release.

## 4. Anti-patterns

- "Studies show…" / "vendors claim…" with no link or `[source: …]`
- Title-only cites ("see Architecture") that never name a URL or path
- References section that lists sources never pointed at from the body
- Fabricated URLs or ticket IDs (see `rules/common/no-fabrication.md`)

## 5. PDF / HTML export

Markdown links must remain real links in export. Do not strip hrefs for "clean"
typography. Spaced em dashes are banned in cite punctuation; use commas,
semicolons, or parentheses (`rules/common/human-voice.md`).
