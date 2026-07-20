# HTML export sanitization contract

Direct RichDocument HTML export (`lib/export/html-provider.mjs`) renders in-process and applies a hand-rolled sanitization pass before bytes are written. Pandoc's HTML writer is a separate path and is not covered here.

Implementation: `lib/export/html-sanitize.mjs` (`sanitizeExportedHtml`).

## Denylist (stripped from output)

| Construct | Rule |
|-----------|------|
| `<script>` elements | Tag and contents removed |
| `on*` event attributes | Removed from any tag (`onclick`, `onerror`, ...) |
| Dangerous URL schemes | `javascript:` and `data:` removed from `href` and `src` (case-insensitive) |

## Allowlist posture

All other markup produced by `richDocumentToHtml` or benign inline HTML fragments in `html` blocks (for example `<strong>`, `<em>`, `https:` links) passes through unchanged.

## Provider evidence

`exportSanitizedHtml({ doc, outputPath, variant })` returns the export-provider envelope: `provider.name` (`construct-html-sanitizer`), `provider.version` (from `@geraldmaron/construct` package version), `contentHash`, and `fidelity`.

## Verification

Security fixture: `tests/export/html-provider.test.mjs`.
