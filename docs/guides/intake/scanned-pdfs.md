# Scanned PDFs

Construct ingests PDFs through [docling](https://github.com/docling-project/docling), which performs layout-aware extraction and ships its own built-in OCR for image-bearing pages. Most scanned PDFs work without additional setup — docling's OCR runs as part of the Python sidecar.

When extracted text is unusually sparse (below 50 characters per estimated page after OCR), the ingest record emits a `droppedInfo` entry with `kind: "low-text-yield"` and `recoverable: true`. This signals that the document is either heavily image-based with low OCR confidence, an empty/cover page, or genuinely contains little text.

## Inspecting low-yield warnings

```bash
construct intake extraction-warnings --kind=low-text-yield
```

The CLI surfaces `droppedInfo` from every ingested document by default. Pass `--strict` to `construct ingest` to fail non-zero on any drops:

```bash
construct ingest large-scan-collection/ --strict
```

## Improving recall on hard scans

Docling's OCR is sufficient for the common case. For scans with poor source quality (low contrast, handwritten margins, complex layouts), pre-processing with a dedicated OCR engine before ingestion usually beats expanding docling's defaults:

```bash
# Tesseract: produce a searchable PDF, then ingest
tesseract input.pdf output pdf
construct ingest output.pdf

# macOS pdfocr (Ventura+)
pdfocr -o output.pdf input.pdf
construct ingest output.pdf

# PaddleOCR (better on printed Asian scripts, see paddlepaddle.github.io/PaddleOCR)
```

## Behavior trade-off

Docling's OCR runs synchronously during extraction. Multi-page scanned PDFs can take 30–90 s on first pass. The cache at `.construct/ingest/<sha256>/` makes re-ingest a no-op, so the cost is paid once per content hash.

If latency matters more than recall, use `construct ingest --legacy-extractor` to fall back to the pre-docling `pdftotext`/`textutil`/`mdls` path. The legacy path is faster but produces lower-fidelity text and does no OCR — scanned pages will return empty.
