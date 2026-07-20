# Excalidraw feasibility prototype (construct-tsyfe.4.6)

**Status:** PROTOTYPE ONLY. Not exported from `@construct/ui/index.ts` and not wired to any production route.

## Question

If Construct needed an editable freeform-drawing surface later, what would Excalidraw cost in bundle size, security posture, and integration shape?

## Measured need check (2026-07-20)

- `bd ready` and open beads on `feat/workspace-control-plane` show no user-facing request for editable drawing.
- `docs/guides/cookbook/wireframe-and-drop.md` explicitly rejects canvas libraries including Excalidraw embeds (`construct-tsyfe.4.7`).
- Hand-drawn aesthetic need is already covered by D2 `--sketch` and Mermaid `handDrawn` (`lib/diagram-export.mjs`, `lib/diagram.mjs`).

## Prototype

- Source: `packages/construct-ui/prototypes/excalidraw-editor/ExcalidrawPrototype.tsx`
- Pattern: same lazy `await import('@excalidraw/excalidraw')` gate used by `packages/construct-ui/components/mermaid.tsx`.
- Dependency: `@excalidraw/excalidraw@0.18.1` scoped to `apps/docs` devDependencies (prototype consumer only).

## Bundle cost (esbuild, minified, browser platform)

From `bench-results.json` (run `node packages/construct-ui/prototypes/excalidraw-editor/bench.mjs`):

| Entry | Minified | Gzip |
|---|---:|---:|
| Lazy dynamic-import entry | 8,252,374 B | 2,494,128 B |
| Static import entry | 8,239,645 B | 2,487,761 B |

Excalidraw is roughly **2.5 MB gzip** when loaded. This dwarfs the Cytoscape prototype delta (~141 KB gzip per `construct-tsyfe.4.5` close evidence) and exceeds Construct web bundle budgets in `construct-web-performance` rules.

## Bundle isolation

- `grep -rn excalidraw bin/ lib/` (case-sensitive): **zero import sites** (one historical comment in `lib/diagram-export.mjs` mentions "Excalidraw-adjacent" styling only; no dependency).
- Prototype is not re-exported from `@construct/ui`.

## Security checklist

| Check | Result |
|---|---|
| License | MIT (`@excalidraw/excalidraw`) |
| Client-side only in prototype | Yes |
| No `eval` in prototype import path | Yes (standard ESM import) |
| Remote CDN fetch by default | No (npm package, local bundle) |
| npm audit attributable to excalidraw install | 11 vulnerabilities reported at workspace level after install; none isolated to a single excalidraw-only tree in this session (full `npm audit` is workspace-mixed) |

Same trust boundary as Mermaid client rendering: local repo/user data, not unsandboxed remote input. Production would still need CSP, save/load policy, and export provenance if ever adopted.

## Recommendation: DEFER

Do **not** adopt Excalidraw for Construct now. Revisit only when a **measured need** appears that semantic HTML wireframes, Mermaid, or D2 cannot satisfy.

**Trigger:** an open bead or explicit product request requiring **editable freeform drawing** (not diagram codegen), with acceptance criteria that cannot be met by `lib/wireframe.mjs`, `lib/diagram.mjs`, or RichDocument embeds.

**Dismissed without re-litigation:** Rough.js (hand-drawn look already via D2/Mermaid), Graphology/SCIP (unrelated to drawing, per program pre-research).

## Rollback

Delete `packages/construct-ui/prototypes/excalidraw-editor/` and remove `@excalidraw/excalidraw` from `apps/docs/package.json`. No production surface depends on this prototype.
