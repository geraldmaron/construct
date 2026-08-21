# The extraction ladder, evidenced per filetype

Claims about which rung of the extraction ladder handles a filetype, and what
it says when none does, are only real once someone has actually run the
ladder against a real file of that type and written down what happened. These
fixtures are that record.

```bash
node scripts/build-extraction-ladder-fixtures.mjs   # writes samples/probe.*
node scripts/probe-extraction-ladder.mjs            # writes a dated runs/*.json per filetype
```

## What's here

- `samples/` — the smallest valid file of each type under test: a one-page
  PDF, a one-paragraph DOCX, a one-cell XLSX, a one-slide PPTX, a 1x1 PNG, a
  1x1 SVG. Built deterministically by `build-extraction-ladder-fixtures.mjs`
  (zero dependencies: a hand-rolled store-only ZIP writer for the OOXML
  formats, a hand-written PDF with a real xref table). Committed rather than
  generated at test time so the bytes under test do not silently drift.
- `runs/` — one dated JSON record per filetype, per probe: which Docling
  state the machine that ran the probe actually had, which rung the ladder
  reached, and — when nothing could read the file — the ladder's own reason
  and remediation, verbatim. A rerun after the same code writes a new dated
  file rather than overwriting the old one, so the history of what changed
  and when is the directory listing itself.

## Reading a run

`outcome: "extracted"` names the tier and provider method that won.
`outcome: "refused"` carries the ladder's `reason` and `remediation` exactly
as a caller would see them — this is what "unreachable" looks like for that
filetype today, not a paraphrase of it.

## The state on record

None of PDF, DOCX, XLSX, or PPTX bundle a parser in this host
(`src/hosts/extract.ts` runs only the `sync` and `docling-local` providers
itself); without Docling installed, all four route to the exhausted rung and
refuse with the ladder's own per-format reason
(`fixtures/extraction-ladder/runs/*-pdf.json` etc.). That is the honest
"unreachable" state of a zero-dependency install, not a defect in these
fixtures — installing Docling changes every one of these records, which is
exactly what re-running the probe is for.

Images (`.png` and friends) have a rung — Docling only, same as the office
formats above — and refuse the same way without it. Diagrams (`.svg` and
other vector formats) have no rung at all, not even an unavailable one:
neither a lightweight parser nor Docling reads vector graphics, so
`kernel/extract/ladder.ts` names that gap directly instead of folding it into
the generic "convert to PDF/DOCX/text/email" message, which is not a path a
diagram has.
