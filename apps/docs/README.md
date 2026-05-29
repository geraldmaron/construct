# Construct docs site

Next.js 15 app (plain App Router + Tailwind, no Fumadocs) that publishes the
editorial docs experience at `<owner>.github.io/construct/`. Designed to match
the handoff bundle in `Construct Docs.html`: black-and-white core with an
optional gradient accent, collapsible editorial sections, Cmd+K palette,
theme + density preferences.

## Quick start

```bash
npm --prefix apps/docs install
npm --prefix apps/docs run dev
```

Site runs at http://localhost:3000/.

## How it works

- **Three explicit pages** today: `/` (home), `/start` (getting started),
  `/architecture`. Each page is a server-or-client React component in
  `app/<route>/page.tsx`. The chrome (topbar, sidebar, command palette, theme
  toggles) lives in `components/app-shell.tsx` and wraps every route via
  `app/layout.tsx`.
- **MDX-driven content** under repo-root `docs/` is still emitted by
  `construct docs:update` and `construct docs:site` into `docs/reference/`,
  but a generic `/docs/[...slug]` MDX renderer is a follow-up: it is not
  wired into this version of the site.
- **Build:** `next build` produces a static export to `apps/docs/out/`.
  Deployed by `.github/workflows/pages.yml` to GitHub Pages.
- **Theme:** runtime preferences (theme, density, reduce-motion, calm mode,
  hue palette) persist in `localStorage` under `construct-docs-prefs` so a
  returning reader gets their last selection.

## Structure

```
apps/docs/
├── app/
│   ├── page.tsx             — Home (hero + 5 sections)
│   ├── start/page.tsx       — Getting Started (8 sections)
│   ├── architecture/page.tsx — Architecture (9 sections)
│   ├── layout.tsx           — Root layout + font wiring
│   └── theme.css            — Editorial theme variables + classes
├── components/
│   ├── app-shell.tsx        — Topbar + sidebar + theme/palette state
│   ├── section.tsx          — Collapsible editorial section primitive
│   ├── code-block.tsx       — Code block with copy + bash highlight
│   ├── mermaid.tsx          — Mermaid + framed Diagram container
│   ├── command-palette.tsx  — ⌘K / ⌃K palette
│   ├── callout.tsx, feature-grid.tsx, icons.tsx, nav-data.ts,
│   │  use-theme.ts          — supporting primitives
├── next.config.mjs          — Next.js config (static export, MDX support)
├── tailwind.config.ts       — Tailwind v3 setup
└── tsconfig.json
```

## Adding a page

Create `app/<route>/page.tsx` and add it to `components/nav-data.ts` so the
sidebar + command palette pick it up. Use `<Section>`, `<CodeBlock>`,
`<Diagram>`, `<Callout>`, and `<FeatureGrid>` from `components/` to keep the
visual language consistent.

## Tracking

This package isn't published to npm. It's a sibling app that owns the public
docs experience and emits a static site.
