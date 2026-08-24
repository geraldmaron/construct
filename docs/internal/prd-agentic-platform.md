# PRD: Construct as an agentic platform

```
Status: draft
Author: Claude Fable (drafting session) — Contributors: Claude Sonnet
  (validation runs the cited records come from), Gerald (requirements, decider)
Created: 2026-08-21 — Last updated: 2026-08-21
Tags: prd, platform, requirements, skills, kernel, provenance
```

**Outcome:** An operator states an outcome in plain words and receives a
finished, traceable deliverable: the platform routes the concerns that
outcome touches, runs the work through whatever agent host is present,
carries the house method with it as portable skills, and leaves behind a
record — who did what, under which obligation, checked by which gate — that
a stranger could audit without the conversation that produced it.

## Users

Three, with different stakes:

1. **The operator (Gerald).** States outcomes, decides at the inbox,
   accepts or rejects deliverables. What changes: less restating, less
   re-explaining method to every session, and a record he can trust without
   re-deriving it.
2. **Fresh agent sessions, any host.** The platform's real workforce. What
   changes: a session arrives to find the method (skills), the context (the
   kernel's map and log), and the obligations already present, instead of
   inheriting a blank window.
3. **The occasional external reader.** Receives a skill file or a finished
   deliverable, holds none of the context. What changes: the artifact
   carries its own verification record, so trust does not require trusting
   the sender's process on faith.

## Context

The platform is three layers that degrade gracefully — each works without
the ones below it:

```
  skills/        the method, severable, works pasted anywhere
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  src/cli        the spine: outcome → work → log → inbox → verdict
  src/kernel     coverage, obligation, provenance; append-only log
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  src/hosts      adapters: OpenCode, Claude Code, Codex, Cursor (pinned)
  construct serve   the same store over MCP: presence, not execution
```

(Sketch deliberately rough: this is a draft's diagram, per the house
presentation rule; a polished one belongs to a released artifact.)

## Decided

Standing decisions this PRD builds on, not reopened here:

- Skills are severable, one file each, naked-file tested; the kernel is
  optional backbone (Phase 5 direction, recorded 2026-08-20).
- Skills stay out of the npm tarball; distribution is copy-paste and the
  git installer (decided and accepted 2026-08-21, decision record in
  `skill-runs/2026-08-20-decision-framing-run-2.md`).
- No runtime of its own, ever: hosts execute, construct routes and records
  (standing commitment 1).
- Roles are views and routing, never personas; deliverable skills stay
  flat (recorded 2026-08-21, on the skill-library epic).

## Outcomes

1. An outcome stated in plain words produces queued work with the
   implicated concerns named and evidenced.
2. Any of the four wired hosts can execute that work, with unturned model
   families labeled best-effort on the log, never refused.
3. Every deliverable ends with the verification record its governing skill
   mandates; composed deliverables carry one collapsed record.
4. The work log answers "who did what, in whose name, under which
   obligation" for any past run, append-only, without exceptions.
5. A skill invoked anywhere — inside the platform or pasted into a foreign
   host — behaves identically; presence of the kernel adds provenance,
   never behavior.
6. The suite's validity claim stays measured: the use ledger accrues rows
   with pre-registered refutation thresholds per skill.

## Success measures

Each an observation, thresholds labeled for what they are:

- **Ledger throughput:** new ledger rows per month of real use, visible at
  session boundaries via the reconciliation ritual. No numeric floor is
  claimed as science; a month at zero is the recorded stall signal (chosen
  line, chosen by the operator in the platform strategy's pre-mortem).
- **Refutation status:** per skill, rows toward its ten-use test with
  gate-changed count. The instrument's honesty check: honest-no rows exist
  and are recorded, not suppressed (`docs/internal/skill-use-ledger.md`).
- **Cross-tier floor:** every shipped skill holds a recorded Sonnet-class
  run with its record intact: seven of seven.
- **Doctor completeness:** `construct doctor` reports presence, version
  against pin, and auth state for all four hosts, and fails loudly rather
  than guessing.
- **Audit answerability:** for a sampled past run, the log yields actor,
  authority, and obligations without reading any chat transcript (checked
  manually 2026-08-21; a chosen bar, not a measured standard).

## Constraints

- Zero runtime dependencies in the kernel; storage is built-in
  `node:sqlite`; the work log's append-only property is enforced by DB
  triggers, not caller discipline (source: architecture, standing).
- Only `src/kernel/paths.ts` reads the environment; everything else takes an
  injected `Paths` (source: architecture, standing).
- Skills conform to the six-field Agent Skills frontmatter, under 500
  lines, no host tool names, no repo paths (source: AUTHORING.md, linted).
- Legal and compliance output remains dogfood-only until the tracked
  attorney review passes (source: risk register, standing).
- No cross-user capability claims; evidence is the operator's own ledger
  (source: Phase 5, standing).
- One tuned model family; every other family runs labeled best-effort with
  a degradation note (source: model matrix, standing).

## Assumptions

- `[assumed]` The platform strategy's proposed direction (method-first,
  provenance hedge) will be accepted. Settled by: the decider's verdict on
  `docs/internal/agentic-platform-strategy.md`. If rejected, this PRD's outcome 6
  survives but the provenance emphasis in outcome 4's roadmap weight moves.
- `[assumed]` The Agent Skills format remains readable across the major
  hosts at least in its current form. Settled by: the format's governance
  moving to a foundation (a recorded revisit trigger) or a breaking spec
  change. If wrong, the copy-paste floor still works; the installer path
  may not.
- `[assumed]` Solo-operator usage generates enough ledger rows to resolve
  the falsification tests within their four-week windows. Settled by: the
  monthly stall signal above. If wrong, the failure is triggering or
  distribution, not method — the tests' own second refutation clause.

## Non-goals

- **No agent runtime.** Hosts execute; this platform never does. The
  commoditization evidence says this ground is where value is leaving.
- **No skills registry or marketplace.** Git-as-registry and copy-paste
  are the distribution; a registry is a curation liability (recorded,
  Phase 5).
- **No enterprise governance product this cycle.** The provenance surface
  is a documented standing option, not a SKU; the strategy records why,
  and the narrower peer-tool variant is a noted choice, not a blind spot.
- **No role packs.** Deliverable skills stay flat; roles are README views
  and kernel routing (recorded, epic catalog v3).
- **No live-sync of installed skills.** Copies are byte-identical and
  point-in-time; auto-sync contradicts the byte-identical constraint (from
  the projection spec's non-goals,
  `skill-runs/2026-08-21-requirements-structuring-run-1.md`).

## Acceptance criteria

1. `construct outcome "<plain words>"` on a fresh install queues work
   naming at least one implicated concern with its evidence cited, and
   `construct log` shows the inference event, on all four wired hosts.
2. A skill file copied from `skills/` into a host with no construct
   checkout produces its deliverable with the verification record intact
   (the naked-file test, re-runnable per skill).
3. A deliverable governed by two or more skills ends with exactly one
   record block: the owner's in full, one line per contributing skill.
4. Attempting to update or delete a work-log row fails at the database
   layer, regardless of caller.
5. `construct doctor` on a machine missing a host reports that host as
   absent with its remediation, exit code nonzero only for broken state,
   and never modifies anything.
6. For any closed skill bead, `docs/internal/skill-use-ledger.md` holds at least
   one row naming its recorded run file, and that file exists and carries
   the verbatim deliverable.
7. The skills lint rejects, with named reasons: a seventh frontmatter
   field, a repo path, a bead id, a missing stand-down rule, a missing
   record shape, or a 501st line.
8. `construct serve` exposes read and decide surfaces over MCP and
   refuses dispatch: an MCP client attempting to advance a deliverable
   receives a refusal naming the presence-not-execution rule.

## Priorities

- **Critical path:** outcomes 1, 3, 4 (route, record, collapse) and the
  ledger instrument (outcome 6). The platform is these or it is a demo.
- **Now:** the provenance-surface documentation pass (the strategy's hedge,
  if accepted). The skills projection subcommand listed here previously has
  shipped: `construct skills list|install|installed|uninstall`, resolved per
  Open questions below.
- **Next:** the flat deliverable-skill layer, demand-pulled; research
  synthesis when its trigger fires.
- **Later:** second tuned family (per-skill, when a promotion decision
  needs the number); public release gates (attorney review holds legal
  and compliance dogfood-only until passed).

## Risks

- **An incumbent bundles work-product audit into enterprise pricing**,
  closing the provenance window before the hedge matters. Deferred to
  adversarial review: reviewed 2026-08-21 in the strategy's run; controls
  adopted there (machine-discoverable pointer, measurable revisit
  triggers, checking cadence).
- **The ledger stalls.** The operator's bandwidth is the instrument's only
  input; a quiet month leaves every test unresolved and the platform's
  validity claim frozen. Failure story: six months of shipped-but-unproven
  skills reading as shelfware. Watched by the monthly stall signal at
  reconciliation.
- **Composition rot.** New skills could reintroduce stacked records or
  coupled dependencies. Watched by the lint's shape checks and the
  AUTHORING composition rule; a violation that reaches a deliverable is a
  bug against acceptance criterion 3.
- **Format capture.** The Agent Skills format could move under governance
  hostile to severability. Failure story: the installer path breaks and
  copy-paste becomes the only distribution. The floor survives by design;
  the reach does not. Deferred to adversarial review at the trigger.

## Open questions

Both open questions the verification record below reports (`Questions
earned`) are answered: installed-skill state is disk-inferred, no manifest
(`construct skills installed` reads the target directory directly), and
install takes both explicit names and an `--all` flag (`construct skills
install --all [--dir=<dir>]`). Default host directory is `~/.claude/skills`,
override with `--dir`, or name a documented host directory with
`--host=<claude|bob|opencode|cursor|codex>`.

---

```
Verification record (composed — requirements-structuring owns this deliverable)
- Separated:         answered — see Decided/Outcomes/Constraints/Assumptions:
                     outcomes 6, constraints 6, assumptions 3 ("the platform
                     strategy's proposed direction will be accepted"), decided 4
- Checkable:         answered — all 8 acceptance criteria are observations
                     ("fails at the database layer", "exactly one record block");
                     thresholds labeled chosen, none invented ("no numeric floor
                     is claimed as science")
- Non-goals stated:  answered — see Non-goals, 5 entries with reasons ("a
                     registry is a curation liability")
- Questions earned:  answered — 2 open, both reserved by the decider ("manifest
                     file or disk inference"), neither settleable here
- Priorities honest: answered — see Priorities; critical path holds 4 of 12
                     tracked items ("the platform is these or it is a demo")
- Decision surfaced: answered — the strategy's proposed-not-accepted status is
                     carried as the first assumption, not specified around
- written-voice:     one line — presentation layer applied: mixed shapes, headed
                     chunks, sketch diagram labeled draft, banned tics absent
- decision-framing:  one line — no new decision framed; standing decisions cited,
                     one proposed decision carried as [assumed]
- investigative-research: one line — landscape claims inherited from recorded
                     runs 3-5 with their marks, none re-asserted stronger
```
