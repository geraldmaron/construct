# Capability Matrix

Audit Phase 7 deliverable (epic `construct-ij31`, bead `construct-ij31.15`). Companion to [`tooling-scorecard.md`](./tooling-scorecard.md): where the scorecard grades the *tools* Construct depends on, this maps each user-facing **capability** to the end-to-end path a user or agent takes through Construct — the CLI command (if any), the skill that drives the work, and the specialist that owns the judgment.

## How to read a row

Every capability resolves through the same shape:

- **CLI command** — the `construct <cmd>` entry point, if one exists. Source: `lib/cli-commands.mjs`. Some capabilities are *pure skill/specialist* and have **no command** — that is stated explicitly, not invented.
- **Skill** — the slash-command skill that scopes the work. Source: `.claude/commands/<verb>/<noun>.md` (synced from the shipped command set). Skill names render as `verb:noun` (e.g. `build:feature`).
- **Specialist** — the `cx-*` role that owns the judgment for that capability. Source: `specialists/registry.json`. Construct (the orchestrator) routes to it; it does not do the judgment itself.
- **Status** — `shipped` (command + skill + specialist all live), `partial` (works via skill/specialist but has no dedicated command, or rides a sibling command), or `landing` (capability approved, command not yet merged; bead cited).

Sourcing follows `rules/common/no-fabrication.md`: command names trace to `lib/cli-commands.mjs`, skills to `.claude/commands/`, specialists to `specialists/registry.json`, and not-yet-shipped commands to their beads.

## Matrix

| Capability | CLI command | Skill | Specialist | Status & notes |
|---|---|---|---|---|
| **plan** | `construct workflow` (PRD/plan chains); planning itself is conversational, no dedicated `plan` command | `plan:feature` (also `plan:api`, `plan:requirements`, `plan:challenge`, `plan:decide`) | `cx-product-manager` (requirements), `cx-architect` (design/ADR), `cx-operations` (sequencing), `cx-devil-advocate` (challenge) | partial — planning is skill+specialist-driven through Construct; `construct workflow new\|invoke` instantiates plan/PRD chains, but there is no single `construct plan` command. |
| **build** | no dedicated command — implementation runs in-session through Construct | `build:feature` | `cx-engineer` (owns the verification protocol); `cx-architect` consulted when the approach is uncertain | partial — `build:feature.md` routes to `cx-engineer`; no `construct build`. `construct sandbox` provides an isolated env for dry-runs. |
| **fix** | no dedicated command — runs in-session | `build:fix` | `cx-debugger` (root-cause), then `cx-engineer` (smallest safe change) | partial — skill+specialist path; no `construct fix`. |
| **review** | `construct review` (telemetry-driven *agent-performance* review — distinct from code review) | `review:code` (also `review:quality`, `review:security`) | `cx-reviewer` (correctness/regression), `cx-security` (security scan), `cx-trace-reviewer` (fleet performance) | partial — code review is skill+specialist (`review:code` → `cx-reviewer`); the `construct review` command reports agent performance from telemetry, not a code diff. Two distinct meanings, kept separate to avoid conflation. |
| **test** | `construct ci` (local CI mirror runs the test jobs); no `construct test` command | `review:code` (coverage axis); testing knowledge in `cx-qa` / `cx-test-automation` skills | `cx-qa` (does the test test what matters), `cx-test-automation` (determinism/flakiness) | partial — testing is owned by `cx-qa` + `cx-test-automation`; `construct ci preview` runs the real test jobs locally. No standalone `construct test`. |
| **ship** | `construct status` (state), `construct doctor` (health gate), `construct ci` (pre-merge mirror); release itself is conversational | `ship:ready` (also `ship:release`, `ship:status`) | `cx-release-manager` (rollout/rollback/changelog) | partial — `ship:ready`/`ship:release` route to `cx-release-manager`; readiness signals come from `construct status`/`doctor`/`ci`. No single `construct ship`. |
| **document** | `construct docs check\|verify\|update`; `construct doc verify\|inspect` (auditability stamps); `construct export` (markdown → PDF/DOCX/HTML) | `remember:context`, `remember:handoff`, `remember:runbook`; `understand:docs` for lookup | `cx-docs-keeper` (decision record, freshness) | shipped — `construct docs` is the command surface; `cx-docs-keeper` owns the judgment; skills cover context/handoff/runbook capture. |
| **diagram** | `construct diagram` | (new; extends the `wireframe` capability — no shipped slash-command skill yet) | `cx-designer` (visual/interaction) / `cx-architect` (system diagrams) for the judgment | **shipped** — `lib/diagram.mjs`; D2 primary, Graphviz fallback; bead `construct-ij31.16`. |
| **demo** | `construct demo` | (new; no shipped slash-command skill yet) | `cx-release-manager` / `cx-docs-keeper` for demo-artifact ownership | **shipped** — shipped tapes in `templates/demos/tapes/` (project overrides `.cx/demos/tapes/`), VHS terminal + Playwright dashboard bridge; bead `construct-ij31.17`. |
| **publish** | `construct publish` | — | `cx-researcher` / `cx-docs-keeper` | **shipped** — orchestrates export + optional demos; `lib/publish.mjs`. |
| **research** | `construct ask` (one-shot KB query), `construct search` (hybrid search), `construct knowledge add` (persist a finding) | `understand:research` (also `understand:docs`, `understand:this`, `understand:why`) | `cx-researcher` (sources every claim with a primary reference + date) | shipped — `cx-researcher` owns the judgment; `construct ask`/`search`/`knowledge` are the command surface for querying and persisting findings. |
| **ingest** | `construct ingest` (doc → indexed markdown), `construct drop` (Downloads/Desktop), `construct distill` (query-focused chunking), `construct intake` (queue triage), `construct infer` (schema) | (no slash-command skill; driven by intake/ingest workflows) | `cx-data-engineer` (pipeline trust/idempotency), `cx-product-manager` (intake triage) | shipped — richest command surface (`ingest`/`drop`/`distill`/`intake`/`infer`); strategy-selected extraction per `lib/ingest/strategy.mjs` (adapter \| provider \| docling-remote). Scorecard follow-up: add a Node-native default fast path (see `tooling-scorecard.md`). |

## Coverage

Twelve capabilities mapped end-to-end: **plan · build · fix · review · test · ship · document · diagram · demo · publish · research · ingest.**

- **6 shipped** with a dedicated command surface: document, research, ingest, diagram, demo, publish.
- **6 partial** — skill + specialist path is live and routes through Construct, but there is no single dedicated `construct <verb>` command (the work happens in-session or rides sibling commands): plan, build, fix, review, test, ship.

## Agreement with the scorecard

This matrix and [`tooling-scorecard.md`](./tooling-scorecard.md) are consistent:

- **diagram**, **demo**, and **publish** implement the scorecard's visual/demo/publish verdicts; beads `construct-ij31.16`/`.17` closed.
- **ingest** carries the scorecard's one *soften* note (Node-native extraction default) as a follow-up, not a blocker.
- The remaining capabilities ride the scorecard's *keep* stack (custom CLI dispatcher, beads, telemetry, Pandoc/Typst export) with no tooling change implied.

## Caveats

- "Partial" is a statement about the **command surface**, not capability: build/fix/review/test/ship all work today through Construct + the named skill + specialist. They simply have no single-word `construct <verb>` entry point, by design — the orchestrator routes them.
- `construct review` (agent-performance telemetry) and the `review:code` skill (code review) share a word but are different capabilities; the matrix keeps them distinct.
- Specialist assignments name the role that owns the **judgment**. Construct (the orchestrator) selects and sequences specialists; per `rules/common/tool-invisibility.md`, `cx-*` ids never surface in user-facing deliverables.
