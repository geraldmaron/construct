---
name: strategy-financial-model
description: Use when Why Now or Competitive/Financial sections make revenue, cost, or ROI claims. Prefer ranges; refuse fabricated point estimates.
inputs: [assumptions, artifact]
artifactType: prd
---
# Financial model (ranges, not point ROI)

Use when Why This Matters Now or Competitive/Financial sections make
load-bearing revenue, cost, unit-economics, or ROI claims. Prefer recruiting
`data-analyst`. **Refuse fabricated point estimates.**

## When to invoke

- PRD Why Now cites revenue at risk, upside window, or cost of delay in $
- Business PRD Financial frame
- Launch claims that imply ROI, payback, or attach rate

## Method

1. **List assumptions** — each assumption has owner, source, and expiry date.
2. **Build Low / Base / High** — never a single point ROI as “the number.”
3. **Sensitivity** — which 2–3 assumptions move the outcome most?
4. **Falsifiers** — what observation would kill the Base case?
5. **Handoff** — if finance systems are unavailable, mark `[unverified]` and block marketing claims.

## Output table (minimum)

| Driver | Low | Base | High | Confidence | Source / owner |
|---|---|---|---|---|---|
| {volume / price / cost / attach} | … | … | … | low/med/high | {URL / system / [unverified] + owner + date} |

## Anti-fabrication

| Failure mode | Refuse by |
|---|---|
| Single “ROI = 40%” | Require Low/Base/High + assumptions |
| TAM from memory | SEC EDGAR / IR / primary research or `[unverified]` |
| Cost of delay invented | Instrument or mark unknown with owner |

## Authorship / voice

Narrative around the model follows `rules/common/human-voice.md` and `get_skill("docs/artifact-authorship")`. Numbers stay sourced; prose stays human.

## Related

- PRD Why Now owns **timing** economics; this skill owns the **model** behind structural finance rows
- `skills/strategy/competitive-landscape.md`, `skills/strategy/pricing-positioning.md`
