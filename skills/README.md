# Skills

Portable method skills for AI agents: one self-contained `SKILL.md` file per skill, for anyone who wants expert-shaped method (intake, context, evidence, decision, specification, prose, challenge) without training in the underlying discipline.

## What's here

Seven skills ship, each a single Markdown file in the Agent Skills format, Apache-2.0 licensed. Together they cover a working lifecycle — intake → context → evidence → decision → specification → prose → challenge — and each also works entirely alone:

- **intake** — a messy, multi-concern request becomes an execution plan without asking the requester to restate it.
- **context-mapping** — an unfamiliar system's entities, typed relationships, and unknowns are mapped before anyone acts inside it. The method only: persistence belongs to whatever memory store the host has.
- **investigative-research** — multi-source research whose conclusions have to survive a hostile reader.
- **decision-framing** — decisions that are expensive to revisit: options laid out, one recommendation, a decision record.
- **requirements-structuring** — an intent becomes a requirements artifact a stranger could build from and verify against.
- **written-voice** — one plain house voice for prose deliverables, with shapes for spec, proposal, status update, announcement, and README.
- **adversarial-review** — a finished deliverable or decision is challenged before anyone commits to it, closing in one of four verdicts.

More skills are planned. None are listed here until they ship.

## Operating as…

The skills are shared and role-free — nobody owns a deliverable type. These views are only a reading guide for where to start:

| If you operate as | Start with | Then |
|---|---|---|
| a program/technical program manager | intake, context-mapping | decision-framing, written-voice (status updates), adversarial-review |
| a product manager | requirements-structuring, decision-framing | investigative-research (market claims), written-voice, adversarial-review |
| a researcher / analyst | investigative-research | written-voice (reports), adversarial-review (before publishing) |
| a builder in an unfamiliar system | context-mapping | requirements-structuring, adversarial-review (designs) |

## Working example

Copy `skills/investigative-research/SKILL.md` and paste its contents into any agent's system prompt or skill-loading mechanism, then ask it a research question you need a defensible answer to. The skill governs the agent's method from that point — sourcing, corroboration, how it flags an unverified claim — without anything else installed.

## Install

Three ways to get a skill into your agent:

1. **Copy the file.** Take the single `SKILL.md` for the skill you want and paste it into your agent's skills location. No dependency on this repository once it's copied — the skill has to work as a standalone file.
2. **Use the installer.** `npx skills add geraldmaron/construct` pulls skills from this repo via git.
3. **Use the CLI, from a construct checkout.** `construct skills list` names what's shipped; `construct skills install <name>` (or `--all`) copies it into a host skills directory as an exact, byte-for-byte copy (default `~/.claude/skills`, override with `--dir`); `construct skills installed` reports what's there and whether it matches; `construct skills uninstall <name>` removes it. A published (non-git) install carries no skill files and says so, naming the installer above.

Each skill is self-contained: no other file in this repository, and no checkout of it, is required for the skill to run. That claim is checked per skill with what this project calls the naked-file test — the file is pasted into an agent with no repository present and run for real. `[unverified]` — the exact naked-file test procedure and its output are not reproduced here; see the repository's `docs/` directory for the use ledger and recorded runs.

## Limits

- Each skill carries its own scope rules and is written to stand down — do nothing, or defer to a more specific skill — when the task in front of it doesn't match. A skill firing on the wrong task is a defect in that skill, not expected behavior.
- The naked-file test proves a skill runs standalone across agent harnesses and model families. It does not prove the skill's judgment is good on every task; that's a separate, ongoing check (see Status).
- The audience this project is built for has no formal training in the disciplines these skills encode (the lifecycle named above: intake, context, evidence, decision, specification, prose, challenge). The guardrails in each skill exist because of that — they are load-bearing, not optional ceremony, and removing them changes what the skill is safe to hand to.
- Coverage is narrow by design: the working lifecycle above, not a general-purpose skill library. A need outside intake, context, evidence, decision, specification, prose, or challenge has nothing here yet.

## Status

Early and actively developed. All seven ship only after a recorded real-work run, not on completed drafting alone; each carries at least one. The use ledger names the falsification test this claim is held to and records, run by run, whether a gate changed the outcome: `docs/skill-use-ledger.md`, with full records under `docs/skill-runs/`.
