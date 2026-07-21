---
name: docs-evidence-ingest-workflow
description: "Use when: the user pastes customer notes, Slack threads, support tickets, sales notes, research snippets, RFCs, analytics summaries, or competitor signals."
inputs: [signal, document]
artifactType: evidence-brief
verificationBar: "Observed behavior weighted over self-report; sample size stated; no invented quotes; every load-bearing claim cites a verifiable source."
---
# Evidence Ingest Workflow

Use when: the user pastes customer notes, Slack threads, support tickets, sales notes, research snippets, RFCs, analytics summaries, or competitor signals.

Follow [rules/common/research.md](../../rules/common/research.md) for source metadata, evidence handling, and confidence labeling.

## Steps

1. Identify the source type and date.
2. Extract source metadata: customer, actor, product area, channel, linked issue, and confidence.
3. Save raw or lightly normalized source material under `.construct/knowledge/internal/sources/`.
4. If customer-specific, update or create `.construct/knowledge/internal/customer-profiles/{customer}.md` using `get_template("customer-profile")`.
5. Create `.construct/knowledge/internal/evidence-briefs/{date}-{slug}.md` using `get_template("evidence-brief")` when the evidence supports a product decision.
6. If evidence is weak but worth preserving, create a signal brief with `get_template("signal-brief")`.

## Rules

Do not invent customer quotes, names, or issue links. Preserve ambiguity. If source evidence contains personal data, record only the minimum needed for product decisions.

Always preserve:

- source path or source system
- source date or access date
- whether the source is direct evidence or secondhand summary
- what is observed directly vs inferred by the author

## Storage

Files in `.construct/knowledge/` are indexed by Construct's hybrid retrieval path. The vector layer makes them semantically retrievable for future PRDs and Meta PRDs.
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
