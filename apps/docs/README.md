# Construct docs site

Next.js app (App Router + Tailwind + `@construct/ui`) that publishes the editorial docs
experience at `https://geraldmaron.github.io/construct/`.

## Quick start

```bash
npm ci
node ./bin/construct docs:site
npm --prefix apps/docs run dev
```

Site runs at http://localhost:3000/ (empty base path). Production build uses
`DOCS_BASE_PATH=/construct`.

## How it works

- **Home (`/`)** — hand-authored React in `app/page.tsx`; mirrors README narrative.
- **All other routes** — rendered from repo-root `docs/**/*.md(x)` via the catch-all
  `app/[...slug]/page.tsx`. Prose pages use `.md`; pages with `@construct/ui` components use `.mdx`.
  Catalog + sidebar come from `lib/docs-source.ts`.
- **Generated reference** — `construct docs:site` writes `docs/guides/reference/cli/*`,
  `docs/guides/reference/hooks.md`, and `docs/guides/reference/specialists.md` from live registries.
- **Build:** `next build` static-exports to `apps/docs/out/`. Deployed by
  `.github/workflows/pages.yml` when `PAGES_ENABLED` is true.

## Sidebar lanes

Configured in `lib/docs-source.ts` (`SIDEBAR_LAYOUT`):

- Start, Concepts, Cookbook, Reference (editorial core)
- Maintenance, Contributing, ADRs (ops and governance)

Each lane reads ordering from its `docs/<lane>/meta.json`. Nested pages (e.g.
`/reference/cli/advanced`) are reachable by URL but not listed in the sidebar.

## Structure

```
apps/docs/
├── app/
│   ├── page.tsx              — Home
│   ├── [...slug]/page.tsx    — MDX catch-all for docs/
│   └── layout.tsx            — Root layout + fonts
├── lib/docs-source.ts        — Walk docs/, build sidebar + static params
├── components/               — App shell, palette, theme
└── next.config.mjs           — Static export, basePath from DOCS_BASE_PATH
```

## Adding content

1. Add or edit a file under repo-root `docs/`.
2. Update the lane's `meta.json` if ordering matters.
3. Run `node ./bin/construct docs:site` when CLI/hooks/specialists registries change.
4. Build: `DOCS_BASE_PATH=/construct npm --prefix apps/docs run build`.
