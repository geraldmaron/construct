---
title: Track research findings
description: Capture a research note with sources, claims, and confidence — then promote it into the knowledge base so the next session can find it.
---

Research findings live in three states: as a fresh note in the cookbook intake, as a stamped artifact in `.construct/knowledge/external/research/`, and as a citable source threaded through PRDs and ADRs. Live procedures are listed in `registry/procedures/*.json` — discover them with `construct procedure list`.

## Capture as you go

Drop a research note into the inbox; the intake daemon classifies it and routes it through the `researcher` Worker Profile chain:

```bash
construct drop ./notes/2026-06-10-otel-genai-survey.md
construct intake list
construct intake show <id>
```

For a focused capture without the inbox queue:

```bash
construct knowledge add \
  --source=research \
  --slug=otel-genai-conventions-2026-q2 \
  --topic="OpenTelemetry GenAI semantic conventions adoption survey" \
  --confidence=primary \
  --source-url=https://opentelemetry.io/docs/specs/semconv/gen-ai/ \
  --source-url=https://github.com/open-telemetry/semantic-conventions/releases
```

This writes a frontmatter-stamped file under `.construct/knowledge/external/research/<slug>.md` and registers it in the RAG corpus.

## What gets stamped

Every research artifact carries:

- `cx_doc_id` — UUID for cross-reference and chain-integrity audit
- `topic`, `slug`, `confidence` (primary / secondary / inferred / unverified)
- `sources[]` — every URL or internal reference with a class tag
- `intake_id` if it came through the inbox; `intake: none` otherwise

The `architect` contract requires ADRs to cite the primary sources a research artifact provided; the doctor surfaces any uncited claims in `construct docs:verify`.

## Synthesize or promote

For multi-source synthesis, get an orchestration plan:

```bash
construct procedure invoke --json --procedure-id research-synthesis \
  --text 'Synthesize otel-genai-conventions-2026-q2 findings for a PRD decision'
```

To move from research toward product specs, request a PRD drafting plan:

```bash
construct procedure invoke --json --procedure-id prd-draft \
  --text 'feature_name="otel-genai-tracing"'
```

**`construct procedure invoke` returns a plan only** — it does not scaffold PRDs, ADRs, or handoffs. Run the Worker Profiles the plan returns; cite the research slug in each artifact's sources block. `reviewer` verifies the citation chain.

## Find it later

```bash
construct search "otel genai conventions"
construct knowledge trends --topic=research
```

Search hits return the stamped artifact with its confidence + source class so the reader can decide whether to trust it or chase the primary.

## Pair with

- [Generate artifacts](/guides/cookbook/generate-artifacts) — to turn the research into a PRD/ADR/RFC.
- [Query the knowledge base](/guides/cookbook/query-the-knowledge-base) — to find prior research before adding a new note.
