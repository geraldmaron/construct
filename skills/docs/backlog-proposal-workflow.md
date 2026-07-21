---
name: docs-backlog-proposal-workflow
description: "Use when: product evidence should create or update Jira, Linear, GitHub Issues, or another tracker."
inputs: [evidence-brief, prd, signal]
artifactType: backlog-proposal
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
---
# Backlog Proposal Workflow

Use when: product evidence should create or update Jira, Linear, GitHub Issues, or another tracker.

## Steps

1. Load source evidence, evidence brief, PRD, or signal brief.
2. Search existing tracker context if an MCP is configured; otherwise search local docs and knowledge artifacts.
3. Create `.construct/knowledge/internal/backlog-proposals/{date}-{slug}.md` with `get_template("backlog-proposal")`.
4. Include duplicate/conflict analysis and exact proposed writes.
5. Return `NEEDS_MAIN_INPUT` for approval before any external write.
6. After approval, apply changes and update the proposal's application log.

## Rules

Never write externally from weak evidence without making the risk explicit. Never create duplicate issues when an existing issue can be updated.
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
