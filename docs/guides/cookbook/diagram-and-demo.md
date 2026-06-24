---
title: Diagram and demo
description: Render code-driven diagrams (D2/Graphviz), reproducible terminal demos (VHS), dashboard demos (Playwright), and publish research briefs to PDF.
---

Commands follow the optional **external system binaries** contract (ADR-0001).
`construct publish --strict` fails loud (exit 2) when required tooling **or the
artifact release gate** fails. Do not use `--no-gate` in demos or ship paths;
individual `diagram`/`demo` commands degrade to source-only (exit 0).

## Toolchain detect

```bash
node bin/construct tools detect --json
brew install d2 graphviz pandoc typst vhs
npm install -g @mermaid-js/mermaid-cli
```

## Publish a typed artifact (validate first)

```bash
node bin/construct artifact validate docs/prd-platform/brief.md --type=prd-platform
node bin/construct publish docs/prd-platform/brief.md --strict --figures
```

- Runs **artifact release gate** before export (structure, visuals, citations, prose minimum)
- Renders fenced `d2` / `mermaid` via vendored `pandoc-ext/diagram` with **hand-drawn distribution styling** (D2 `--sketch`, Mermaid `handDrawn` look + bundled Caveat handwriting, monochrome ink accent)
- PDF routes by `artifactType`: `construct-prd.typ` (product editorial), `construct-research.typ` (analytics), `construct-decision.typ` (ADR/RFC); override: `.cx/publish-theme.typ`
- Typography ships bundled in `templates/distribution/fonts/` (Space Grotesk body + headings, JetBrains Mono code; Caveat handwriting for hand-drawn diagram labels). Success metrics tables in blockquotes render as **Key metrics** callouts.
- Optional VHS terminal demo + Playwright dashboard demo via frontmatter or flags

Authoring conventions for richer PDFs:

```markdown
> One paragraph a PM would read aloud — renders as an **At a glance** callout.

> | Metric | Baseline | Target |
> | --- | --- | --- |
> | Gate pass rate | manual | enforced |

\`\`\`d2
direction: right
a: Component A
b: Component B
a -> b
\`\`\`

\`\`\`mermaid
flowchart TD
  A[Host] --> B[construct publish]
\`\`\`
```

Reference D2 sources live under `tests/fixtures/publish/diagrams/` in the tool repo; inline fenced blocks export at publish time with **D2 `--sketch`** and **Mermaid `handDrawn`** (monochrome ink, Caveat handwriting labels).

Optional masthead metadata (renders in the compact header — do not repeat in body):

```yaml
subtitle: One-line product framing
version: "0.1"
doc_id: PRD-PLATFORM-001
classification: internal
status: draft
owner: cx-product-manager
last_verified_at: 2026-06-19
artifactType: prd-platform
```

Optional publish frontmatter:

```yaml
publish:
  demo: resource-guard-rails
  dashboardDemo: cockpit-tour
  recording: agentic-platforms-prd
```

`recording` references a Playwright manifest in `.cx/demos/recordings/` (project) or `templates/demos/recordings/` (shipped). Legacy `dashboardDemo` still works via the script bridge.

## Demo any application (Playwright recordings)

Project-scoped manifests live under `.cx/demos/recordings/<name>.json`:

```json
{
  "name": "marketing-site",
  "engine": "playwright",
  "workspace": ".",
  "spec": ".cx/demos/specs/marketing-site.spec.ts",
  "baseUrl": "http://127.0.0.1:3456",
  "webServer": {
    "command": "npx serve out -l 3456",
    "url": "http://127.0.0.1:3456"
  },
  "artifactReveal": {
    "mode": "sameOrigin",
    "staticDir": "out",
    "file": "pricing.html",
    "scroll": true
  },
  "output": { "format": "mp4", "path": ".cx/demos/marketing-site.mp4" }
}
```

| Archetype | `webServer` | `artifactReveal.mode` |
|-----------|-------------|------------------------|
| Construct cockpit | `lib/server` (dashboard config) | `constructPreview` → `/demo-preview/<file>` |
| Next.js static export | `npx serve out` | `sameOrigin` → `{baseUrl}/<file>` |
| External SaaS | `skipWebServer: true` | optional |

Scaffold a project recording:

```bash
construct demo init marketing --from=nextjs-static
construct demo init docs-tour --from=external-url
construct demo init my-prd --from=construct-cockpit
npm run build && construct demo record marketing --format mp4
```

Shared scroll helpers ship in `templates/demos/specs/_helpers/scroll-artifact.ts` (copied into `.cx/demos/specs/_helpers/` on init). Schema: `schemas/demo-recording.schema.json`.

## Render a diagram

```bash
construct diagram "web app: client -> api -> db"
```

Default D2 theme is **neutral** (clean geometry). Use `--theme sketch` for hand-drawn output (`construct diagram` and publish `--figures` both honor sketch on the distribution path).

Output: `.cx/diagrams/*.svg` (or `.d2` source when no renderer).

## Terminal demos (chat-first)

Demo scripts under `templates/demos/scripts/` drive **construct chat** by default:

```bash
construct demo list
construct demo agentic-platforms-prd          # Ink chat with /demo next steps
construct demo agentic-platforms-prd --web    # browser cockpit at /chat/
construct demo agentic-platforms-prd --surface=tape --format mp4   # VHS fallback
```

Fallback chain when chat is unavailable: **web chat → Playwright recording → dashboard → VHS tape → printed script steps**.

Inside chat, use `/demo next` for the next prompt, `/demo steps` to replay the outline.

## Terminal demos (VHS recording)

Project tapes live in `templates/demos/tapes/` (shipped) with optional overrides in `.cx/demos/tapes/` — **commit shipped tapes; regenerate MP4/GIF in CI or with `construct demo record`**.

Theme: `templates/demos/vhs/construct-cockpit.json` (monochrome — `#0a0c10` background, white cursor, grey accents).

```bash
construct demo init my-topic --from=quickstart
construct demo record resource-guard-rails --format mp4
```

Scaffold templates: `quickstart`, `diagram`. CI: `.github/workflows/publish-media.yml` uses `charmbracelet/vhs-action`.

## Dashboard demos (Playwright — cockpit + PDF scroll)

The flagship `agentic-platforms-prd` demo records the **branded web terminal cockpit** at `/chat/`, then opens the exported PDF via `/demo-preview/` and scrolls through the artifact. Distribution gallery generation uses this surface by default.

```bash
cd apps/dashboard && npm install && npx playwright install chromium
construct demo record agentic-platforms-prd --format mp4
node bin/construct demo dashboard:agentic-platforms-prd
```

Playwright spec: `apps/dashboard/e2e/demo/agentic-platforms-prd.spec.ts` — Act 1 walks `/chat/` with `/demo` steps; Act 2 opens `prd-platform.pdf` from `CONSTRUCT_DEMO_ARTIFACT_DIR` and scrolls in Chrome's PDF viewer.

When recording with a published artifact on disk:

```bash
CONSTRUCT_DEMO_ARTIFACT_DIR=.tmp/distribution-examples \
DEMO_ARTIFACT_FILE=prd-platform.pdf \
npx playwright test --config apps/dashboard/playwright.config.mjs \
  apps/dashboard/e2e/demo/agentic-platforms-prd.spec.ts --project=demo-recording
```

The dashboard server exposes `GET /demo-preview/<filename>` only when `CONSTRUCT_DEMO_ARTIFACT_DIR` is set (path-traversal guarded). Config: `webServer` + `video: on`; output transcodes WebM → MP4 via ffmpeg when available.

## Terminal demos (VHS recording — CLI fallback)

```bash
construct export brief.md --to=pdf --figures
```

Uses Pandoc + Typst (PDF) with the diagram Lua filter when `--figures` is set.

`--to` accepts `pdf`, `docx`, `doc`, `deck`, `pptx`, `html`, `rtf`, `odt`, `epub`, `tex`, `txt`, `md`, `mdx`. Export **input** is a markdown artifact; **output** spans PDF (Pandoc+Typst), HTML/deck (branded templates), PPTX (pptxgenjs), DOCX (Pandoc), and legacy `.doc` (Pandoc DOCX + LibreOffice headless). Ingest (`construct ingest`) is the separate path that accepts PDF, Office, email, AV, and plain text — see [Document I/O reference](/guides/reference/document-io).

**Branded deck preview** (local, gitignored):

```bash
npm run examples:deck
open .tmp/distribution-examples/construct-deck-example.html
```

Source fixture: `tests/fixtures/publish/golden-deck-platform.md`.
