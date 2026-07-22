# ADR-0086: "Embed" retires as product-facing vocabulary, survives as the internal daemon name

- **Date**: 2026-07-16
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.2` (ADR-B) — whether "embed" survives as Construct's product-facing name, per the 2026-07 continuous-work audit's `target-architecture.md` ADR roster (ADR B, "Owner: User")

## Problem

"Embed" currently names three overlapping things at once in the parts of Construct a user actually reads: a background daemon/scheduler process, a per-project opt-in reasoning feature ("embed capability"), and — under the same `construct embed` CLI verb — a product "mode" a cookbook page tells users to "start." The continuous-work audit's target architecture is introducing **Standing Assignment** (pending ADR-0085/ADR-A) as the canonical concept that unifies embed capabilities, `directives[]`, and `watch` triggers. Once that unification lands, does the word "embed" still belong on the user-facing surface, or does it retreat to being an internal implementation detail?

## Context

The truth matrix (`docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md`) grades the two most user-visible embed concepts differently:

- Row 1, **Embed daemon core**: `usable-with-limitations` — a real, running scheduler (`lib/embed/cli.mjs:597 runEmbedCli` → `lib/embed/daemon.mjs:445 EmbedDaemon`) that ticks 19 jobs, with a known crash-restart defect (row 4).
- Row 2, **Embed capability reasoning**: `opt-in-unproven` — `lib/embed/capability-jobs.mjs:196 runCapabilityTick` returns `skipped-with-reason(reasoning-executor-not-available)` on every tick unless a double opt-in (`CONSTRUCT_EMBED_REASONING_EXECUTOR=1` env var *and* config) is set. In practice this feature has essentially never produced a real proposal outside that opt-in path.

`target-architecture.md` frames the resolution directly: post-unification, "**Embed daemon is demoted from 'the product' to an internal scheduler host** — it becomes the process that ticks Standing Assignments due for evaluation, same role it already plays for its 19 built-in jobs, just with directives/capabilities/watch-triggers unified into one assignment type instead of three." The same document's "'Embed' as a name/boundary" note recommends: "it survives as the *internal* scheduler/daemon name... but the *product-facing* vocabulary becomes Standing Assignment / Run / Trigger — 'embed capability' and 'directive' both retire as user-facing terms once ADR-A lands."

This ADR is downstream of that recommendation but not bound by it — the bead marks it "Owner: User" specifically because it is a naming call with real migration cost, not an audit-decidable engineering fact.

**ADR-0085 status at time of writing**: `docs/decisions/adr/0085-canonical-continuous-work-model.md` does not exist yet (checked directly — file not found). A sibling agent is drafting it in parallel. This ADR proceeds on the audit's working assumption ("Standing Assignment" is the replacement concept) but its "what replaces the product-facing name" framing is explicitly contingent on ADR-0085's actual outcome — see Consequences.

### Live blast-radius verification

Independent of the audit's prose, direct repo inspection on `feat/wjap9-p1.2-graph-vocabulary@38576396`:

- `grep -rln "\bembed\b" bin/ lib/embed/ docs/guides/ --include="*.mjs" --include="*.md"` → **60 files**: all 39 modules under `lib/embed/` (`lib/embed/cli.mjs`, `daemon.mjs`, `capability-jobs.mjs`, `capability-lifecycle.mjs`, `supervision.mjs`, `presets/*.mjs`, `providers/*.mjs`, etc.), `bin/construct` (the CLI entry point, ~30 occurrences), and 20 files under `docs/guides/`.
- Repo-wide (excluding `node_modules/` and `docs/decisions/adr/`), `grep -rln "\bembed\b"` across `.mjs`/`.md`/`.json` → **304 files**. Of these, **87** are test files (`grep -rln "\bembed\b" tests/ --include="*.mjs"`) — the rename/touch surface if "embed" were purged as a string everywhere, not just from user-facing copy.
- `docs/` alone (`.md`+`.mdx`): **70 files** mention "embed."
- `CHANGELOG.md`: 74 case-insensitive mentions of "embed" across the project's release history.
- The `construct embed` CLI verb (`bin/construct:7844`, dispatching to `lib/embed/cli.mjs`) actually exposes **11 subcommands**, not the 7 the bead text names: `start`, `stop`, `status`, `snapshot`, `migrate-model` (daemon lifecycle) plus `list`, `enable`, `disable`, `dry-run` (capability lifecycle, `lib/embed/cli.mjs:659-662`) plus `supervise`, `unsupervise` (OS supervision, `lib/embed/cli.mjs:663,670`).
- `docs/guides/cookbook/start-embed-mode.md` is a full cookbook page — title "Start embed mode" — that walks a user through `construct embed start`, editing `embed.yaml`, `construct embed status`, `construct embed approvals`, `construct embed stop`. This is tutorial-grade product content, not internal documentation.
- Root `README.md:286` lists `| construct embed | Embed mode management |` in the top-level CLI reference table shipped to every user.
- `lib/embed/supervision.mjs:49-55` hardcodes `embed` as the OS-supervision service key: `launchdLabel: 'com.construct.embed'`, `systemdUnit: 'construct-embed.service'`, log file `embed-daemon.log`. These are real external identifiers (launchd plists, systemd unit files) — though per truth-matrix row 4 this supervision path is already `contradicted` (broken: the supervised command uses a `--foreground` flag that doesn't exist on `cmdEmbedStart`), so a rename does not add meaningfully to what's already non-functional here.
- No `.github/` workflow invokes `construct embed` directly (`grep -rn "construct embed" .github/` → no hits) — CI is not a blast-radius vector.
- `package.json` exports `.` and `./embedded-contract` → `lib/embedded-contract/index.mjs`. This is a **separate, established meaning** of the "embed" root — "embedded contract" is the API a host application uses to embed Construct as a library (`construct capability`, `construct execution` in `README.md:219,222`), not the daemon/capability concept this ADR addresses. It is out of scope for this decision, but its coexistence is itself evidence for the confusion cost below.

**Concrete ambiguity, not asserted in the abstract**: `docs/guides/reference/cli/advanced.md:166-184`, under the single heading `## construct embed` ("Embed mode management"), documents `start`/`stop` as daemon-lifecycle verbs ("Fork the detached embed daemon" / "Stop the running embed daemon") directly alongside `list`/`enable`/`disable` as capability-lifecycle verbs ("Available embed capabilities and per-project enabled state" / "Enable an embed capability"). A reader of that one section cannot tell from the shared word "embed" whether a given subcommand targets the background process or a per-capability config toggle. The same conflation shows up in runtime output: `lib/embed/cli.mjs:301` prints `"embed daemon already running (pid ...)"` while `lib/embed/cli.mjs:546` prints `"embed capability '<id>' enabled → ..."` — two different entities, same command family, same word. Root `README.md` compounds this further in one file: `embed daemon` (line 153), `embedded contract` (line 219), `embedded workflow` (line 222), `embedded LanceDB vector store` (line 101), and `embedding model cache` (line 354) are five distinct senses of the embed/embedded root within a single user-facing document.

## Decision

**Option 1 (recommended): "Embed" retires as product-facing vocabulary; it survives only as an internal daemon/module/process name.**

- The `construct embed ...` CLI verb family is renamed (or aliased with a deprecation path) to whatever terminology ADR-0085 ratifies for the unified concept — audit's working assumption is Standing Assignment / Run / Trigger (e.g., `construct assignment start|stop|status`, `construct run ...`).
- User-facing copy — cookbook pages, the CLI reference table, concept docs, CHANGELOG entries going forward — stops calling the feature "embed mode" or "embed capabilities." "Embed capability" and "directive" both retire as user-facing terms, matching `target-architecture.md`'s framing.
- Internal identifiers are **not** touched by this decision: the `lib/embed/` directory, its 39 module filenames, the `EmbedDaemon` class, the daemon process name, `embed-daemon.log`, the launchd label `com.construct.embed`, and the systemd unit `construct-embed.service` may keep "embed" as an internal/ops name — it is descriptive at that layer (it is, mechanically, still the thing that runs jobs and manages capability state) and renaming it buys nothing a user would ever see.
- `embedded-contract` (the host-embedding library API, `package.json` exports) is unaffected — it names a different, already-stable concept and is out of scope here.

Option 1 is the recommendation carried into Consequences; this ADR is **proposed**, not ratified — the Owner-User designation in the audit's ADR roster means a human makes the final call.

**Option 2 (rejected, see below): retire "embed" entirely, including internally.**

## Rationale

The measured blast radius favors Option 1 over Option 2 by a wide margin, and the confusion this ADR exists to fix is demonstrably a *product-surface* problem, not an internal-naming problem:

- The concrete ambiguity found (`advanced.md`'s single `## construct embed` section conflating daemon and capability lifecycles; the two CLI output strings in `cli.mjs` doing the same; five embed/embedded senses in one `README.md`) all live in **user-facing copy and CLI verb grouping** — exactly what Option 1 fixes.
- Nothing in the evidence suggests a user is confused by `lib/embed/daemon.mjs` being named `embed` internally — that confusion surface doesn't exist because users don't read module paths.
- Option 2's added cost — renaming 39 module files, the process name, the launchd/systemd identifiers, and touching a meaningful slice of the 87 test files that reference "embed" as a string — buys no additional clarity over Option 1 for the actual audience (users), only for future maintainers reading source, and even then the daemon's internal role ("the thing that ticks scheduled work") is not particularly better served by a different word.
- The one internal-facing edge case (`lib/embed/supervision.mjs` OS-integration identifiers) is already broken per truth-matrix row 4 (`contradicted` — the supervised command references a nonexistent `--foreground` flag), so neither option adds real regression risk there; whichever option is chosen, that fix is independent bounded work.
- Row 2's `opt-in-unproven` grade for "embed capability" reasoning means the specific vocabulary being retired (the word "capability" paired with "embed") has essentially never been exercised outside a double-opt-in flag — the user-facing cost of renaming it now, before wider adoption, is lower than it will be later.

## Rejected alternatives

- **Option 2 — retire "embed" everywhere, including `lib/embed/`, process names, and OS-supervision identifiers.** Rejected: the 39-module directory rename, process/launchd/systemd identifier changes, and touching a meaningful slice of 87 test files is real engineering cost with no user-facing benefit — the confusion this ADR addresses is entirely in product-facing copy and CLI grouping, not internal naming. Revisit only if a future audit finds *maintainers* (not users) are meaningfully confused by the internal name once the product-facing rename ships.
- **Keep "embed" as both the daemon name and the product-facing name (status quo).** Rejected: this is the state the audit already found produces concrete conflation (`advanced.md`'s single-section documentation of two different lifecycles under one word; the two differently-scoped `cli.mjs` output strings) — leaving it as-is does not resolve the problem this ADR was opened to answer.
- **Rename now, unconditionally, without waiting on ADR-0085.** Rejected: this ADR's "what replaces embed" framing (Standing Assignment / Run / Trigger) is the audit's working assumption, not a ratified fact — ADR-0085 was still unwritten at the time this ADR was drafted (see Context). Committing to specific replacement terminology before ADR-0085 resolves risks a second rename.

## Consequences

- Positive: resolves the concrete ambiguity found in `docs/guides/reference/cli/advanced.md` and `lib/embed/cli.mjs` between daemon-lifecycle and capability-lifecycle meanings of "embed"; aligns the product surface with the Standing Assignment unification `target-architecture.md` recommends; internal engineering cost stays bounded to CLI-verb and doc-copy changes rather than a directory-wide rename.
- Negative / cost: every current `construct embed start|stop|status|snapshot|migrate-model|list|enable|disable|dry-run|supervise|unsupervise` invocation is a breaking CLI surface change for anyone who has scripted against it — the actual count of such external users is `[unverified]` (no telemetry or issue-tracker evidence was reviewed for this ADR). `docs/guides/cookbook/start-embed-mode.md` needs a rewrite (title, all example commands), the CLI reference table entry in `README.md:286` and `docs/guides/reference/cli/advanced.md:166-184` need renaming, and `embed.yaml` as a config filename needs a decision (rename vs. alias) not made by this ADR.
- Dependency: this ADR is explicitly **downstream of ADR-0085's actual outcome**. If ADR-0085 does not land on "Standing Assignment" (or lands on a materially different refinement), this ADR's replacement-terminology framing — and any CLI/doc renaming done under Option 1 — needs revisiting before ratification proceeds to implementation.
- Blocks: `construct-4uxq0.10.8` (deciding the fate of unwired embed capability presets, `lib/embed/presets/*.mjs` — truth-matrix row 3, `test-only`) is blocked on this ADR, since whether those presets are product-facing "capabilities" worth wiring up at all depends on whether "capability" survives as user-facing vocabulary under Option 1's naming, or is retired entirely.
- Follow-up: this is a proposal only. No code, CLI, or doc changes are made by this ADR itself — implementation is separate bounded work gated on (a) this ADR's ratification and (b) ADR-0085 landing on concrete replacement terminology.

## Reversibility

Medium: this ADR authorizes no code changes on its own (status: proposed), so reversing the *decision* costs nothing today. Once Option 1 implementation lands — CLI verb rename, doc rewrites, possible `embed.yaml` rename — reversing it means a second rename pass across the same ~20 product-facing doc files and the CLI dispatch table; the internal `lib/embed/` module layer stays untouched throughout, so the daemon implementation itself is never at risk regardless of which way this is ratified or later reversed.

## References

- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md` rows 1–2 (embed daemon core `usable-with-limitations`; embed capability reasoning `opt-in-unproven`) and row 3 (deterministic capability presets, `test-only`)
- `docs/notes/research/2026-07-continuous-work-audit/target-architecture.md` (Standing Assignment mapping table; "Embed daemon is demoted from 'the product' to an internal scheduler host"; "'Embed' as a name/boundary" recommendation; ADR roster row B, "Owner: User")
- `lib/embed/cli.mjs` (11 `construct embed` subcommands, lines 652-670; daemon-vs-capability output strings, lines 301 and 546)
- `docs/guides/reference/cli/advanced.md:166-184` (`## construct embed` section conflating daemon and capability lifecycles)
- `docs/guides/cookbook/start-embed-mode.md` (product-facing tutorial content)
- `README.md:101,153,219,222,286,354` (five distinct embed/embedded senses in one file)
- `lib/embed/supervision.mjs:49-55` (OS-supervision identifiers) and truth-matrix row 4 (`contradicted` — supervision already broken independent of this ADR)
- `package.json` `exports` (`./embedded-contract` — the distinct, out-of-scope host-embedding API)
- `construct-4uxq0.4.2` (this ADR's bead) and `construct-4uxq0.10.8` (downstream, blocked bead)
- ADR-0085 (`docs/decisions/adr/0085-canonical-continuous-work-model.md`) — did not exist at time of writing; this ADR's replacement-terminology framing is contingent on its outcome
