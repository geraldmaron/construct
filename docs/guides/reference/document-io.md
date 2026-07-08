---
title: Document I/O
description: Intake and export formats, engines, fidelity tiers, and optional tooling for Construct document pipelines.
---

Construct treats document I/O as an **optional capability** with two independent halves ([ADR-0024](/decisions/adr/0024-document-io-optional-capability)). Both degrade gracefully when tooling is absent.

## Pipeline overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ IN (many formats)          AUTHORING (canonical)         OUT (many)     │
│ PDF, DOCX, PPTX, XLSX,  →  typed markdown artifacts  →  PDF, DOCX,    │
│ email, AV, plain text,       under templates/docs/        DOC, HTML,    │
│ transcripts, calendar…       + .construct/knowledge/ ingest       deck, PPTX,  │
│                                                            RTF, EPUB…   │
└─────────────────────────────────────────────────────────────────────────┘
```

| Stage | Command | Input formats | Output |
|-------|---------|---------------|--------|
| **Ingest** | `construct ingest` | PDF, Office, email, AV, text, transcripts, calendar, … | Normalized **markdown** + optional assets |
| **Author** | specialists / workflows | — | Typed **markdown** artifacts (PRD, ADR, RFC, …) |
| **Export** | `construct export` / `construct publish` | **Markdown** artifact (`.md` / `.mdx`) | PDF, DOCX, DOC, HTML, deck, PPTX, RTF, ODT, EPUB, TeX, TXT, MD copy |

Export does not accept PDF or DOCX as input — those are **ingest** sources. Once ingested or authored as markdown, artifacts export to any supported distributable format.

## Ingestion (`construct ingest`)

### Strategies

| Strategy | Config | Engine | When to use |
|----------|--------|--------|-------------|
| `adapter` (default) | `ingest.strategy` | Docling sidecar (high) or unpdf/mammoth (fast) | Local-first; default for most projects |
| `provider` | `ingest.strategy=provider` | Vision-capable LLM | When provider routing is configured |
| `docling-remote` | `ingest.strategy=docling-remote` + `DOCLING_SERVE_URL` | Docling Serve HTTP | Zero local ML footprint; sends files off-box |

### Fidelity tiers (adapter)

| Tier | Flag | PDF/DOCX engine | Office (xlsx/pptx/odt) |
|------|------|-----------------|------------------------|
| **high** (default) | `--fidelity=high` | Docling Python sidecar via `uv` | Docling |
| **fast** | `--fidelity=fast` | `unpdf` / `mammoth` (optional npm deps) | Fail loud (`OFFICE_REQUIRES_DOCLING`) |

`--legacy-extractor` is a deprecated alias for `--fidelity=fast`.

Docling provisions on first use into a machine-shared `~/.construct/runtime/docling/.venv` (~1.5 GB) — one venv per machine, shared by every project, not one per project. Eager provision: `construct install --with-docling`.

On docling timeout or failure, Construct falls back to **node-native** extraction (unpdf/mammoth) for PDF/DOCX. Office formats without a Node backend require docling.

### Supported intake formats

| Category | Extensions | Primary engine | Notes |
|----------|------------|----------------|-------|
| Plain text / code | `.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.html`, `.xml`, source files | UTF-8 read | — |
| Transcripts | `.vtt`, `.srt`, `.lrc` | Pure JS parser | Structured cues |
| Calendar | `.ics` | Pure JS RFC5545 | — |
| Email | `.eml`, `.msg` | EML parser | Attachments listed, not extracted |
| PDF | `.pdf` | docling / unpdf | Images externalized with docling |
| Word | `.docx`, `.doc` | docling / mammoth | Legacy `.doc` via docling only |
| Excel | `.xlsx`, `.xls`, `.ods` | docling | Fast tier requires docling |
| Presentation | `.pptx`, `.ppt`, `.odp` | docling | Fast tier requires docling |
| Rich text | `.rtf` | docling | — |
| Images | `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`, `.webp` | docling vision | Fast tier requires docling (`IMAGE_REQUIRES_DOCLING`) |
| Apple iWork | `.pages`, `.numbers`, `.key` | docling | — |
| Audio/video | `.mp3`, `.wav`, `.mp4`, `.mov`, … | whisper.cpp | Requires `whisper-cli`; `ASR_REQUIRED` without backend |

### droppedInfo

Every extraction path returns `droppedInfo: { kind, count, reason, recoverable }[]` so silent loss is observable. Pass `--strict` to fail when any recoverable drop occurs.

### MCP

| Tool | Pipeline |
|------|----------|
| `ingest_document` | Full ingest (docling / node-native / strategies) |
| `extract_document_text` | Async: node-native first; docling for office/PDF when needed |

## Export (`construct export` / `construct publish`)

Per [ADR-0024](/decisions/adr/0024-document-io-optional-capability). **Input:** a markdown artifact. **Output:** one of the formats below. Engines are discovered at runtime — never bundled in core npm install.

### Output formats

| Format | Engine | Branded | Required tooling |
|--------|--------|---------|------------------|
| `pdf` | Pandoc → Typst | Yes — `construct-brand.typ` + type layouts | `pandoc`, `typst` |
| `html` | Pandoc + `construct-web.html` | Yes | `pandoc` |
| `deck` | Pandoc + `construct-deck.html` | Yes | `pandoc` |
| `pptx` | pptxgenjs | Yes — brand tokens | `pptxgenjs` (optional npm dep) |
| `docx` | Pandoc + reference doc | Partial — `construct-reference.docx` when present | `pandoc` |
| `doc` | Pandoc → DOCX → LibreOffice | Same as DOCX intermediate | `pandoc`, **LibreOffice** (`soffice`) |
| `odp` | pptxgenjs → LibreOffice | Same as PPTX intermediate | `pptxgenjs`, **LibreOffice** (`soffice`) |
| `rtf`, `odt`, `epub`, `tex`, `txt` | Pandoc defaults | No | `pandoc` |
| `htmlfrag` | RichDocument HTML fragment | N/A — copy/paste target | — |
| `md`, `mdx` | Copy source | N/A | — |

Legacy `.doc` export: Pandoc writes branded DOCX, then LibreOffice headless down-converts. Override binary with `CONSTRUCT_LIBREOFFICE_BIN`. Cross-platform (macOS, Linux, Windows) when LibreOffice is installed.

### RichDocument export adapters (ADR-0071)

Per [ADR-0071](/decisions/adr/0071-richdocument-ir-html-canonical-surface), `lib/rich-document-export.mjs`'s `exportRichDocument({ doc, format, outputPath })` exports the RichDocument IR to every format above. Its canonical serialization is HTML: for typeset and office targets the IR is serialized to HTML and handed to the same engines via `exportMarkdown`'s `inputFormat: 'html'` path, rather than round-tripping through markdown. Two targets have no engine and are written directly — `md`/`mdx` from the RichDocument→markdown writer, and `htmlfrag`, the copy/paste fragment whose purpose is that merged table cells, figure/caption pairs, and callouts survive a clipboard paste that a markdown fragment would flatten. `odp` (OpenDocument Presentation) builds a pptxgenjs deck first, then LibreOffice down-converts. A missing engine returns the same actionable diagnostic `detect()` reports and is never counted as a certified pass; `lib/export-validate.mjs` validates each produced file — PDF page count, Office/OpenDocument/EPUB zip structure and slide counts, HTML DOM shape, and local reference integrity.

### Rich-media asset manifest (ADR-0071)

`lib/document-assets.mjs` derives an asset manifest from the RichDocument IR — it is not a parallel structure. `buildAssetManifest(doc, { baseDir })` walks every figure/media/diagram block (including those nested in lists and callouts) and records each asset's role (photo / screenshot / diagram), local-vs-remote ref, resolved absolute path, sha256 content hash, byte size, MIME type, dimensions, caption, alt text, source ref, and embed/link policy. It is **generated on import** — `construct ingest` writes a `<name>.assets.json` sidecar beside the markdown — and **consumed on export**: `exportRichDocument` validates the manifest before any engine runs (a broken local media ref fails closed and blocks the export, writing no output) and rewrites local refs to absolute paths so a Pandoc/LibreOffice pass in a temp working directory still finds and embeds them. Local raster assets inline as data URIs in self-contained HTML; captions and alt text survive to whatever the target format preserves.

### Certified I/O matrix

```bash
construct certify document-io            # local mode: missing engines skip gracefully
construct certify document-io --certified   # release mode: a skipped format is a hard failure
npm run certify:document-io                 # the certified profile
```

`lib/certification/document-io-matrix.mjs` exports a realistic RichDocument fixture (table, figure with caption/alt over a real raster asset, code, callout, diagram) to every output format and validates each. **Local** mode honours the graceful-degradation contract — a format whose engine is absent is skipped, not failed. **Certified** mode is the release contract — every declared format must have its engine (Pandoc, Typst, LibreOffice headless, pptxgenjs) present and must produce a file its validator accepts; a format skipped for a missing tool fails the run. Each row names the exact format, engine set, and validation detail. Intake-format coverage is asserted separately by the fixture catalog (`lib/certification/document-io-fixtures.mjs`).

### Branded deck preview (local only)

Regenerate into `.tmp/distribution-examples/` for local review:

```bash
npm run examples:distribution
open .tmp/distribution-examples/index.html
```

Single deck (legacy):

```bash
npm run examples:deck
```

| Output | Path after generate |
|--------|---------------------|
| Gallery index | `.tmp/distribution-examples/index.html` |
| PRD / ADR / research / runbook / strategy PDFs | `.tmp/distribution-examples/<id>.pdf` |
| Platform PRD demo (cockpit + PDF scroll) | `.tmp/distribution-examples/agentic-platforms-prd.mp4` (Playwright recording `agentic-platforms-prd`) |
| HTML slide deck | `.tmp/distribution-examples/deck-deck.html` |
| PowerPoint | `.tmp/distribution-examples/deck.pptx` |
| Sources | [`examples/distribution/sources/`](../../examples/distribution/sources/) |

### Publish templates by artifact type

Typed artifacts map to PDF layouts (export only affects PDF/deck/HTML branding depth):

| Layout | Artifact types |
|--------|----------------|
| `construct-prd.typ` | prd, prd-platform, prd-business, meta-prd, strategy, runbook, memo, one-pager, … |
| `construct-research.typ` | research-brief, evidence-brief, signal-brief, research-finding |
| `construct-decision.typ` | adr, rfc, rfc-platform |
| `construct-pdf.typ` | Fallback for all other manifest types |

Project override: `.construct/publish-theme.typ`.

### Diagrams at export

Fenced `d2` and `mermaid` blocks render via vendored `pandoc-ext/diagram.lua` when `--figures` is set. Requires `d2` or `graphviz dot`, and `mmdc` for Mermaid.

## Tooling detection

```bash
construct tools detect [--json] [--figures]
```

Reports export (Pandoc, Typst, LibreOffice for `.doc`, pptxgenjs, deck template), ingest (docling venv, whisper, node-native deps), and figure binaries. See [diagram-and-demo cookbook](/guides/cookbook/diagram-and-demo).

## Related ADRs

- [ADR-0024](/decisions/adr/0024-document-io-optional-capability) — optional external tooling
- [ADR-0036](/decisions/adr/0036-document-ingestion-docling-mcp-evaluation.md) — docling sidecar default; remote opt-in
- [ADR-0001](/decisions/adr/0001-zero-npm-core.md) — no heavy deps in core install

## Brand consistency

Distribution exports, dashboard, supported hosts, and wireframe scaffolds share the Construct brand contract documented in [branding.md](./branding.md). Visual tokens live in [`lib/brand-tokens.mjs`](../../lib/brand-tokens.mjs) (monochrome ink ramp, Space Grotesk / JetBrains Mono). PPTX exports embed bundled TTF cuts via [`lib/brand-fonts.mjs`](../../lib/brand-fonts.mjs) when `pptx-embed-fonts` is installed.
