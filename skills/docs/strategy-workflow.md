---
name: docs-strategy-workflow
description: "Use when: the user asks about product direction, strategic bets, what to prioritize, whether a signal aligns with strategy, or wants to update the strategy."
inputs: [signal, decision-context]
artifactType: strategy
verificationBar: "Vision→Bets(with kill criteria)→Non-bets→Metrics→Competitive Positioning→Risks; baselines/targets may be unknown but never fabricated."
triggers: ["strategy", "bets", "non-bets"]
---
# Strategy Workflow

Use when: the user asks about product direction, strategic bets, what to prioritize, whether a signal aligns with strategy, or wants to update the strategy.

## Native spine (blocking)

Vision → Bets → Non-bets → Time Horizon → North Star Metric → Metrics → Milestones → Competitive Positioning → Risks → Open Bets → References.

- Every Bet needs Why + Leading indicator + **Kill criterion**.
- `construct artifact validate --type=strategy` runs `lintStrategyDeliveryDepth`.

## Reading Strategy

1. Read `~/.construct/strategy.md` (or project-local `.construct/strategy.md`).
2. If the file does not exist, inform the user and offer to create it using `templates/docs/strategy.md`.
3. Parse sections: Vision, Bets, Non-bets, Time Horizon, North Star Metric, Competitive Positioning.

## Checking Signal Alignment

Given a product signal or PRD, check:
- Does the signal target a declared Bet? → flag as strategically aligned.
- Does the signal conflict with a Non-bet? → flag the conflict; the user must make an explicit override decision.
- Does the signal address the Time Horizon goal? → note this in the signal brief.

## Updating Strategy

1. Show the user the current section being updated.
2. Propose the change with rationale.
3. Write the updated section and increment the `updated` date.
4. If a Bet is being added, check for conflicting Non-bets and surface them; refuse bets without kill criteria.
5. Strategy changes are always approved by the user before writing.

## Storage

| Scope | Path | Committed? |
|---|---|---|
| User-global | `~/.construct/strategy.md` | No: local only |
| Project-local | `.construct/strategy.md` | Yes: source of truth for this repo |
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
