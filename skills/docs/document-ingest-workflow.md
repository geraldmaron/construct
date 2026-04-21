<!--
skills/docs/document-ingest-workflow.md — Convert source documents into retrieval-ready markdown artifacts.
-->
# Document Ingest Workflow

Use when: the user points at a PDF, Word doc, spreadsheet, slide deck, export, or mixed document folder and wants a markdown version that Construct can search efficiently later.

## Preferred tools

1. `construct ingest <path>` for CLI-driven conversion.
2. `ingest_document` over Construct MCP when the host supports MCP tools.
3. `extract_document_text` only when the user wants raw extracted text without writing a markdown artifact.

## Default destination

Write outputs to `.cx/product-intel/sources/ingested/` unless the user explicitly wants a sibling markdown file or another output path.

Why:

- files under `.cx/product-intel/` are already part of Construct's file-state retrieval path
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

