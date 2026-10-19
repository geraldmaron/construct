# HANDOFF — construct

Baton between Claude Code and Codex. Read at session start; update at session end.
Roles and rules: see `COORDINATION.md`. One writer at a time; overwrite, don't log.

**Control holder:** none after this session.
**Mode:** A (Claude leads; Codex takes bounded slices and independent review on its default model, never gpt-6-astra).

## What was done
- Evals are maintainer-local: the skill evals, the intake corpus and live record, and the live-run
  harness live in an ignored `evals/` folder with its own local git history, and are stripped from
  this repository's history. Skills no longer ship or plant them (RESEARCH-DECISIONS 17).
- Clean state (RESEARCH-DECISIONS 18): no compatibility code for earlier releases. State format 6
  (`construct migrate` upgrades a format-5 store only), the Beads id map and workflow id aliases are
  gone, the native reviewer keeps only its app-server profile, and the release gate pins no model.
- Changes learned from Hermes Agent: entry tools load upfront on hosts that defer MCP tools,
  outside text carries injection flags, the skills tool reads one file of a skill, Hermes gets a
  120-second tool timeout, and the grounding hook runs on MCP tools only.

## Current state
- Gate on the cleanup branch: lint, typecheck, npm test, smoke, conformance (static) all pass.
- A format-5 project store (this checkout's own) must run `construct migrate` once every
  Construct session on it is stopped; the command backs the file up first.

## Next step
1. Ledger: `construct work ready` for the remaining Hermes-derived items under work-59ca8350.
2. Haiku rarely engages Construct for work under tool search even when the entry tools are loaded
   (measured 2026-10-19); the lever is the model's judgment to engage, not discovery.

## Open questions
- Whether to re-qualify the native semantic reviewer on Codex's current default model.

## Files owned / in-flight
- None.
