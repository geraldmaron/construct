# Research Brief: {title}

Optional publish frontmatter (for `construct publish --strict`):

```yaml
publish:
  demo: my-tape-name
  dashboardDemo: cockpit-cloud
```

- **Date**: {YYYY-MM-DD}
- **Author**: {name}
- **Domain**: {ai-tools | developer-tools | security | market | cloud-api | regulatory | academic | other}
- **Status**: in-progress | complete
- **Recency baseline**: Sources from {YYYY} and later preferred; oldest source used: {YYYY-MM-DD}

<!--
External or mixed research answering one falsifiable question.
Owning specialist: researcher.
Before drafting: get_skill("docs/artifact-authorship")
  + get_skill("perspectives/researcher") + rules/common/research.md.

NATIVE SPINE:
  Question → Method → Sources → Findings → Counter-evidence
  → Confidence summary → Gaps → Implications → Recommendation
  → Open questions → References

Depth means: falsifiable Question, reproducible Method, Sources table with
reliability/credibility, Findings that separate observation from inference,
and a Recommendation that states its flip threshold.
Prefer unknown / [unverified] over fabrication. Never invent URLs.
-->

## Question

{One specific, falsifiable question this research must answer. Not a topic: a question with a determinate answer.}

| Field | Value |
|---|---|
| Question | {…} |
| Decision this unlocks | {who needs what} |
| Out of scope | {related questions deferred} |

## Method

{How the question was investigated. Enough detail that another person could reproduce it.}

| Step | What was done | Result |
|---|---|---|
| Domain starting point | {arXiv / NVD / vendor docs / …} | {…} |
| Date filter | {search from YYYY-first} | {…} |
| Internal paths checked | {.construct/research/, ADRs, …} | {…} |
| Queries run | {search terms} | {…} |
| Inclusion / exclusion | {decisions} | {…} |

## Sources

| Title / Path | Class | Reliability | Credibility | Date | URL | Verified | Relevance |
|---|---|---|---|---|---|---|---|
| {source title or file path} | primary / secondary / tertiary | A–F | 1–6 | {YYYY-MM-DD} | {URL or path} | yes / no / n/a | {one-line} |

<!-- Class is relative to the claim (rules/common/research.md §2).
  Reliability (A–F) and Credibility (1–6) are the Admiralty grade (research.md §10).
  Mark Verified = yes only after fetching the URL and confirming content matches. -->

## Findings

For each finding, state separately: Observation, Inference, Confidence, Sources.

### Finding 1: {short label}

**Observation**: {what the sources say}
**Inference**: {what is concluded — labeled as inference}
**Confidence**: high / medium / low: {reason}
**Sources**: {source title(s) from table}

### Finding N: {short label}

{repeat as needed}

## Counter-evidence

{The strongest finding that contradicts or complicates the conclusion. How it was addressed. If none found, state that and note whether it was actively searched for.}

| Counter-claim | Source | How addressed |
|---|---|---|
| {…} | {…} | {incorporated / bounded / unresolved} |

## Confidence summary

{Overall confidence across findings. Key uncertainties. What would most change the conclusion.}

## Gaps

| Gap | Missing evidence | What would fill it | Owner |
|---|---|---|---|
| {unresolved} | {…} | {…} | {role or unknown} |

## Implications

{What decisions this research enables or blocks. Who should act and in what timeframe.}

## Recommendation

{What the evidence supports. State the evidence threshold at which this recommendation would flip.}

| Recommendation | Flip threshold | Confidence |
|---|---|---|
| {action or stance} | {what evidence would reverse it} | high / medium / low |

## Open questions

| Question | Owner | Decision needed by |
|---|---|---|
| {follow-up research or handoff} | {role} | {YYYY-MM-DD} |

## References

Full citation list. Format: Author(s). (Year). Title. Venue/Source. Retrieved from URL (accessed YYYY-MM-DD).
Mark any URL that was not verified as `[unverified]`.

- {citation}
