<!--
skills/docs/strategy-workflow.md: Read, update, and reason about the product strategy.
Canonical store: ~/.cx/strategy.md (user-global) or .cx/strategy.md (project-local, committed).
Template: templates/docs/strategy.md.
-->
# Strategy Workflow

Use when: the user asks about product direction, strategic bets, what to prioritize, whether a signal aligns with strategy, or wants to update the strategy.

## Reading Strategy

1. Read `~/.cx/strategy.md` (or project-local `.cx/strategy.md`).
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
4. If a Bet is being added, check for conflicting Non-bets and surface them.
5. Strategy changes are always approved by the user before writing.

## Storage

| Scope | Path | Committed? |
|---|---|---|
| User-global | `~/.cx/strategy.md` | No: local only |
| Project-local | `.cx/strategy.md` | Yes: source of truth for this repo |
