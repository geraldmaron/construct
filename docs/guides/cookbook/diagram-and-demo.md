---
title: Diagram and demo
description: Render code-driven diagrams (D2/Graphviz), reproducible terminal demos (VHS), app demos (Playwright), and publish research briefs to PDF.
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
- Renders fenced `d2` / `mermaid` via vendored `pandoc-ext/diagram` with **crisp field-notebook distribution styling** (D2 without `--sketch`, Mermaid classic look + Plus Jakarta Sans labels, charcoal ink + slate-teal accent)
- PDF routes by `artifactType`: `construct-prd.typ` (product editorial), `construct-research.typ` (analytics), `construct-decision.typ` (ADR/RFC); override: `.construct/publish-theme.typ`
- Typography ships bundled in `templates/distribution/fonts/` (Plus Jakarta Sans body + headings, JetBrains Mono code). Success metrics tables in blockquotes render as **Key metrics** callouts.
- Optional interactive whiteboarding (Excalidraw, etc.) stays at the agent/tool layer — Construct publish remains Mermaid/D2 diagram-as-code.
- Optional VHS terminal demo + Playwright app demo via frontmatter or flags

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

Reference D2 sources live under `tests/fixtures/publish/diagrams/` in the tool repo; inline fenced blocks export at publish time with **crisp D2** and **Mermaid classic** (field-notebook ink, Plus Jakarta Sans labels).

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

`recording` references a Playwright manifest in `.construct/demos/recordings/` (project) or `templates/demos/recordings/` (shipped). Legacy `dashboardDemo` still works via the script bridge.

## Demo any application (Playwright recordings)

Project-scoped manifests live under `.construct/demos/recordings/<name>.json`:

```json
{
  "name": "marketing-site",
  "engine": "playwright",
  "workspace": ".",
  "spec": ".construct/demos/specs/marketing-site.spec.ts",
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
  "output": { "format": "mp4", "path": ".construct/demos/marketing-site.mp4" }
}
```

| Archetype | `webServer` | `artifactReveal.mode` |
|-----------|-------------|------------------------|
| Next.js static export | `npx serve out` | `sameOrigin` → `{baseUrl}/<file>` |
| External SaaS | `skipWebServer: true` | optional |

Scaffold a project recording:

```bash
construct demo init marketing --from=nextjs-static
construct demo init docs-tour --from=external-url
construct demo init my-prd --from=construct-cockpit
npm run build && construct demo record marketing --format mp4
```

Shared scroll helpers ship in `templates/demos/specs/_helpers/scroll-artifact.ts` (copied into `.construct/demos/specs/_helpers/` on init). Schema: `schemas/demo-recording.schema.json`.

## Render a diagram

```bash
construct diagram "web app: client -> api -> db"
```

Default D2 theme is **neutral** (clean geometry). Publish distribution path does **not** enable `--sketch`; use `construct diagram --theme sketch` only when an author explicitly wants sketch CLI output outside the brand publish path.

Output: `.construct/diagrams/*.svg` (or `.d2` source when no renderer).

## Terminal demos

Demo scripts under `templates/demos/scripts/` can be toured, printed, or paired with VHS/Playwright recordings:

```bash
construct demo list
construct demo tour agentic-platforms-prd
construct demo agentic-platforms-prd --surface=tape --format mp4
```

Fallback chain when a recorder is unavailable: **Playwright recording → VHS tape → printed script steps**.

## Self-demo guided tour

Walk a demo script step by step in the terminal — no assistant session, no recording:

```bash
construct demo tour                            # tour the first available script
construct demo tour agentic-platforms-prd      # tour a named script
construct demo tour --accessible               # linear, screen-reader-friendly output (no ANSI)
construct demo tour --accessible --skip-input  # auto-advance for headless/CI
```

Each step prints `Step N of M` with its prompt and command; the tour ends with `Tour complete.` Interactive runs pause for Enter between steps, while `--skip-input` (and any non-TTY stdout) auto-advances so piped and CI runs never block. `--accessible` forces the linear renderer with color disabled for WCAG-plain output.

## Terminal demos (VHS recording)

Project tapes live in `templates/demos/tapes/` (shipped) with optional overrides in `.construct/demos/tapes/` — **commit shipped tapes; regenerate MP4/GIF in CI or with `construct demo record`**.

Theme: `templates/demos/vhs/construct-cockpit.json` (monochrome — `#0a0c10` background, white cursor, grey accents).

```bash
construct demo init my-topic --from=quickstart
construct demo record resource-guard-rails --format mp4
```

Scaffold templates: `quickstart`, `diagram`. CI: `.github/workflows/publish-media.yml` uses `charmbracelet/vhs-action`.

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
