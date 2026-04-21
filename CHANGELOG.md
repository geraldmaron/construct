<!--
CHANGELOG.md — repository-level baseline summary for the current initial history.

Describes the major capabilities present at the start of this clean commit
history. Keep entries concise, capability-oriented, and suitable for someone
reading the project for the first time.
-->
# Changelog

## Session persistence, prompt composition, and compliance skills

### Session persistence

- Distilled session store (`lib/session-store.mjs`) that survives `construct down` and enables resumption with minimal token cost.
- Sessions capture summary, decisions, files changed, open questions, and task snapshots — all with enforced caps.
- Session lifecycle wired into `session-start.mjs` (create/resume) and `stop-notify.mjs` (close with summary).
- Four MCP tools: `session_list`, `session_load`, `session_search`, `session_save`.

### Prompt composition

- Runtime flavor overlay injection via `AGENT_FLAVOR_MAP` in `lib/prompt-composer.mjs`, connecting 27 previously orphaned domain overlays.
- `lib/model-free-selector.mjs` extracted from `lib/model-router.mjs` to keep both modules under 500 lines. Re-export pattern preserves backward compatibility.

### Compliance skills

- Four new skills for `cx-legal-compliance`: `license-audit`, `data-privacy`, `ai-disclosure`, `regulatory-review`.
- Registry updated with skill references.

### Rules cleanup

- Common rules made platform-agnostic by removing tool-specific references.
- Removed duplicate rule sets and fixed broken cross-references in language-specific hooks files.

### Documentation

- Architecture docs updated with session persistence section and MCP tool inventory.
- Docs README updated with skills index and session storage reference.

### Verification

- 227/227 tests pass (19 new session-store tests, 2 new prompt-composer tests).

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
