# Document extraction corpus

Representative PDF and DOCX fixtures for construct-tsyfe.2.9 routing benchmarks.

Regenerate binaries and manifest with:

```bash
node scripts/generate-document-extraction-corpus.mjs
```

Fixtures:

- `01-digital-simple.pdf` and `02-digital-multipage.pdf`: digital-text PDFs for unpdf routing
- `03-digital-sparse.pdf` and `04-scanned-empty.pdf`: low-yield PDFs that escalate to Docling
- `05-docx-simple.docx`: plain DOCX for mammoth routing
- `06-docx-table.docx` and `07-docx-image.docx`: layout-critical DOCX fixtures

Benchmark entry point: `lib/document-extract/corpus-benchmark.mjs`.
Tests: `tests/document-extraction-corpus-benchmark.test.mjs`.
