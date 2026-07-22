# Distribution examples

Branded PDF, HTML, deck, and PPTX samples generated from typed markdown sources. Use these to preview Construct's publish layouts (Plus Jakarta Sans, field-notebook ink, hand-drawn figures).

## Generate locally

Prerequisites: `construct tools detect --figures` must report ready (pandoc, typst, d2, mmdc; pptxgenjs optional for PPTX). The platform PRD demo requires Playwright in `apps/dashboard` (`npm install`, `npx playwright install chromium`, and `ffmpeg` on PATH for MP4). If browsers are installed outside the sandbox cache, set `PLAYWRIGHT_BROWSERS_PATH` to your Playwright cache (e.g. `~/Library/Caches/ms-playwright` on macOS).

```bash
npm run examples:distribution
open .tmp/distribution-examples/index.html
```

This exports PDF/HTML/deck artifacts with constrained figure sizing (58% max width, 2.35in max height) and records `agentic-platforms-prd.mp4` via the shipped Playwright recording manifest (`templates/demos/recordings/agentic-platforms-prd.json`) — cockpit walkthrough, then scroll through `prd-platform.pdf`.

Deck-only (legacy):

```bash
npm run examples:deck
```

## Source layout

| File | artifactType | Typst / HTML layout |
|------|--------------|---------------------|
| `sources/prd-platform.md` | prd-platform | construct-prd.typ |
| `sources/adr.md` | adr | construct-decision.typ |
| `sources/research-brief.md` | research-brief | construct-research.typ |
| `sources/runbook.md` | runbook | construct-prd.typ |
| `sources/rfc-platform.md` | rfc-platform | construct-decision.typ |
| `sources/strategy.md` | strategy | construct-prd.typ |
| `sources/deck-one-pager.md` | one-pager | construct-deck.html + PPTX |
| `sources/stress-multi-persona-prd.md` | prd | Multi-persona authorship stress (PDF) |
| `sources/stress-multi-persona-deck.md` | one-pager | Same scenario as slide deck (PPTX; `---` separators; layout audit must pass) |
| `sources/stress-share-audit-adr.md` | adr | Append-only share audit decision (PDF) |
| `sources/stress-share-compliance-memo.md` | compliance-memo | Obligation→control counsel gates (PDF) |
| `sources/stress-supabase-research-brief.md` | research-brief | Vendor-docs Supabase platform research (PDF; not fake customer claims) |

Edit sources, then re-run the generator. Outputs land in `.tmp/distribution-examples/` (gitignored).

### Multi-persona stress exports

One coherent story across PRD, ADR, compliance memo, and deck. Dense PRD markdown is valid for PDF but fails PPTX layout audit by design (no slide separators / dense prose). Use the deck source for PPTX:

```bash
node bin/construct export examples/distribution/sources/stress-multi-persona-deck.md --to=pptx --output=~/Downloads/construct-stress-multi-persona.pptx
node bin/construct export examples/distribution/sources/stress-multi-persona-prd.md --to=pdf --figures --output=~/Downloads/construct-stress-multi-persona.pdf
node bin/construct export examples/distribution/sources/stress-share-audit-adr.md --to=pdf --figures --output=~/Downloads/construct-stress-share-audit-adr.pdf
node bin/construct export examples/distribution/sources/stress-share-compliance-memo.md --to=pdf --figures --output=~/Downloads/construct-stress-share-compliance-memo.pdf
node bin/construct artifact validate examples/distribution/sources/stress-supabase-research-brief.md --type=research-brief
node bin/construct export examples/distribution/sources/stress-supabase-research-brief.md --to=pdf --figures --output=~/Downloads/construct-supabase-research-brief.pdf
```

Fixtures force legal/privacy triggers, user-advocacy evidence gaps (`unknown` / `[unverified]`), competitive landscape honesty, Phase Why?, inclusive framing, and adversarial FMEA across personas. The Supabase research brief is vendor-doc grounded (official URLs), not a fake customer case.

## Single-file export

```bash
node bin/construct export examples/distribution/sources/adr.md --to=pdf --figures
```

See [branding.md](../../docs/guides/reference/branding.md) and [diagram-and-demo.md](../../docs/guides/cookbook/diagram-and-demo.md).
