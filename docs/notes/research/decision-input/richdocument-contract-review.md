---
intake: none
intake_rationale: Read-and-review decision-input for construct-tsyfe.3.1; evidence is this repo's own committed schemas/code plus a local pandoc/mmdc/d2 probe run against this repo's own serializer output, not external sources.
---

# RichDocument contract review vs. extraction-provider contract and export wiring (construct-tsyfe.3.1)

## Method

Re-read in full, at HEAD `85fea8f9` on `feat/fable5-bead-program` (this worktree was forked at
`0dcb33c3` and fast-forwarded onto the branch tip before starting, 0 divergent local commits): `lib/rich-document.mjs`
(854 lines), `docs/decisions/adr/0073-richdocument-ir-html-canonical-surface.md`,
`lib/rich-document-export.mjs` (299 lines), `schemas/extraction-provider.schema.json`,
`schemas/extraction-result.schema.json`, `lib/contracts/extraction-provider.mjs`,
`lib/document-assets.mjs`, `lib/diagram-export.mjs`, `lib/document-export.mjs`, `lib/publish.mjs`,
`vendor/pandoc-ext/diagram.lua`, and `lib/certification/document-io-matrix.mjs`.

`construct-tsyfe.2.1` (the extraction-provider contract, referred to in this bead's text as
`contract-extraction-provider`) is CLOSED, not provisional — this review is a direct field-by-field
diff against its landed schemas, not a forecast against a bead description. `construct-tsyfe.3.2`
(unified/remark/rehype prototype) is also CLOSED with an adopt decision; its findings (silent
zero-accounting loss of thematic breaks/raw-HTML, a list-fragmentation divergence, a `javascript:`
sanitization gap) are a different class of finding from this bead's (schema/contract adequacy, not
parser correctness) and are not re-litigated here.

One claim below was verified empirically rather than only by reading source, using locally installed
`pandoc 3.10`, `mmdc`, and `d2`: see the "diagram blocks" section.

## Verdicts

### 1. Citations / source refs — **needs-extension**

`Run.citations?: Citation[]` (`Citation { sourceRef, locator?, credibilityTier? }`,
`lib/rich-document.mjs:94-96`) and `Section.sourceRef?` / `Figure.sourceRef?`
(`lib/rich-document.mjs:82-83,118-120`) exist, but `sourceRef` itself has no declared shape anywhere —
ADR-0073's pseudocode (lines 59, 66, 81) leaves it opaque, and the code treats it as arbitrary JSON
(`sectionToHtml` just does `JSON.stringify(section.sourceRef)`, `lib/rich-document.mjs:553`; no
`validateBlock`/`validateRichDocument` check ever inspects it, `lib/rich-document.mjs:144-214`). The
extraction contract's `sourceGrounding` (`schemas/extraction-result.schema.json:186-208`) is a
document-level `{ granularity: none|page|offset, refs: [{ sectionId, page?, offsetStart?, offsetEnd? }] }`
— a *separate lookup table* keyed by `sectionId`, not a field carried inline on the section. The two
are reconcilable (`sourceRef` is opaque enough to hold `{page, offsetStart, offsetEnd}` directly,
dropping the redundant `sectionId` since it's already attached in place) but nothing documents that
target shape today, so `construct-tsyfe.3.4` (ingest wiring) would otherwise invent its own convention
ad hoc. Compounding this: `Section.sourceRef` (intra-document extraction provenance) and
`Citation.sourceRef` (external cited-source identity, ADR-0017 credibility taxonomy) share the same
field name for two different concepts, which risks conflation when 3.4 wires both.

A second, more structural point: extraction-result's `pageRefs` (page→sectionIds map) and `layoutRefs`
(header/footer/column/margin regions, `schemas/extraction-result.schema.json:71-107`) are *siblings* of
`richDocument` in the extraction-result envelope, not nested inside it — the contract's own authors
already scoped these out of RichDocument's tree. But `lib/document-ingest.mjs`'s current (and
`construct-tsyfe.3.4`'s planned) write path persists only the RichDocument-derived markdown plus the
`.assets.json` sidecar (`construct-d1r7.10`) — there is no designated persistence path for
`pageRefs`/`layoutRefs`/`tables`/`figures`/`qualityReport`/`sourceGrounding` once ingest treats
RichDocument as primary. Unless 3.4 adds a sidecar for these (mirroring `.assets.json`), an extraction
provider's page/layout/quality signals are captured at extraction time and then silently dropped at
ingest time, never because RichDocument's schema forced it, but because nothing wires them through.

**Affects: `construct-tsyfe.3.4`** (needs an explicit decision: persist `pageRefs`/`layoutRefs`/
`qualityReport`/`sourceGrounding` in a new sidecar, or document that they are intentionally not
carried past ingest) **and `construct-tsyfe.3.7`** (its AC2, "provenance fields survive ingest to
export unchanged," cannot be certified for fields that have nowhere to live).

### 2. Dropped info — **sufficient (schema shape) / needs-extension (current implementation)**

Shape match is exact: RichDocument's `droppedInfo` block
(`lib/rich-document.mjs:138-140`, `makeDroppedInfoBlock`) and extraction-result's `droppedInfo[]`
(`schemas/extraction-result.schema.json:156-170`) both reuse
`lib/extractors/shared/drop-info.mjs`'s `{ kind, count, reason, recoverable }` verbatim — confirmed by
both files' own header comments. No schema gap.

But the *current* `markdownToRichDocument` implementation does not honor ADR-0073's own design intent
that droppedInfo "attaches at block position... so a reader sees a loss in place, not in a disconnected
summary" (ADR-0073 line 126; `lib/rich-document.mjs:23` repeats the same claim). In practice, every
drop collected during parsing — task-list checkboxes (`lib/rich-document.mjs:383-391`) and inline
images mixed with running text (`pendingImageDrops`, incremented at `lib/rich-document.mjs:503` inside
`parseInlineRuns`, converted to a block at `:257-264`) — is pushed to a shared `droppedNotes` array and
then dumped, *after the whole document is parsed*, onto the **first section only**
(`lib/rich-document.mjs:265-267`: `for (const note of droppedNotes) { allSections[0].blocks.push(note); }`).
A task-list dropped on page 40 of a long document lands as a droppedInfo block in section 1, not next
to where the loss occurred — the exact "disconnected summary" ADR-0073 says this design replaces.

**Affects: `construct-tsyfe.3.3`** (the unified/remark migration this positioning bug is a natural fix
for, since a real AST tracks node position) **and `construct-tsyfe.3.7`** (its AC3 requires droppedInfo
"truthful" — count/reason/recoverable are truthful today, but position is not, which may or may not be
in scope for what 3.7 means by "truthful"; worth an explicit call at that bead's start).

### 3. Media refs — **needs-extension**

`MediaRef { kind: image|video|audio, uri|assetPath, mimeType, dimensions? }`
(`lib/rich-document.mjs:98-100`) and the `media`/`figure` blocks that embed it have no `id`/identity
field — each occurrence inlines its own copy of `uri`/`assetPath`/`mimeType`. Extraction-result's
`assets[]` (`schemas/extraction-result.schema.json:139-155`) is explicitly designed the opposite way:
"Extracted binary assets... with a durable id so blocks/figures can reference them" — a normalized,
id-addressable registry. Confirmed downstream at `lib/document-assets.mjs:96-97`
(`assetFromBlock`): the `.assets.json` manifest's `id` field is assigned **positionally**
(`id: \`asset-${index + 1}\``) by walk order over `doc.sections`, not derived from or synced with any
identity carried on the `MediaRef` itself, and there is no dedup — two blocks pointing at the same
`src` get two different sequential ids. When `construct-tsyfe.3.4` converts an extraction-result's
`assets[]` (durable ids) into a RichDocument, those ids have nowhere to land and are discarded; a later
`buildAssetManifest` pass re-derives new, unrelated positional ids. Any code that wants to trace "this
exported figure came from extraction-result asset `img-3`" has no id-based thread to follow, only
path/content inference.

Second, narrower gap: `MEDIA_KINDS = ['image', 'video', 'audio']` (`lib/rich-document.mjs:51`, enforced
by `validateBlock` at `:208-210`) has no `other` option, but extraction-result's `assets[].kind` enum is
`image|video|audio|other` (`schemas/extraction-result.schema.json:148`). An extraction provider that
surfaces a generic/unknown-typed embedded asset (e.g., an embedded spreadsheet or unrecognized binary)
has no valid RichDocument media block to become — it must be silently coerced to `image` or dropped.

**Affects: `construct-tsyfe.3.4`** (asset-id continuity from extraction through ingest;
`MEDIA_KINDS` needs an `other` entry or those assets get miscategorized/dropped at the exact seam 3.4
owns).

### 4. Diagram blocks — **gap** (export-wiring, not schema shape)

`DiagramBlock { lang, source }` (`lib/rich-document.mjs:130-132`) is schema-adequate — `lang` carries
`mermaid`/`d2` and `source` carries the fence body, which is all the field-level information a diagram
needs. The gap is in the same file's HTML serializer, and it is severe enough to be a functional
regression, not a cosmetic one.

`blockToHtml`'s diagram case (`lib/rich-document.mjs:595-596`) emits
`<pre data-cx-diagram-lang="mermaid"><code>...</code></pre>` — the diagram language is carried only as
a `data-*` attribute on the outer `<pre>`, never as a `class` on `<code>` (contrast the adjacent `code`
case at `:594`, which does emit `class="language-${lang}"`). Construct's actual diagram-rendering
pipeline is a Pandoc Lua filter, `vendor/pandoc-ext/diagram.lua`, wired in at
`lib/document-export.mjs:510-511` (`--lua-filter`, gated on `figures &&`) and dispatched by
`local diagram_type = block.classes[1]` (`vendor/pandoc-ext/diagram.lua:593`) — it keys off Pandoc's
`CodeBlock` **class list**, not attributes.

Verified empirically (not just by reading the Lua source), using the repo's own file and locally
installed `pandoc 3.10`: dumping Pandoc's native AST for RichDocument-style diagram HTML vs. the
markdown-fence equivalent —

```
$ pandoc -f html -t native <<'EOF'
<pre data-cx-diagram-lang="mermaid"><code>flowchart TD
A--&gt;B</code></pre>
EOF
CodeBlock ( "" , [] , [ ( "cx-diagram-lang" , "mermaid" ) ] ) "flowchart TD\nA-->B"

$ pandoc -f markdown -t native <<'EOF'
```mermaid
flowchart TD
A-->B
```
EOF
CodeBlock ( "" , [ "mermaid" ] , [] ) "flowchart TD\nA-->B"
```

The RichDocument-HTML path produces an **empty classes list** (`[]`) with `mermaid` stranded in an
attribute Pandoc's filter never reads; the markdown-fence path produces `classes = ["mermaid"]`, which
`diagram.lua`'s `block.classes[1]` dispatch requires. Concretely: the moment
`construct-tsyfe.3.5` wires `exportRichDocument` into production, every diagram in every document
would stop rendering as an image and start rendering as literal preformatted diagram-source text in
the PDF/DOCX/PPTX/etc. output — silently, since `lib/certification/document-io-matrix.mjs`'s existing
fixture already includes a mermaid diagram (`:78`) but its validators (`validatePdf`/`validateArchive`/
`validateHtml`, `lib/certification/document-io-matrix.mjs:82-87`) only check structural file validity,
never whether a diagram actually rendered as an image — so this gap is real today and uncaught by
existing tests.

A second, independent finding in the same area: even if the class-attribute issue were fixed,
`richDocumentToHtml`'s diagram case never applies Construct's brand/theme injection
(`injectMermaidBrandTheme`, `injectD2DistributionDefaults`, `resolveIconTokens` —
`lib/diagram-export.mjs:166-204`, driven through `preprocessMarkdownDiagrams`). That function only runs
inside `prepareExportInput` (`lib/document-export.mjs:336-352`), which `exportMarkdown` calls only when
`inputFormat === 'markdown'` (`lib/document-export.mjs:461-463`); `exportRichDocument`'s
HTML_ENGINE_FORMATS path always calls `exportMarkdown({ inputFormat: 'html', ... })`
(`lib/rich-document-export.mjs:281-291`) and never passes `figures` (defaults to `false`,
`lib/document-export.mjs:375`) — so branding injection is doubly skipped on this path, independent of
the class-attribute bug. `figures` defaults `true` in the current production caller
(`lib/publish.mjs:57`), confirming this branding step is exercised on effectively every export today.

**Affects: `construct-tsyfe.3.5` directly and severely** — its own migration/compatibility requirement
("the switch to `exportRichDocument` must be behavior-preserving for output format/content when a
RichDocument is available") is not met today for any document containing a diagram. Note 3.5's own
Scope section only names `lib/publish.mjs`, `lib/mcp/server.mjs`, and conditionally
`lib/rich-document-export.mjs` — the actual fix lives in `lib/rich-document.mjs` (`blockToHtml`'s
diagram case, and its inverse in `htmlToRichDocument`'s `blockFromNode` for `pre`,
`lib/rich-document.mjs:700-707`, to keep the round trip lossless), a file 3.5's stated scope does not
mention. Given severity (silent regression across every export format, every diagram), recommend this
become its own small, prioritized bug-fix item gating 3.5 rather than an implicit expectation that 3.5
discovers and fixes it inline.

### 5. Provider provenance — **gap**

RichDocument's `metadata` (`lib/rich-document.mjs:72-80`: `title, subtitle, authors, dates,
artifactType, docId, version, classification, frontmatter`) is entirely an *authorship/artifact*
vocabulary — it has no field for which extraction provider or method produced the document. The
extraction contract's provider identity (`schemas/extraction-provider.schema.json`: `name`, `version`,
`configFingerprint`, `losslessWhereAvailable`, `supportsRichDocument`) and per-call fidelity signals
(`extraction-result`'s `provider`, `extractionMethod`, `losslessWhereAvailable`, `losslessReason`,
`qualityReport`) have no home anywhere in RichDocument — not in `metadata`, not in `Section`, nowhere.
`frontmatter{}` is the only free-form field, but it is documented and used as a passthrough of
user-authored YAML frontmatter (`mergeMetadata`, `lib/rich-document.mjs:298-314`) that gets re-emitted
into `.md` export output (`richDocumentToMarkdown`, `lib/rich-document-export.mjs:93-106`) — stashing
machine-generated extraction provenance there would leak internal bookkeeping into user-facing
frontmatter on every markdown re-export.

This is a genuine schema gap, not a wiring detail: when `construct-tsyfe.3.4` builds a RichDocument
from an extraction-result, provider identity and fidelity signals (which provider ran, whether it was
lossless, why not if not) have nowhere to be captured, so they cannot survive into the object that
`construct-tsyfe.3.5` exports or that `construct-tsyfe.3.7` certifies.

**Affects: `construct-tsyfe.3.4`, `construct-tsyfe.3.5`, and `construct-tsyfe.3.7` jointly** — this is
the one finding of the five that most plausibly needs a small ADR-0073 amendment (a new
`metadata.provenance` field, or a sibling field to `metadata`) rather than being absorbed silently
into 3.4's implementation. Recommend 3.4 make an explicit, documented scoping call here (add the field,
or explicitly declare provider provenance out of scope for the RichDocument object and tracked only in
the extraction-result envelope / a new sidecar) rather than defaulting into silence.

## Summary table

| Category | Verdict | Primary affected bead(s) |
|---|---|---|
| Citations / source refs (+ page/layout refs) | needs-extension | 3.4, 3.7 |
| Dropped info | sufficient (shape) / needs-extension (implementation) | 3.3, 3.7 |
| Media refs | needs-extension | 3.4 |
| Diagram blocks | gap (export wiring) | 3.5 (recommend a dedicated bug-fix item) |
| Provider provenance | gap (schema) | 3.4, 3.5, 3.7 |

No finding here requires a schema change to be made *in this bead* — per its own non-goals, none was
made. `lib/rich-document.mjs`, `lib/rich-document-export.mjs`, and the extraction schemas are untouched
by this review.
