---
title: Root semantics
description: The three directory concepts in Construct and which subsystems use each one.
---

## The three roots

Construct operates across two directory concepts — the package and the project — plus the raw working directory. Conflating them causes bundled assets to be looked up in user repos, or user state to be written into the install directory. `lib/roots.mjs` defines canonical exports for all three.

### packageRoot

The directory where the Construct npm package is installed. Resolved from `import.meta.url` at module load time, stable across global install, `npx`, and local dev symlinks.

```js
import { packageRoot } from './lib/roots.mjs';
```

Use `packageRoot` to locate assets that ship **with Construct itself**: Worker Profile prompts, skill files, schemas, hook scripts, templates, and the registry. These assets are always relative to the package, regardless of where the user's project lives.

### resolveProjectRoot(cwd?)

The root of the user's repository being operated on. Resolved at runtime by inspecting `--project <dir>` in `process.argv`, then walking upward from `cwd` looking for `.construct/` (Construct project marker) or `package.json` (generic JS root). Falls back to `cwd` when no marker is found.

```js
import { resolveProjectRoot } from './lib/roots.mjs';

const projectRoot = resolveProjectRoot(); // uses process.cwd()
```

Pass an explicit `cwd` in tests or sub-process workers to control the starting directory without relying on the ambient process cwd.

Use `projectRoot` for everything that reads from or writes to **the user's repo**: `.construct/` state (observations, sessions, intake, task graphs), oracle verdicts, telemetry, beads, and provider configs.

### process.cwd()

The raw working directory at the moment the process started. Useful for resolving relative paths before `resolveProjectRoot` has been called. Callers should prefer `resolveProjectRoot(cwd)` once it is determined.

## Which subsystem uses which root

| Subsystem | Root used | Reason |
|---|---|---|
| Worker Profile loader (`lib/worker-profiles/`, pack prompts via `lib/packs/prompts.mjs`) | `packageRoot` | Profiles and prompts ship with the package |
| Skill loader (`lib/skills/`) | `packageRoot` | Skills are bundled assets |
| Schema validation (`schemas/`) | `packageRoot` | Schemas are bundled with the package |
| Hook scripts (`lib/hooks/`) | `packageRoot` | Hooks reference the install's lib/ |
| Templates (`templates/`) | `packageRoot` | Doc templates ship with the package |
| Observation store (`.construct/observations/`) | `projectRoot` | Per-project durable state |
| Session store (`.construct/sessions/`) | `projectRoot` | Per-project durable state |
| Intake queue (`.construct/intake/`) | `projectRoot` | Per-project durable state |
| Task graphs (`.construct/task-graphs/`) | `projectRoot` | Per-project durable state |
| Oracle verdicts (`.construct/oracle/`) | `projectRoot` | Per-project durable state |
| Telemetry (`.construct/telemetry/`) | `projectRoot` | Per-project durable state |
| Beads tracker (`.beads/`) | `projectRoot` | Per-project issue tracker |
| Provider config (`.construct/providers.yaml`) | `projectRoot` | Per-project credentials scope |
| `construct.config.json` | `projectRoot` | Per-project configuration |

## Concrete example

Construct is installed globally at `/usr/local/lib/node_modules/construct`. The user runs `construct init` inside `/myproject`.

| Expression | Resolves to |
|---|---|
| `packageRoot` | `/usr/local/lib/node_modules/construct` |
| `resolveProjectRoot()` | `/myproject` (found `.construct/` marker) |
| `process.cwd()` | `/myproject` (where the shell is) |

In this scenario, `packageRoot` and `resolveProjectRoot()` differ. A skill loaded from `packageRoot/skills/engineering.md` is the same file regardless of which project the user is in. An observation written to `projectRoot/.construct/observations/` is scoped to `/myproject`.

When Construct is run inside its own source tree (self-hosting), the two roots coincide: both resolve to the construct repo. This is the only case where they are the same path.

## History

Prior to `lib/roots.mjs`, both concepts were conflated under a single `ROOT_DIR` constant, which broke correct resolution when Construct was installed globally and operated on a project in a separate directory. `lib/roots.mjs` was introduced to make the distinction explicit and enforce the correct root at each call site.
