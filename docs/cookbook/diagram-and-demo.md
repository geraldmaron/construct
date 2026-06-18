---
title: Diagram and demo
description: Render code-driven diagrams (D2/Graphviz) and reproducible terminal demos (VHS/asciinema), degrading to source when no renderer is installed.
---

Both commands follow the same contract as `construct export`: rendering goes
through optional **external system binaries** detected at runtime (ADR-0001,
zero-npm-core). When the binary is absent, the command still succeeds (exit 0)
by writing the diagram/recording **source** plus an install hint.

## Render a diagram

```bash
construct diagram "web app: client -> api -> db"
```

Parses the `a -> b -> c` chain into a graph, generates D2 source, and renders
an SVG to `.cx/diagrams/`. If neither D2 nor Graphviz `dot` is installed, the
`.d2` source is written instead and the command exits 0 with an install hint.

### Choose a type, format, and theme

```bash
construct diagram "auth flow" --type flow
construct diagram "client -> api -> db" --format png --theme sketch
construct diagram "order lifecycle" --type state --source-only
```

| Type | Renderer | Notes |
|---|---|---|
| `architecture` (default) | D2 | Distinctive sketch + themes, MPL-2.0 |
| `flow` / `sequence` / `state` / `er` | Mermaid source | Reuses `lib/wireframe.mjs`; paste into any Mermaid viewer |
| `class` | D2 | |

`--format` accepts `svg` (default) or `png`. `--theme` takes a D2 theme name
(`neutral`, `sketch`, `cool-classics`, ...). `--out` overrides the output path.
`--source-only` skips rendering and always writes the source.

D2 is the **primary** renderer (single Go binary, headless SVG/PNG, distinctive
look). Graphviz `dot` is the **fallback** (ubiquitous on CI images). Install:

```bash
brew install d2        # primary
brew install graphviz  # fallback
```

## Record a demo

```bash
construct demo quickstart
```

Writes a VHS `.tape` describing a plan -> build -> ship walkthrough, then
renders a GIF to `.cx/demos/`. If neither VHS nor asciinema is installed, the
`.tape` source is written and the command exits 0 with an install hint.

### Choose a tape and format

```bash
construct demo diagram --format mp4
construct demo quickstart --source-only
```

Built-in tapes: `quickstart` (plan/build/ship) and `diagram` (render an
architecture diagram). `--format` accepts `gif` (default), `mp4`, or `webm`
(VHS only). `--out` overrides the output path. `--source-only` always writes
the `.tape` source.

VHS is the **primary** recorder (declarative `.tape` -> GIF/MP4/WebM, MIT,
reproducible in CI). asciinema is the **fallback** (records a `.cast`). Install:

```bash
brew install vhs        # primary
brew install asciinema  # fallback
```

The `.tape` and `.d2`/`.dot` sources are the source of truth — commit them and
regenerate the artifacts in CI.
