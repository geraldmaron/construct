<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0073: RichDocument IR with HTML-canonical serialization for preview and export

- **Date**: 2026-07-07
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: ADR-0024 (document I/O optional capability — its Decision framed markdown as the single ingestion-output/export-input pivot format; that framing is revised here, the external tool choices — docling ingestion, Pandoc+Typst export — are affirmed and unchanged), ADR-0068 (ingestion sidecar process contract — its fixed `{markdown, metadata, droppedInfo}` RPC shape is unchanged; RichDocument is constructed Node-side, downstream of the sidecar), ADR-0036 (docling sidecar evaluation — unaffected), ADR-0018 (document quality standard — its structural floor is expected to extend to RichDocument's section/block tree, not itself changed here), ADR-0017 (source credibility taxonomy — RichDocument citation objects reference this vocabulary), ADR-0066 and ADR-0069 (clean-break-vs-real-migration precedent this ADR's migration stance weighs against)

<!-- Owning specialist: cx-architect. -->

> **Reconciliation note (2026-07-10, construct-pteo2.15 substrate cherry-pick):** this ADR was
> authored on `refactor/consolidate-project-config-dir` as ADR-0071 and renumbered to 0073 on
> staging, where 0071 was already taken (install-footprint naming). The "ADR-0069" it relates to
> is that branch's single project-directory consolidation decision, not staging's ADR-0069
> (CI review gate). Its implementation (`lib/document/rich-document.mjs`, commit `c79336e7`) has
> **not** been cherry-picked to staging — only the decision record travels with this pick.

## Problem

Markdown is Construct's implicit source-of-truth format for every authored artifact, and — via the docling sidecar — the terminal shape external documents are collapsed into before Construct ever operates on them. Markdown, even with pandoc's extensions, has no native representation for a table cell that spans rows or columns, for a figure whose caption and alt text are a paired concept rather than two independent strings, for a video reference, for a citation tied to a specific source record rather than a free-text footnote, or for content that had to be dropped during import while staying visible and trackable rather than silently vanishing. Every one of these needs is currently worked around by a private, per-consumer convention rather than a shared shape:

- `lib/deck-export-pptx.mjs`'s `stripInlineMarkdown()` (lines 79-86) matches `!\[[^\]]*]\([^)]+\)` and replaces it with the empty string when rendering slide body text — an image embedded in a bullet or paragraph is silently deleted from PPTX output, not rendered as a shape, with no `droppedInfo` notice anywhere in the deck-export path.
- `lib/a11y-audit.mjs`'s `altText()` (lines 29-38) checks alt text by regexing raw markdown source for `![alt](url)` syntax. There is no check for figure/caption pairing anywhere in the a11y audit, because captions have no representation to check.
- Citation discipline (`lib/comment-lint.mjs` lines 190-204, `lib/artifact-release-gate.mjs` lines 78-89) verifies a citation exists by pattern-matching prose text for `[source: …]`, an http URL, or a footnote marker — a citation is a string shape a linter recognizes, not a structured field linking to a source record.
- `lib/document-extract.mjs`'s extraction envelope (`buildExtractionResult`, lines 565-589; `finalizeAsyncResult`, lines 678-696) is `{ text, markdown, metadata, droppedInfo, structured }` — `droppedInfo` already exists as a real concept (`lib/extractors/shared/drop-info.mjs`: `{ kind, count, reason, recoverable }`), but it is a single document-level array. There is no way to say *which block* of the document a specific loss belongs to — a dropped merged cell and a dropped inline image both land in the same flat list, disconnected from the content they were near.
- Two independent markdown parsers must agree on the same source text with no shared grammar: pandoc (spawned by `lib/document-export.mjs`) and a hand-rolled second parser inside `lib/deck-export-pptx.mjs` (`slideBlocks()`, `splitSlides()`, `parseTableRow()`, lines 461-644) that reimplements heading/list/table/code-fence/diagram-fence parsing directly against raw lines.

As Construct absorbs more input formats through docling/pandoc-style ingestion (Word documents, PDFs, web pages), each of these workarounds compounds. Information that could be preserved and rendered — a merged header cell, a video reference, a figure's caption — is discarded at the import boundary before it ever reaches an artifact, because there is no shape in the pipeline able to hold it.

## Context

- ADR-0024 committed document I/O to external, swappable tooling: docling for ingestion (document → markdown/JSON), Pandoc + Typst for export (markdown → PDF/DOCX/HTML). That decision correctly kept a Python/ML stack and system binaries out of the zero-npm core (ADR-0001), but its Decision text names markdown as both the ingestion output and the export input — the one pivot format every document passes through. That framing, not the external-tool choice, is what this ADR revises.
- ADR-0068 (five days before this ADR, in the same session series) fixed the docling sidecar's RPC contract: `extractViaDocling(filePath) → { markdown, metadata, droppedInfo }`, and its requirement 5 explicitly reserves routing, fallback, and degradation decisions to the Node side, keeping the sidecar itself free of business logic. This ADR does not reopen that contract. RichDocument is built Node-side, parsed from whatever the sidecar already returns, the same way `lib/document-extract.mjs` already builds its envelope from extractor output today.
- ADR-0036 reaffirmed the offline docling sidecar as the ingestion default over a remote alternative, on privacy grounds. Unaffected by this ADR — RichDocument sits downstream of whichever ingestion strategy is active.
- ADR-0018 established a structural floor: each artifact type declares required sections/visuals in `STRUCTURE_REQUIREMENTS`, checked mechanically against markdown text via postconditions (`artifact-has-section`, `-has-table`, `-has-mermaid`). The floor's *concept* — mechanically checkable completeness — is expected to extend naturally to RichDocument's section/block tree (a tree is easier to walk than a text pattern), but this ADR does not change ADR-0018's rubric or its enforcement today.
- ADR-0017's source credibility taxonomy is the vocabulary a RichDocument citation object is expected to reference (a citation names a source and, through it, a credibility tier); unaffected by this ADR.
- `lib/document-export.mjs`'s `exportMarkdown()` (lines 371-560) spawns pandoc with `-f markdown` (line 470) as the one accepted input grammar for every export target (pdf, html, deck, docx, pptx, rtf, odt, epub, tex), and `prepareExportInput()` (lines 336-352) does markdown-text-level regex preprocessing (`preprocessMarkdownForPdfExport`, `preprocessMarkdownDiagrams` in `lib/publish-template.mjs` and `lib/diagram-export.mjs`) ahead of that spawn rather than operating on a parsed structure.
- `lib/publish-template.mjs`'s `parseArtifactMetadata()` (lines 123-157) recovers title/subtitle/date/owner/status by regexing frontmatter plus an `# H1` / `**Owner:**` / `**Date:**` convention out of raw markdown bytes — metadata is scraped from text shape, not read from a typed field.
- Construct already ships and exercises a production HTML pathway: `templates/distribution/construct-web.html` and `construct-deck.html` are pandoc HTML templates `lib/document-export.mjs` (`htmlTemplatePath`, `deckTemplatePath`) already spawns pandoc against today, for the `html` and `deck` export formats. HTML-as-target is not new infrastructure for this codebase; this ADR promotes it from one export target among several to the canonical serialization and preview surface.
- Video has no first-class representation anywhere in the export pipeline today. The closest existing concept — `lib/demo-recording.mjs` / `lib/playwright-demo.mjs`, wired through `publish:` frontmatter (`lib/publish.mjs` lines 68-76, 165-195) — attaches a screencast as a *separate output artifact* alongside the exported document, not as a media block embedded inline in document flow.
- The artifact type taxonomy this IR must serve is `specialists/artifact-manifest.json`, resolved by `lib/artifact-manifest.mjs` (`artifactTypes()`, `getArtifactEntry()`) — the same manifest `lib/publish-template.mjs`'s `ARTIFACT_TEMPLATE_MAP` and `lib/export-branding.mjs`'s `EXPORT_BRANDING_CAPABILITIES` key off of. RichDocument's metadata fields (title, subtitle, date, owner, artifactType, version, docId, classification) mirror exactly what `parseArtifactMetadata()` already extracts, so adoption does not require inventing a new metadata vocabulary.

## Decision

Define **RichDocument**, a JSON-serializable tree, as the canonical in-memory representation for every Construct-authored or Construct-ingested artifact, and adopt **HTML as RichDocument's canonical serialization** — the surface `construct publish --preview` renders for review and the pivot format existing export tooling (Pandoc, Typst, pptxgenjs) consumes, in place of a raw markdown file.

**RichDocument schema** (first-class fields, not markdown-embedded conventions):

```
RichDocument
  metadata: { title, subtitle, authors[], dates{}, artifactType, docId,
              version, classification, frontmatter{} }
  sections: Section[]

Section
  id, level, title, blocks: Block[], sourceRef?

Block  (discriminated union)
  paragraph   { runs: Run[] }
  heading     { level, runs: Run[] }
  list        { style: bullet|number, items: Block[][] }
  table       { headers: Cell[], rows: Cell[][] }
  figure      { media: MediaRef, caption: Run[], altText, sourceRef? }
  media       { kind: image|video|audio, uri|assetPath, mimeType,
                altText?, transcriptRef? }
  code        { lang, text }
  diagram     { lang, source }
  callout     { kind, blocks: Block[] }
  droppedInfo { kind, count, reason, recoverable }   // attaches at block position

Run   (inline rich text)
  text, marks[]: bold|italic|code|link, citations?: Citation[]

Cell
  runs: Run[], colspan, rowspan

Citation
  sourceRef, locator?, credibilityTier?   // ADR-0017 vocabulary

MediaRef
  kind: image|video|audio, uri|assetPath, mimeType, dimensions?
```

`droppedInfo` reuses the existing `{ kind, count, reason, recoverable }` shape from `lib/extractors/shared/drop-info.mjs` unchanged — it generalizes from a document-level array to a block that can sit at the exact position in the section tree where the loss occurred, so a reader sees "a merged cell here could not be preserved" in place, not in a disconnected summary.

**HTML-first data flow**: RichDocument is the object graph Construct code operates on; HTML is what it serializes to at rendering, preview, and export boundaries. Native HTML elements cover most of the schema directly (`<table>` with `colspan`/`rowspan`, `<figure>`/`<figcaption>`, `<img alt>`, `<video>`); the fields HTML has no native element for (`sourceRef`, `droppedInfo`, `citation`) are carried as `data-cx-*` attributes on the nearest wrapping element, so the serialization round-trips losslessly back to RichDocument rather than only being a one-way rendering target. Ingestion (docling/pandoc-style) is expected to target RichDocument — parsed from the sidecar's existing `{markdown, metadata, droppedInfo}` output today, or from a richer structured output if the sidecar contract is revisited later (a separate decision, not this one) — rather than treating a flat markdown string as the final ingested shape. Export retargets from "read a markdown file off disk, regex-preprocess it, hand it to pandoc" to "serialize RichDocument to HTML, hand HTML to pandoc/typst/pptxgenjs" as the input.

Markdown is demoted to one lossy serialization among several — an import format (parsed into RichDocument) and an export format (serialized from RichDocument for `.md`/`.mdx` output, per `lib/document-export.mjs`'s existing `exportSourceCopy` path) — a peer to PDF, DOCX, and PPTX, not the underlying model. Every markdown file already on disk (`docs/**`, `specialists/**`, user `.construct/` content) keeps working unchanged: it is parsed into RichDocument on demand by a markdown→RichDocument reader, not bulk-converted or reformatted.

**Candidate replacement sites** (named, not required to change atomically with this ADR):

1. `lib/document-extract.mjs` — `buildExtractionResult()` (565-589) and `finalizeAsyncResult()` (678-696): collapse every extractor's output to a flat `{ text, markdown }` pair; the RichDocument-producing path is additive here, not a replacement of the existing envelope in this ADR's scope.
2. `lib/document-extract/docling-client.mjs` — `extractViaDocling()`: its `{ markdown, metadata, droppedInfo }` return shape (ADR-0068) is the input a Node-side markdown→RichDocument parser consumes; unchanged by this ADR.
3. `lib/publish-template.mjs` — `parseArtifactMetadata()` (123-157): regex-scraped metadata is a candidate to become a direct read of `RichDocument.metadata`.
4. `lib/document-export.mjs` — `exportMarkdown()` (371-560), `prepareExportInput()` (336-352): the pandoc-spawn path is a candidate to accept RichDocument's HTML serialization as input instead of a markdown file plus regex preprocessing.
5. `lib/deck-export-pptx.mjs` — `slideBlocks()`, `splitSlides()`, `parseTableRow()` (461-644): the bespoke second markdown parser is a candidate for full replacement by a single shared consumer of `RichDocument.sections[].blocks`, removing the "two parsers must agree" hazard named in the Problem section.
6. `lib/a11y-audit.mjs` — `altText()` (29-38): a candidate to check `Block.figure.altText`/`caption` directly instead of regexing markdown source, and to add the currently-missing figure/caption-pairing check RichDocument makes representable.
7. `lib/artifact-release-gate.mjs` / `lib/comment-lint.mjs` citation checks: candidates to walk `Run.citations[]` objects instead of pattern-matching prose text.

## Rationale

HTML is chosen as the canonical serialization, rather than inventing a bespoke rendering format, because it already natively expresses the concepts markdown lacks — `colspan`/`rowspan`, `<figure>`/`<figcaption>`, `<video>` — and because Construct already depends on a production pandoc-HTML pathway (`construct-web.html`, `construct-deck.html`) that this decision extends rather than replaces. The alternative of leaving RichDocument JSON-only with no canonical rendering surface would throw away that existing tooling and require a bespoke per-format renderer for PDF, DOCX, and PPTX in place of the HTML→(Pandoc/Typst/pptxgenjs) conversions Construct already runs.

RichDocument is defined as a typed schema rather than "just use raw HTML as the source format," because raw HTML has no native slot for `sourceRef`, `droppedInfo`, or `citation` either — modeling those as ad hoc `data-*` attributes on hand-authored HTML would be worse than a typed schema with an HTML serializer, since nothing would enforce the attribute shape or make the fields queryable as objects. RichDocument is the object graph Construct code operates on and validates against; HTML is one serialization of it, chosen as canonical because it is also the one every existing converter in the stack already accepts.

`droppedInfo` is generalized from `lib/extractors/shared/drop-info.mjs`'s existing shape rather than redesigned, because that shape already carries exactly the fields needed (`kind`, `count`, `reason`, `recoverable`) — the change this ADR proposes is where it attaches (block position in a tree, not one flat document-level array), not what it contains.

RichDocument is built downstream of the docling sidecar rather than by reopening ADR-0068's RPC contract, because ADR-0068 requirement 5 already draws that line deliberately: the sidecar's only job is to wrap the extraction call and shape a result into `{markdown, metadata, droppedInfo}`, with routing and fallback decisions kept Node-side. Building RichDocument from that existing output respects the boundary ADR-0068 just established instead of asking a five-day-old decision to be revisited before its consequences are even observed.

## Rejected alternatives

- **Keep markdown canonical; allow raw HTML embedded inline for the cases markdown cannot express (CommonMark already permits this).** Rejected: this is close to the status quo already — nothing stops an author from hand-writing an HTML table today — and it does not remove the "two parsers must agree" problem the Problem section names; pandoc, the bespoke pptx parser, and the a11y auditor would each need their own HTML-in-markdown handling, multiplying string-shaped special cases rather than replacing them with one typed model.
- **Define a JSON-first IR with no canonical HTML serialization; write a bespoke serializer directly to PDF/DOCX/PPTX.** Rejected: throws away the mature HTML→output-format tooling Construct already depends on (`construct-web.html`, `construct-deck.html` prove the pathway works in this codebase) in favor of hand-written renderers per format, trading one shared serializer plus existing converters for several bespoke ones.
- **Have the docling sidecar emit its richer internal document model directly instead of markdown, revising ADR-0068's RPC contract.** Rejected for this ADR's scope: ADR-0068's contract was set five days prior specifically to keep the sidecar free of business logic and its surface narrow; reopening it here, before RichDocument's Node-side construction from the existing markdown output has even been tried, would couple two independent decisions. RichDocument can be built from the sidecar's current output today; revisiting the sidecar's RPC shape remains available later as its own decision if markdown-parsing proves lossy in practice.
- **Adopt Pandoc's own AST (`pandoc -t json`) as Construct's canonical IR instead of defining RichDocument.** Rejected: Pandoc's AST models markdown-shaped documents (blocks and inlines) with no concept of `droppedInfo`, `sourceRef`, or a citation linked to a source record — these are Construct-specific concerns that would have to be bolted on as metadata extensions to a foreign format, and doing so would couple Construct's internal document model to one external tool's format, the same coupling ADR-0024 deliberately avoided by treating Pandoc as an external, swappable binary rather than an embedded dependency.

## Consequences

- A new module (e.g. `lib/rich-document.mjs`) is added to define the schema and an HTML serializer/deserializer; a markdown→RichDocument reader and a RichDocument→markdown writer are both required so every existing `.md` artifact keeps working without a bulk rewrite.
- Adoption is staged per pipeline stage, not atomic: ingestion, then export, then a11y/citation checking can each move to RichDocument independently, since each candidate site named above already sits behind its own function boundary.
- `lib/deck-export-pptx.mjs`'s bespoke markdown parser (`slideBlocks()` and its helpers) is expected to be deleted once the deck exporter consumes `RichDocument.sections[].blocks` directly, removing the two-parsers-must-agree hazard rather than adding a third parser.
- `lib/a11y-audit.mjs` gains a figure/caption-pairing check it structurally cannot perform against markdown text today, and its alt-text check moves from regex to a typed field read.
- `droppedInfo` becomes visible at the position in a document where a loss occurred, not only as a document-level summary — this is the mechanism that lets a "dropped merged cell" or "dropped inline image" stay trackable in place, per this ADR's Problem statement.
- No RichDocument-only artifact store is introduced by this ADR: RichDocument is constructed on demand from markdown/docling output and serialized to HTML at render/export time. Nothing changes about where authored `.md` files live or how they are committed.
- Migration stance (no back-compat shim): when a pipeline stage adopts RichDocument, the markdown-text-only code path it replaces is deleted in the same change — no `--use-rich-document` flag, no dual-path fallback kept indefinitely, no versioned RichDocument schema (`v1`/`v2` discriminated union) built preemptively. This follows ADR-0066's clean-break precedent rather than ADR-0069's real-migration precedent, and the two precedents genuinely differ here: ADR-0069's directory consolidation had to protect live, user-authored content (`.cx/context.md`, custom `org/`) from being destroyed by a rename, which is why it chose a real migration over a clean break. RichDocument is a derived, regenerable representation — parsed from the markdown/docling source at read time, never the thing a user hand-authors or a place data is durably stored — so there is no user content a clean break would destroy; reverting a stage that adopted RichDocument means re-reading the same markdown file that was always still on disk. That is the ADR-0066 case (heavy, regenerable state), not the ADR-0069 case (irreplaceable user data), and the migration stance follows accordingly.

## Reversibility

Two-way door at the pipeline-stage level: RichDocument is additive scaffolding between markdown files that remain on disk and export tooling that already exists; a stage that adopts it can revert to reading markdown directly, since the underlying `.md` source is never deleted or reformatted by this decision. The harder-to-reverse edge is content that accumulates in RichDocument-only fields with no markdown equivalent — a `droppedInfo` block attached to a specific table cell, a `Citation` object linked to a source record — where reverting after real content has landed there requires a RichDocument→markdown flattening that is inherently lossy, the same asymmetry that motivates this ADR. Revisit if HTML-as-canonical-serialization proves to lose fidelity a different pivot would not (Pandoc's own AST, or a richer docling-native output per a future ADR-0068 revision), or if a pipeline stage's adoption reveals the schema is missing a block type real ingested documents need.

## References

- ADR-0024 (document I/O optional capability — markdown-as-pivot framing revised in part; docling/Pandoc/Typst tool choices affirmed unchanged)
- ADR-0068 (ingestion sidecar process contract — `{markdown, metadata, droppedInfo}` RPC shape unchanged; RichDocument built downstream)
- ADR-0036 (docling sidecar evaluation — unaffected)
- ADR-0018 (document quality standard — structural floor expected to extend to RichDocument, not itself changed)
- ADR-0017 (source credibility taxonomy — RichDocument citations reference this vocabulary)
- ADR-0066 (config-layer footprint — clean-break precedent this ADR's migration stance follows), ADR-0069 (single-project-directory consolidation — real-migration precedent this ADR distinguishes itself from)
- `lib/document-extract.mjs`, `lib/document-extract/docling-client.mjs`, `lib/extractors/shared/drop-info.mjs` (extraction envelope and existing droppedInfo shape)
- `lib/publish.mjs`, `lib/publish-template.mjs`, `lib/publish-tooling.mjs`, `lib/document-export.mjs`, `lib/deck-export-pptx.mjs`, `lib/export-branding.mjs`, `lib/a11y-audit.mjs` (current publish/export pipeline read for this ADR)
- `lib/artifact-manifest.mjs`, `specialists/artifact-manifest.json` (artifact type taxonomy RichDocument metadata must serve)
- `templates/distribution/construct-web.html`, `templates/distribution/construct-deck.html` (existing production HTML pathway this ADR extends)
