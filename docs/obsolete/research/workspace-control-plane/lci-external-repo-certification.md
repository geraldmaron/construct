---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# LCI external-repo certification (construct-4uxq0.11.15)

Certification exercise: drive the Lifecycle Change Intent (LCI) loop in a disposable plain project outside the Construct checkout.

## Fixture

- Location: `mktemp -d /tmp/lci-cert-scratch-*` (not a subdirectory of the Construct repo)
- Contents: minimal git repo with `lib/greeter.mjs` and `lib/index.mjs` only
- Construct invoked via `node /path/to/construct/bin/construct` with isolated `HOME` / `CONSTRUCT_HOME_OVERRIDE`

## Transcript (2026-07-20)

### 1. `construct init --yes --no-start`

Exit 0. Scaffolds `.construct/context.md`, `construct.config.json`, intake manifest, launcher stubs. No registry/specialists/org layout in the external project.

### 2. `construct graph build --no-co-change`

Exit 0. Graph persisted under project `.construct/graph/` (JSONL snapshot) with registry-seeded capability/workflow nodes from the Construct package plus import-graph file nodes.

Before fix: project `lib/*.mjs` files were absent from the graph (import graph walked only the Construct package root). After fix: project source files merge into the host import graph when `projectDir !== packageRoot`.

Node mix (representative): ~2600+ nodes; fewer project-local types than Construct's own repo (no project registry cards, no co-change history, no project procedures unless contributed).

### 3. `construct graph intent declare --target file:lib/greeter.mjs`

Before fix: `unknown target: file:lib/greeter.mjs` (project file not in graph).

After fix: exit 0; durable intent + pre-change impact packet under `.construct/graph/intents/`.

### 4. Code change

Append a line to `lib/greeter.mjs` after intent declaration (simulated PR diff scope).

### 5. `construct graph verify --changed lib/greeter.mjs`

Before fix: 334 validate violations (`doc` nodes and provider manifests resolved against the external project root instead of the Construct package root).

After fix: exit 0, `graph verify passed`; change-intent impact diff matches declared packet.

### 6. `construct graph verify` (no changed files)

Exit 0 after package-root validation fix (registry-seeded disk checks resolve against the Construct install root when the active project is external).

## What worked fully

- `construct init` on a plain repo
- Registry-seeded graph build without crash
- Full change-intent → impact packet → verify loop on project-local files after import-graph merge and package-root validation

## What degrades gracefully

- Graph carries Construct package registry/corpus/embed seeds (expected); external projects do not populate Construct-specific node types (org, project registry cards, project procedures) unless contributed under `.construct/`
- Impact packets for project-only files may list empty capability/workflow sets when no `realizes` edges reach project code (safe over-inclusive default)

## Bugs surfaced and disposition

| Issue | Disposition |
| --- | --- |
| Host import graph ignored project source when `projectDir !== packageRoot` | Fixed inline in `lib/graph/cli.mjs` and `lib/graph/incremental.mjs` (merge project import slice) |
| `graph verify` validate checked registry doc/provider paths against project root | Fixed inline in `lib/graph/validate.mjs` and threaded via `lib/graph/verify.mjs` (`packageRoot`) |

## Hermetic regression

`tests/functional/lci-external-repo.functional.test.mjs` replays steps 1–5 in tmpdir on every CI run.

## Optional human re-run

```bash
SCRATCH=$(mktemp -d /tmp/lci-cert-scratch-XXXXXX)
cd "$SCRATCH"
git init -q --initial-branch=main
mkdir -p lib
printf 'export function greet(n){return n;}\n' > lib/greeter.mjs
git add -A && git commit -q -m init
export HOME=$(mktemp -d /tmp/lci-cert-home-XXXXXX)
export CONSTRUCT_HOME_OVERRIDE="$HOME"
node /path/to/construct/bin/construct init --yes --no-start
node /path/to/construct/bin/construct graph build --no-co-change
node /path/to/construct/bin/construct graph intent declare --target file:lib/greeter.mjs
echo >> lib/greeter.mjs
node /path/to/construct/bin/construct graph verify --changed lib/greeter.mjs
```
