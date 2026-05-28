# Scanned PDFs

Construct detects PDFs that appear to contain only scanned images rather than embedded text. When the extracted text is below a minimum threshold (50 characters per estimated page), the intake packet includes a `droppedInfo` entry with `kind: "scanned-pdf"` and `recoverable: true`.

You can see which files triggered the warning:

```bash
construct intake extraction-warnings --kind=scanned-pdf
```

## Enabling OCR

Set `CONSTRUCT_PDF_OCR_HINT` in your `.env` file:

| Value | Notes |
|---|---|
| `tesseract` | Local Tesseract OCR. Privacy-safe. Install: `brew install tesseract` (macOS) or `apt install tesseract-ocr` (Linux). |
| `pdfocr` | macOS built-in `pdfocr` command (Ventura and later). No install needed on macOS. |
| `none` | Default. No OCR attempted; droppedInfo is emitted as a signal. |

Construct does not bundle an OCR engine. Setting the hint surfaces the appropriate instructions in extraction warnings but does not automatically invoke the backend. Use your preferred tool to pre-process scanned PDFs before ingestion:

```bash
# Tesseract: convert to searchable PDF first
tesseract input.pdf output pdf
construct ingest output.pdf

# pdfocr (macOS)
pdfocr -o output.pdf input.pdf
construct ingest output.pdf
```

## Why Construct does not run OCR automatically

OCR can take significant CPU time (seconds to minutes per page) and may require a network call for cloud backends. Running it silently during intake would make the daemon unpredictable and could introduce latency-sensitive cost spikes. Emitting a `droppedInfo` warning gives you the signal without the side effect.
