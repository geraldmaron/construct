# Document I/O intake fixtures

Samples aligned with the supported intake table in `docs/reference/document-io.md`. Each subdirectory is one intake category; files are intentionally small (text stubs or minimal binaries).

| Category | Directory | Sample files |
|----------|-----------|--------------|
| Plain text / code | `plain-text/` | `sample.md`, `sample.txt`, `sample.json`, `sample.yaml`, `sample.csv`, `sample.html`, `sample.xml` |
| Transcripts | `transcripts/` | `sample.vtt`, `sample.srt`, `sample.lrc` |
| Calendar | `calendar/` | `sample.ics` |
| Email | `email/` | `sample.eml`, `sample.msg` |
| PDF | `pdf/` | `sample.pdf` |
| Word | `word/` | `sample.docx`, `sample.doc` |
| Excel | `excel/` | `sample.xlsx`, `sample.xls`, `sample.ods` |
| PowerPoint | `powerpoint/` | `sample.pptx`, `sample.ppt` |
| Rich text | `rich-text/` | `sample.rtf` |
| Apple iWork | `apple-iwork/` | `sample.pages`, `sample.numbers`, `sample.key` |
| Audio/video | `audio-video/` | `sample.mp3`, `sample.wav`, `sample.mp4`, `sample.mov` |
| Unsupported (negative) | `unsupported/` | `sample.xyz` |

Regenerate:

```bash
node scripts/generate-document-io-fixtures.mjs
```

Tests: `tests/fixtures/document-io/document-io-fixtures.test.mjs`.
