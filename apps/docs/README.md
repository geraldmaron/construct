# Construct docs site

Next.js + Fumadocs app that publishes [docs/](../../docs/) as the public docs at `<owner>.github.io/construct/`.

## Quick start

```bash
cd apps/docs
npm install
npm run dev
```

Site runs at http://localhost:3000/.

## How it works

- **Source of truth:** the repo-root `docs/` directory. `apps/docs/source.config.ts` points Fumadocs at `../../docs` so MDX/MD files in `docs/` render directly. No double-write.
- **Auto-generated pages:** `construct docs:site` (in `bin/construct`) emits MDX into `docs/reference/cli/`, `docs/reference/specialists.mdx`, and `docs/reference/hooks.mdx` from canonical sources (`lib/cli-commands.mjs`, `specialists/registry.json`, `lib/hooks/`). Re-run after CLI catalog changes.
- **AUTO regions in markdown:** `construct docs:update` still regenerates `<!-- AUTO:* -->` regions inside the README and a handful of other files. Independent of the docs site build.
- **Build:** `next build` produces a static export to `apps/docs/out/`. Deployed by `.github/workflows/pages.yml` to GitHub Pages.

## Structure

```
apps/docs/
├── app/
│   ├── (home)/        — landing page (NOT in docs sidebar)
│   ├── docs/          — dynamic docs pages keyed off /docs/[[...slug]]
│   ├── api/search/    — search endpoint (Orama-backed)
│   ├── layout.tsx     — root layout
│   └── layout.config.tsx — nav, sidebar, branding
├── lib/source.ts      — Fumadocs source loader (reads from ../../docs)
├── mdx-components.tsx — MDX component overrides
├── source.config.ts   — Fumadocs MDX config
├── next.config.mjs    — Next.js config (static export mode)
└── tsconfig.json
```

## Adding a page

Drop a new `.mdx` or `.md` file under `docs/`. The path becomes the URL slug.

Frontmatter:

```yaml
---
title: Page Title
description: One-line description used in search results
---
```

## Tracking

This package isn't published to npm. It's a sibling app that consumes `docs/` and emits a static site.
