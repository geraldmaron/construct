---
name: strategy-competitive-intel
description: Use when populating Competitive landscape tables from primary sources without fabricating market share or pricing.
inputs: [competitors, artifact]
artifactType: research-brief
---
# Competitive intel research SOP

How to populate Competitive landscape tables without fabricating market share,
G2 stars, or pricing matrices.

## Preferred sources (in order)

1. **Primary product surfaces** — competitor marketing site, docs, pricing page (URL + access date)
2. **Company IR / SEC EDGAR** — 10-K/10-Q risk factors and segment language (US public cos)
3. **Customer evidence** — win/loss notes, support tickets, interviews (with ids)
4. **Secondary analyst notes** — only with date; never as sole source for a load-bearing claim

## Refuse

- Invented market-share %
- Fabricated G2/Capterra star ratings or review counts
- “Everyone uses X” without a source
- Pricing copied from memory — refetch the pricing page

## Procedure

1. Name the alternative (or `unknown` with research owner + due date)
2. Pick one dimension (price / workflow / trust / ACL / …)
3. Record **observed** approach with URL+date
4. State our stance: match / differentiate / defer
5. If research incomplete, leave cells `unknown` — do not pad

## Case-law / regulatory competitive claims

If a competitor claims “GDPR compliant” or similar, do not mirror the claim.
Route regulatory posture through `skills/compliance/regulatory-review.md` and
primary regulation text — never competitor marketing as legal fact.

## Authorship / voice

When the intel lands in a typed artifact, follow `get_skill("docs/artifact-authorship")` and `rules/common/human-voice.md`. Do not pad competitive prose with LLM tells or unsourced authority.
