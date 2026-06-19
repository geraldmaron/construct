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
- Renders fenced `d2` / `mermaid` via vendored `pandoc-ext/diagram` with **distribution brand themes** (D2 neutral, branded Mermaid — not sketch/hand-drawn)
- PDF routes by `artifactType`: `construct-prd.typ` (editorial), `construct-research.typ` (analytics), `construct-decision.typ` (ADR/RFC); override: `.cx/publish-theme.typ`
- Optional VHS terminal demo + Playwright dashboard demo via frontmatter or flags

Authoring conventions for richer PDFs:

```markdown
::: executive-summary
One paragraph a PM would read aloud in a review.
:::

::: key-metrics
| Metric | Baseline | Target |
```

Demo tapes show **construct chat cockpit** (violet theme), not raw shell — run `construct demo agentic-platforms-prd` or see `.cx/demos/tapes/agentic-platforms-prd.tape`.

Optional frontmatter:

```yaml
publish:
  demo: resource-guard-rails
  dashboardDemo: agentic-platforms-prd
```

## Render a diagram

```bash
construct diagram "web app: client -> api -> db"
```

Default D2 theme is **neutral** (professional geometry). Use `--theme sketch` only for exploratory whiteboarding — not for publish.

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

Project tapes live in `.cx/demos/tapes/` — **commit the `.tape`, regenerate MP4/GIF in CI**.

Theme: `templates/demos/vhs/construct-cockpit.json` (navy + violet `#8b5cf6`).

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
