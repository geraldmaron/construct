# graph-viewer prototype (construct-tsyfe.4.5) — PROTOTYPE ONLY

Not wired into any production route, command, or build. Nothing under
`apps/docs` or `packages/cx-ui/index.ts`/`components/` imports this
directory; deleting it removes it cleanly with no other dependent (per the
bead's own Rollback section).

Validates whether Cytoscape.js can render `lib/graph/store.mjs`'s typed graph
(`.construct/graph/{nodes,edges}.jsonl`) as two switchable views — application
(capability/contract/skill/rule/provider/specialist/...) and dependency
(file/module + imports/contains/co_changes) — at this repo's real scale
(3187 nodes / 8370 edges as of the snapshot this prototype measured against).

## Layout

- `view-vocab.mjs` — application/dependency view split (browser-safe, no
  `node:fs`; hand-duplicated from `lib/graph/store.mjs`'s `NODE_TYPES`/
  `EDGE_RELS`, cross-checked by the drift-guard test).
- `transform.mjs` — pure JSONL-to-Cytoscape-elements transform.
- `provenance-sample.mjs` — a Diagram-Card-shaped provenance record
  (construct-tsyfe.4.1) for a rendered view.
- `fixtures/` — a representative sample (353 nodes / 524 edges) drawn from
  a real `construct graph build` run of this repo, not synthesized.
- `entry.mjs` + `index.html` + `dev-server.mjs` — a real, manually-inspectable
  browser demo (`node dev-server.mjs`, then open `http://localhost:4173/`).
- `bench.mjs` — headless perf bench at full repo scale (manual run).
- `build.mjs` — bundle-size delta via the repo's own esbuild devDependency
  (writes to `dist/`, gitignored).
- `DECISION.md` — the adopt/defer write-up this bead's closure cites.

## Disposition

See `DECISION.md` and the bead's closing notes (`bd show construct-tsyfe.4.5`)
for the adopt/defer decision and the evidence behind it.
