<!--
CHANGELOG.md — repository-level baseline summary for the current initial history.

Describes the major capabilities present at the start of this clean commit
history. Keep entries concise, capability-oriented, and suitable for someone
reading the project for the first time.
-->
# Changelog

## Initial Commit

### Document ingest and extraction

- Shared extraction support for PDF, DOC/DOCX, XLS/XLSX, CSV/TSV, PPT/PPTX, ODT/ODS, RTF, Pages, Numbers, Keynote, and plain-text project artifacts.
- `construct ingest` for converting source documents into normalized markdown artifacts.
- MCP tools for `extract_document_text` and `ingest_document`.

### Storage and retrieval

- File-state indexing that includes broader document content from ingested and extracted artifacts.
- Local vector index persistence wired into storage sync.
- SQL-backed storage sync and hybrid retrieval aligned with the local vector path.
- Explicit storage lifecycle surfaces for status, sync, reset, and ingested-artifact deletion across CLI and MCP, with confirmation gates for destructive actions.

### Research and evidence policy

- A repo-level research policy covering source order, verification, confidence, contradiction handling, and reproducibility.
- Research, evidence-ingest, product-intelligence, and product-signal workflows aligned to the same standard.
- Reusable research and evidence templates with stricter structure expectations.
- `construct lint:research` plus research artifact checks surfaced in `construct doctor`.

### Verification

- Baseline verified with docs check, research lint, targeted storage/MCP/ingest tests, and live storage status checks.
