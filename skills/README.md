# Skills

Portable method skills for AI agents in the Agent Skills format: a
`SKILL.md` per skill, optionally with `references/` (and other progressive-
disclosure companions) for long templates and examples.

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
  shapes for spec, proposal, status update, announcement, README, and more.
  Opt-in: install it by name when a piece of prose needs it.
- **adversarial-review** - a finished deliverable or decision is challenged
  before anyone commits to it, closing in one of four verdicts.

Method skills may ship a `references/` directory for record templates,
document shapes, and genre examples; `SKILL.md` keeps the method rules and
points at those files when needed.

An operational **`construct`** skill (host posture for Construct MCP /
coordination) is separate from this method set. When present in the package,
`construct init` auto-installs it; method skills never auto-install that way.

More skills are planned. None are listed here until they ship.

## Operating as…

The skills are shared and role-free - nobody owns a deliverable type. These
views are only a reading guide for where to start:

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
   `--client=<claude|bob|opencode|cursor|codex>`, or give a path with
   `--dir`. The skills travel inside the npm package.

Each method skill is severable: no construct checkout is required for it to
run. That claim is checked with the naked-folder / naked-file discipline  - 
see `docs/` for the use ledger and recorded runs. `[unverified]` - the
exact procedure and its output are not reproduced here.

## Limits

- Each skill carries its own scope rules and is written to stand down when
  the task does not match. A skill firing on the wrong task is a defect in
  that skill.
- Portability proves a skill runs across harnesses; it does not prove
  judgment is good on every task (see Status).
- The audience these skills target has no formal training in the underlying
  disciplines. Guardrails are load-bearing where present.
- Coverage is narrow by design: the lifecycle above, not a general-purpose
  skill library.

## Status

Early and actively developed. Method skills ship after a recorded real-work
run; the use ledger names the falsification test and records whether a gate
changed the outcome: `docs/internal/skill-use-ledger.md`, with full records
under `docs/internal/skill-runs/`.
