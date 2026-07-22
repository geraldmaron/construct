---
name: docs-document-ingest-workflow
description: "Use when: the user points at a PDF, Word doc, spreadsheet, slide deck, export, or mixed document folder and wants a markdown version that Construct can search efficiently later."
inputs: [document]
artifactType: ingested-markdown
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
---
# Document Ingest Workflow

Use when: the user points at a PDF, Word doc, spreadsheet, slide deck, export, or mixed document folder and wants a markdown version that Construct can search efficiently later.

## Preferred tools

1. `construct ingest <path>` for CLI-driven conversion.
2. `ingest_document` over Construct MCP when the host supports MCP tools.
3. `extract_document_text` only when the user wants raw extracted text without writing a markdown artifact.

## Default destination

Write outputs to `.construct/knowledge/internal/` unless the user explicitly wants a typed `knowledge/<subdir>`, sibling markdown file, or another output path.

Why:

- files under `.construct/knowledge/` are part of Construct's file-state retrieval path
- they can be picked up by hybrid search immediately
- `construct ingest --sync` can then push them into shared SQL/vector storage when configured

## Supported source types

- PDF
- DOC and DOCX
- XLS, XLSX, CSV, TSV, ODS, Numbers
- PPT, PPTX, Keynote
- ODT, RTF
- text, markdown, HTML, XML, JSON, YAML, and other plain-text project artifacts

## Workflow

1. Ingest the source into markdown.
2. Preserve source metadata: original path, extension, extraction method, timestamp, truncation state.
3. Keep the markdown normalized and readable; do not invent structure beyond headings and metadata.
4. If the document informs product decisions, promote the result into an evidence brief or PRD input using the evidence-ingest workflow.
5. If shared storage is configured and the material should be semantically retrievable across sessions, run with `--sync`.

## Examples

```bash
construct ingest ./docs/vendor/quarterly-review.pdf
construct ingest ./research-drop --sync
construct ingest ./deck.pptx --target=sibling
construct ingest ./data/export.xlsx --out=./notes/export.md
```

## Rules

Do not overwrite an existing markdown artifact unless the user explicitly asks for replacement. Prefer creating a suffixed filename instead. Keep original source files untouched.
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
