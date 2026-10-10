# Skills

Portable skills for AI agents in the Agent Skills format: a `SKILL.md` per
skill, optionally with `references/`, `scripts/`, and `assets/` for long
templates, helpers, and examples. Beside it, `construct.skill.json` is
Construct's manifest (id, version, category, activation and stand-down
phrases, deliverable types), and `evals/` holds the labeled cases for when
the skill should load and how it should behave. A host that reads only
`SKILL.md` ignores both.

## What's here

Seven method skills cover a working lifecycle - intake → context → evidence
→ decision → specification → prose → challenge - and each also works alone:

- **intake** - a messy, multi-concern request becomes an execution plan
  without asking the requester to restate it.
- **context-mapping** - an unfamiliar system's entities, typed
  relationships, and unknowns are mapped before anyone acts inside it. The
  method only: persistence belongs to whatever memory store the host has.
- **investigative-research** - multi-source research whose conclusions have
  to survive a hostile reader.
- **decision-framing** - decisions that are expensive to revisit: options
  laid out, one recommendation, a decision record.
- **requirements-structuring** - an intent becomes a requirements artifact a
  stranger could build from and verify against.
- **written-voice** - one plain house voice for prose deliverables, with
  shapes for spec, proposal, status update, announcement, README, and more,
  and a tell checker (`scripts/voice-check.py`, which needs `python3`).
  Opt-in: install it by name when a piece of prose needs it.
- **adversarial-review** - a finished deliverable or decision is challenged
  before anyone commits to it, closing in one of four verdicts.

Method skills may ship a `references/` directory for record templates,
document shapes, and genre examples; `SKILL.md` keeps the method rules and
points at those files when needed.

Nine professional packs ship beside the method set. Each carries one
discipline's doctrine and obligations and reviews or writes that
discipline's deliverables:

- **experience-design** - a screen or flow reviewed for task success,
  accessibility, error states, consistency with the design system, and the
  evidence behind it.
- **governance-risk** - compliance, legal, and financial issues spotted
  with the governing text quoted, and the packet a qualified reviewer
  needs; never advice or sign-off.
- **operations-reliability** - operational readiness reviews and blameless
  postmortems: objectives, signals, on-call, runbooks, rollback, capacity.
- **product-management** - product reviews, requirements, and opportunity
  assessments: problem, users, outcome measure, scope, priority evidence,
  assumptions.
- **program-delivery** - delivery plans and status updates: conflicting
  claims, the critical path, risks with owners, decisions needed.
- **security-privacy** - defensive reviews naming exposures, the paths
  that reach them, and the checks that would stop them.
- **software-engineering** - implementation reviews and plans with
  evidence of correctness and a rollback path.
- **strategy-research** - strategy compared with the work and capacity
  behind it, and research that must survive a hostile reader.
- **system-architecture** - architecture reviews and decision records:
  boundaries, coupling, failure modes, reversibility.

[Skills and professional packs](../docs/skills-and-packs.md) explains how a
pack differs from a method skill, and [the catalog](../docs/catalog.md)
lists every shipped skill with its version.

An operational **`construct`** skill (host posture for Construct MCP /
coordination) is separate from these sets. `construct init` plants it in
the project skills directory each wired host reads (`.claude/skills`,
`.agents/skills`, or `.bob/skills`, one copy per directory), and
`--skills-dir` plants a personal copy as well. No other skill is planted
that way. Inside a Construct project, a workflow step names the skill it
binds (`publish-deliverable` binds written-voice, for example), the
`skills` tool lists and shows every skill to the host, and the project's
registry lock pins the versions resolved.

## Operating as…

The method skills are shared and role-free. Each professional pack carries
one discipline's doctrine and stands down on work another discipline owns
(what to build belongs to product, how to build it to engineering). These
views are only a reading guide for where to start; each role also has a pack
of its own: program-delivery, product-management, strategy-research, and
software-engineering or system-architecture for a builder:

| If you operate as | Start with | Then |
|---|---|---|
| a program/technical program manager | intake, context-mapping | decision-framing, written-voice (status updates), adversarial-review |
| a product manager | requirements-structuring, decision-framing | investigative-research (market claims), written-voice, adversarial-review |
| a researcher / analyst | investigative-research | written-voice (reports), adversarial-review (before publishing) |
| a builder in an unfamiliar system | context-mapping | requirements-structuring, adversarial-review (designs) |

## Working example

Copy `skills/investigative-research/` (at least `SKILL.md`; follow links
into `references/` when the skill says to) into any agent's skills
location, then ask a research question you need a defensible answer to.
The skill governs method from that point - sourcing, corroboration, how it
flags an unverified claim - without anything else installed.

## Install

Three ways to get a skill into your agent:

1. **Copy the folder.** Take the skill directory you want (including
   `references/` if present) and place it in your agent's skills location.
2. **Use the installer.** `npx skills add geraldmaron/construct` pulls
   skills from this repo via git - this runs Vercel's third-party `skills`
   installer, not this project's own tooling, at whatever version npx
   resolves as latest.
3. **Use the CLI.** `construct skill list` names what's shipped;
   `construct skill install <name>` copies it into a host
   skills directory as an exact copy; `construct skill verify` reports
   what's there and whether it matches; `construct skill remove <name>`
   removes it once you confirm. Name the destination by host with
   `--client=<claude|bob|opencode|cursor|codex|vscode>`, or give a path with
   `--dir`. The skills travel inside the npm package.
   `construct skill show <name>` prints one skill's description, version,
   and files; inside a project, `construct skill impact` reports how each
   skill version's steps did against their checks, and
   `construct skill update` brings the project's registry lock up to the
   skills and workflows present.

Each method skill is severable: no construct checkout is required for it to
run. That claim is checked with the naked-folder / naked-file discipline -
see `docs/internal/skill-runs/` for the recorded runs. `[unverified]` - the
exact procedure and its output are not reproduced here.

## Limits

- Each skill carries its own scope rules and is written to stand down when
  the task does not match. A skill firing on the wrong task is a defect in
  that skill.
- Portability proves a skill runs across harnesses; it does not prove
  judgment is good on every task (see Status).
- The audience these skills target has no formal training in the underlying
  disciplines. Guardrails are load-bearing where present.
- Coverage is narrow by design: the method lifecycle and the nine
  professional packs above, not a general-purpose skill library.

## Status

Early and actively developed. Method skills ship after a recorded real-work
run; the records are under `docs/internal/skill-runs/`. Every shipped skill
carries `evals/activation.json`, requests it should activate on and requests
it should stand down for, which the test suite validates; skills with
`evals/behavior.json` are checked against those cases too. In a project,
`construct skill impact` reports how each skill version's steps did against
their checks.
