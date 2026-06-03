---
kind: research-finding
topic: "<short topic line>"
confidence: high | medium | low
sources: []
created: <ISO timestamp set by construct knowledge add>
expiresAt: <ISO timestamp, default created + 90d; shorten for fast-moving topics>
profile: <active profile id>
---

<!--
A lightweight but rigorous knowledge-store entry. Same evidence standard as a
research brief, condensed: observation separated from inference, every finding
cited, confidence tied to source grade, an explicit refresh trigger. See
rules/common/research.md.
-->

## SOURCES

| Title / Path | Class | Reliability | Credibility | Date | URL | Verified |
|---|---|---|---|---|---|---|
| {source} | primary / secondary / tertiary | A–F | 1–6 | {YYYY-MM-DD} | {url} | yes / no |

## FINDINGS

<!-- Observation only: what the source states. Each finding cites a source row above. -->

- <Finding 1 [source: …]>
- <Finding 2 [source: …]>

## INFERENCES

<!-- What is concluded beyond what any single source says. Labeled as inference, not fact. -->

- <Inference, with the findings it rests on>

## CONFIDENCE

<!-- high / medium / low, with the reasoning: tie it to the Admiralty grade of the sources (research.md §10). high only on A1/A2/B1. Name the strongest counter-evidence. -->

## GAPS

- <What could not be confirmed and would change the conclusion if known>

## RECOMMENDATION

- <Next action based on the evidence available, and the threshold that would change it>

## REFRESH

<!-- When this finding should be re-verified: the expiresAt date, or the event that would invalidate it (a new release, a superseding paper). -->
