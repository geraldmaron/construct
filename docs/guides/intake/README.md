# Document Intake

How Construct turns dropped files into retrieval-ready knowledge, and the format-specific extraction paths that back it.

Drop a file into the project-root `inbox/` and the embed daemon ingests it: text is extracted, indexed into `knowledge_search`, and a triage packet is queued for review. Most formats — Markdown, plain text, PDFs, Office documents, code — work without extra setup. The pages below cover the two that need a backend.

- [Audio and video](./audio-video.md) — local, offline transcription via whisper.cpp.
- [Scanned PDFs](./scanned-pdfs.md) — layout-aware OCR through docling, plus recall tuning for hard scans.

## Drop convention (atomic handoff)

`inbox/` at the project root is the single canonical drop zone (ADR-0045 §C). To avoid the watcher ever picking up a half-written file, writers stage the file under `inbox/.staging/` (gitignored) and then atomically `rename` it into `inbox/`. A `rename` within the same filesystem is atomic, so the file appears at its final name only when it is complete.

The watcher enqueues only complete top-level files in `inbox/`: dotfiles and the `inbox/.staging/` assembly directory are ignored, and as a backstop for writers that drop in place, a file whose size is still changing between two stats is left for the next poll. Dropping a small file directly into `inbox/` is fine; stage-then-rename matters for large or slowly-written files.

Processed items move to `.cx/intake/processed/`; machine/runtime intake state (pending, processed, skipped, quarantine, dead-letter) lives under the gitignored `.cx/intake/`.

Watch depth and extra directories are configured under `intakePolicy` in the [config reference](../reference/config.md).
