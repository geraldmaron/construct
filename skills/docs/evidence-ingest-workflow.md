<!--
skills/docs/evidence-ingest-workflow.md — Normalize raw product evidence into Construct product-intel artifacts.
-->
# Evidence Ingest Workflow

Use when: the user pastes customer notes, Slack threads, support tickets, sales notes, research snippets, RFCs, analytics summaries, or competitor signals.

Follow [rules/common/research.md](../../rules/common/research.md) for source metadata, evidence handling, and confidence labeling.

## Steps

1. Identify the source type and date.
2. Extract source metadata: customer, actor, product area, channel, linked issue, and confidence.
3. Save raw or lightly normalized source material under `.cx/product-intel/sources/`.
4. If customer-specific, update or create `.cx/product-intel/customer-profiles/{customer}.md` using `get_template("customer-profile")`.
5. Create `.cx/product-intel/evidence-briefs/{date}-{slug}.md` using `get_template("evidence-brief")` when the evidence supports a product decision.
6. If evidence is weak but worth preserving, create a signal brief with `get_template("signal-brief")`.

## Rules

Do not invent customer quotes, names, or issue links. Preserve ambiguity. If source evidence contains personal data, record only the minimum needed for product decisions.

Always preserve:

- source path or source system
- source date or access date
- whether the source is direct evidence or secondhand summary
- what is observed directly vs inferred by the author

## Storage

Files in `.cx/product-intel/` are indexed by Construct's hybrid retrieval path. Postgres stores them as `product-intel` documents during sync, and the vector layer makes them semantically retrievable for future PRDs and Meta PRDs.
