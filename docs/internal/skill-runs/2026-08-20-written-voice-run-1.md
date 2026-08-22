# written-voice — recorded run 1 (2026-08-20, Sonnet tier)

Run conditions, stated so the record is checkable: this was the skill's
naked-file test, its first dogfood run, and its cross-tier floor test in
one. The producing agent ran on Sonnet — one capability tier below the model
that authored the skill — was given a copy of `SKILL.md` outside the
repository as its only method reference, explicit instruction not to read
this repository, and no web access; the requester's paragraph of facts was
its only source. The task was real: the README for this repository's
`skills/` directory, a document the repo needed and did not have. The
deliverable below is verbatim as produced; nothing was edited.

The one-line verdict for the use ledger: the claims discipline visibly
shaped the output on the lower tier — the load-bearing portability claim
(the naked-file test) shipped marked `[unverified]` rather than asserted,
the record states that the requester's facts were not independently
re-verified, and the planned-but-unshipped skills were kept out per the
requester's constraint. The README shape held in full, the hype sweep came
back clean, and the verification record was placed beside the deliverable
exactly as the skill allows for shipped documents.

One defect for the adoption record, found on review and left uncorrected
below because run records are verbatim: the deliverable links the phrase
"Agent Skills" to this repository rather than to the format's own
documentation — a fabricated-by-plausibility link of exactly the kind the
skill's citation rules do not currently name, because the skill's marker
discipline covers claims, not hyperlink targets. Adopted copies fix the
link; noted here as possible future skill-hardening material.

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading).

---

# Skills

Portable method skills for AI agents: one self-contained `SKILL.md` file per skill, for anyone who wants expert-shaped method (research, decisions, writing) without training in the underlying discipline.

## What's here

Three skills ship today, each a single Markdown file in the [Agent Skills](https://github.com/geraldmaron/construct) format, Apache-2.0 licensed:

- **investigative-research** — multi-source research whose conclusions have to survive a hostile reader.
- **decision-framing** — decisions that are expensive to revisit: options laid out, one recommendation, a decision record.
- **written-voice** — one plain house voice for prose deliverables, with shapes for spec, proposal, status update, announcement, and README.

More skills are planned. None are listed here until they ship.

## Working example

Copy `skills/investigative-research/SKILL.md` and paste its contents into any agent's system prompt or skill-loading mechanism, then ask it a research question you need a defensible answer to. The skill governs the agent's method from that point — sourcing, corroboration, how it flags an unverified claim — without anything else installed.

## Install

Two ways to get a skill into your agent:

1. **Copy the file.** Take the single `SKILL.md` for the skill you want and paste it into your agent's skills location. No dependency on this repository once it's copied — the skill has to work as a standalone file.
2. **Use the installer.** `npx skills add geraldmaron/construct` pulls skills from this repo via git.

Each skill is self-contained: no other file in this repository, and no checkout of it, is required for the skill to run. That claim is checked per skill with what this project calls the naked-file test — the file is pasted into an agent with no repository present and run for real. `[unverified]` — the exact naked-file test procedure and its output are not reproduced here; see the repository's `docs/` directory for the use ledger and recorded runs.

## Limits

- Each skill carries its own scope rules and is written to stand down — do nothing, or defer to a more specific skill — when the task in front of it doesn't match. A skill firing on the wrong task is a defect in that skill, not expected behavior.
- The naked-file test proves a skill runs standalone across agent harnesses and model families. It does not prove the skill's judgment is good on every task; that's a separate, ongoing check (see Status).
- The audience this project is built for has no formal training in research method, decision analysis, or professional writing. The guardrails in each skill exist because of that — they are load-bearing, not optional ceremony, and removing them changes what the skill is safe to hand to.
- Coverage is narrow by design: three method areas, not a general-purpose skill library. A need outside research, decisions, or writing has nothing here yet.

## Status

Early and actively developed. Three skills shipped as of this writing. A skill ships only after recorded use on real work, not on completed drafting — the use ledger and the recorded runs behind each shipped skill live in this repository's `docs/` directory.

---

Verification record
- Reader named:      answered — a stranger browsing `skills/` on GitHub, deciding whether and how to use a skill
- Decision on top:   answered — first sentence states what the directory is and who it's for
- Hype swept:        answered — clean
- Claims honest:     answered — marked: 1 [unverified] (naked-file test procedure/output, not reproduced here — see repository docs/); all other statements taken directly from the repository owner's own description of the repo, not independently re-verified in this session (no repository or web access available)
- Shape held:        answered — README | dropped: none
- One recommendation: answered — not applicable: nothing recommended (informational README, no choice being made)
