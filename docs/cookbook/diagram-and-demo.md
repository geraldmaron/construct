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
- Typography ships bundled in `templates/distribution/fonts/` (Plus Jakarta Sans body + headings, IBM Plex Mono code; Caveat handwriting for hand-drawn diagram labels). Success metrics tables in blockquotes render as **Key metrics** callouts.
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
  dashboardDemo: agentic-platforms-prd
```

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

Fallback chain when chat is unavailable: **web chat → dashboard Playwright → VHS tape → printed script steps**.

Inside chat, use `/demo next` for the next prompt, `/demo steps` to replay the outline.

## Terminal demos (VHS recording)

Project tapes live in `templates/demos/tapes/` (shipped) with optional overrides in `.cx/demos/tapes/` — **commit shipped tapes; regenerate MP4/GIF in CI or with `construct demo record`**.

Theme: `templates/demos/vhs/construct-cockpit.json` (monochrome — `#0a0c10` background, white cursor, grey accents).

```bash
construct demo init my-topic --from=quickstart
construct demo record resource-guard-rails --format mp4
```

Scaffold templates: `quickstart`, `diagram`. CI: `.github/workflows/publish-media.yml` uses `charmbracelet/vhs-action`.

## Dashboard demos (Playwright)

```bash
cd apps/dashboard && npm install && npx playwright install chromium
node bin/construct demo dashboard:agentic-platforms-prd
```

Playwright spec: `apps/dashboard/e2e/demo/agentic-platforms-prd.spec.ts` — walks `/chat/` with `/demo` steps. Config: `webServer` + `video: on`.

## Export only

```bash
construct export brief.md --to=pdf --figures
```

Uses Pandoc + Typst (PDF) with the diagram Lua filter when `--figures` is set.

`--to` accepts `pdf`, `docx`, `doc`, `deck`, `pptx`, `html`, `rtf`, `odt`, `epub`, `tex`, `txt`, `md`, `mdx`. Export **input** is a markdown artifact; **output** spans PDF (Pandoc+Typst), HTML/deck (branded templates), PPTX (pptxgenjs), DOCX (Pandoc), and legacy `.doc` (Pandoc DOCX + LibreOffice headless). Ingest (`construct ingest`) is the separate path that accepts PDF, Office, email, AV, and plain text — see [Document I/O reference](/reference/document-io).

**Branded deck preview** (local, gitignored):

```bash
npm run examples:deck
open .tmp/distribution-examples/construct-deck-example.html
```

Source fixture: `tests/fixtures/publish/golden-deck-platform.md`.
