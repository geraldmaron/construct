# Cytoscape.js prototype — adopt/defer evidence (construct-tsyfe.4.5)

Prototype: `packages/cx-ui/prototypes/graph-viewer/` (PROTOTYPE ONLY, not
wired into production — see `README.md`). All numbers below are measured on
this repo's own worktree (branch `worktree-agent-a8ebff8523d49fa2c`, fast-
forwarded to `feat/fable5-bead-program` @ `9f3b8fcd`), not estimated.

## Real graph scale measured against

`node bin/construct graph build` on this repo produced (`.construct/graph/meta.json`):
**3187 nodes, 8370 edges** across the 17 `NODE_TYPES` / 17 `EDGE_RELS` in
`lib/graph/store.mjs`. View split (`view-vocab.mjs`): application view =
1485 nodes / 463 edges (cross-view edges dropped, see `transform.mjs`);
dependency view (file+module / imports+contains+co_changes) = 1702 nodes /
3445 edges.

## Performance (`bench.mjs`, headless Cytoscape core, `node` v25.9.0, Apple Silicon)

| view | nodes | edges | construct | `cose` layout (500 iter) | `grid` | `concentric` | `breadthfirst` |
|---|---|---|---|---|---|---|---|
| application | 1485 | 463 | 18.4ms | 3796.7ms | 11.3ms | 6.3ms | 235.0ms |
| dependency | 1702 | 3445 | 23.9ms | 15028.0ms | 10.2ms | 18.7ms | 273.8ms |

Core graph-model construction is fast at full repo scale regardless of view.
Force-directed `cose` layout is the outlier: acceptable for the smaller
application view (~3.8s) but 15s for the denser dependency view — too slow
for an on-load default at this repo's real scale. Discrete layouts
(`grid`/`concentric`/`breadthfirst`) all complete in well under 300ms at the
same scale, so a production viewer would need to default to one of those (or
lazily expand from a filtered subgraph) rather than force-directed layout
across the whole graph.

A real browser render (Claude Browser pane, `dev-server.mjs` +
`index.html`/`entry.mjs`, fixture scale: 353 nodes / 524 edges) confirmed
both views paint correctly and interactively (pan/zoom, view toggle) with
zero console errors — screenshots taken during this session show the
application view's connected cluster + isolated-node row, and the dependency
view's real `lib/`/`bin/` file and module names with directional import
edges.

**Integration gotcha found and fixed**: sizing `#cy` with `height: calc(100vh
- Xrem)` produced `document.documentElement.clientHeight: 0` in this preview
environment, so Cytoscape's container read as 0×0 and rendered nothing —
silently, no console error. Fixed with flex-based sizing plus an
`requestAnimationFrame`-delayed `cy.resize()`/`cy.fit()`. Any future
production-wiring bead should budget for this class of container-timing
issue and verify it under the actual target rendering environment, not
assume it's specific to this preview harness.

## Bundle size delta

- `cytoscape@3.34.0` npm package dist: `cytoscape.min.js` 435,328 bytes raw /
  136,821 bytes gzip; `cytoscape.esm.min.mjs` 433,927 bytes raw / 136,030
  bytes gzip.
- `build.mjs` (esbuild, the repo's own devDependency, minified ESM bundle of
  a minimal entry that only imports `cytoscape` in headless mode): baseline
  entry 59 bytes; with-cytoscape entry 443,754 bytes minified / 141,730 bytes
  gzip. Delta: **+443,695 bytes minified (+141,671 bytes gzip)**, consistent
  with the raw package size above (both measurements agree within ~2%).
- Not measured: a same-repo `mermaid` bundle-size comparison — `mermaid` is
  an `apps/docs` dependency not installed in this worktree's `node_modules`,
  so a figure here would be a guess, not a measurement. `unknown`.
- Lazy-loaded only in the graph-viewer surface (mirrors
  `packages/cx-ui/components/mermaid.tsx`'s `(await import('mermaid'))`
  pattern) — confirmed zero `bin/`+`lib/` references
  (`tests/graph/cytoscape-graph-viewer-prototype.test.mjs`, AC2), so this
  cost never reaches the CLI/core bundle.

## Security posture

- `npm ls cytoscape --all`: `cytoscape@3.34.0` has **zero runtime
  dependencies** — nothing nests beneath it. `package-lock.json` diff for
  the install is a 7-line addition (one package entry), confirming no
  transitive packages were pulled in.
- License: MIT.
- `npm audit` after installing: 2 moderate-severity findings, both in
  `postcss` (< 8.5.10, XSS via unescaped `</style>` in output,
  GHSA-qx2v-qp2m-jg93) via `next`'s own dependency tree
  (`apps/docs`'s pre-existing `next` dependency) — **zero findings
  attributable to `cytoscape` itself**.
- No `eval` / `Function` construction in the integration path used here:
  Cytoscape's elements format (`{ data: {...} }` objects, per
  `transform.mjs`) is plain JSON, not evaluated code; `entry.mjs` fetches
  only same-origin `./fixtures/*.json`, never a remote CDN; headless mode
  (used by `bench.mjs` and the smoke test) needs no DOM/canvas at all.
- `lib/diagram-card.mjs`'s `ENGINES` enum (construct-tsyfe.4.1) does not yet
  include `'cytoscape'` — `provenance-sample.mjs` demonstrates this: a
  Diagram Card built with `engine: 'cytoscape'` degrades honestly to
  `engine: 'unknown', degraded: true`. A future production-wiring bead must
  add `'cytoscape'` to `ENGINES` (`lib/diagram-card.mjs:38`) before a caller
  can produce a non-degraded card.

## Alternatives (per this bead's Decision section — not re-evaluated here)

Graphology and SCIP remain dismissed-unless-need per program pre-research;
not independently evaluated in this prototype.

## Adopt / defer decision

**Adopt** Cytoscape.js as Construct's interactive graph-visualization
provider, per ADR-0097's pre-evaluated "graph/diagram rendering" delegation
class. Evidence: zero runtime dependencies and no cytoscape-attributable
`npm audit` findings; core graph-model operations are fast at this repo's
real scale (tens of ms); bundle cost (~434KB minified / ~138KB gzip) is
real but fully isolated to a lazily-loaded surface, grep-provably absent
from `bin/`+`lib/`.

This bead does **not** commit to production adoption (per its own Decision
section) — a follow-up bead must do the actual route/command wiring, and
should carry forward two concrete constraints found here: (1) default to a
discrete layout (`grid`/`concentric`/`breadthfirst`) rather than `cose` for
full-repo-scale views, reserving force-directed layout for filtered/smaller
subgraphs; (2) add `'cytoscape'` to `lib/diagram-card.mjs`'s `ENGINES` enum
before wiring a caller that produces Diagram Cards for it.

Measurable trigger to revisit this decision (mirroring ADR-0001's own "3+
defects in 6 months" promotion-trigger pattern): if a production integration
surfaces 3+ Cytoscape-attributable security/performance defects within 6
months of shipping, re-open the adopt decision rather than patching around
it indefinitely.
