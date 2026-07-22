---
name: compliance-case-law-research
description: Use when verifying case law, reporter citations, or holdings for compliance-memo and legal-compliance reviews. Not legal advice.
inputs: [artifact, citation]
artifactType: compliance-memo
---
# Case law and citation research (compliance)

When precedent, holdings, or reporter citations are load-bearing for a
compliance-memo, regulatory review, or legal overlay — use this skill. Bound to
`security` / `security.legal-compliance`. **Not legal advice.**

## When to invoke

- Author cites a case name, reporter citation, or “courts have held…”
- Counsel asks for supporting opinions or dockets
- Anti-fabrication pass on a draft that contains legal citations

Do **not** invent case names, pin cites, or holdings.

## Leverage stack (open first, licensed when available)

1. **Primary statute/regulation** — EUR-Lex, eCFR, official agency text (always before case law when the obligation is statutory).
2. **Agency guidance** — ICO, EDPB, FTC, state AG portals (secondary).
3. **Open case law** — [CourtListener](https://www.courtlistener.com/) (Free Law Project; CAP corpus). Use search for opinions/dockets; use the **citation lookup / verification API** (or hosted MCP at `mcp.courtlistener.com` when configured) to fight hallucinated cites.
4. **Licensed libraries** — Westlaw / Lexis only if the org has access. Never fabricate access.
5. **Counsel** — escalate when jurisdiction, holding applicability, or risk is material.

Construct does **not** require a CourtListener API key to install. Prefer fetch +
verify when reviewing; otherwise mark cites `[unverified]` and refuse ship on
load-bearing invented precedent.

## Procedure

1. Extract every citation (case name, reporter, statute article) from the draft.
2. For each case cite: look up on CourtListener (or licensed DB). Record opinion id / URL + access date.
3. If lookup fails: rewrite as `[unverified]` + counsel owner + decision-by date — do not paraphrase a remembered holding.
4. Separate **observation** (what the opinion says) from **inference** (how it applies to this product).
5. File results under Regulatory Citations in `templates/docs/compliance-memo.md`.

## Anti-fabrication

| Failure mode | Refuse by |
|---|---|
| Invented reporter cite | Citation verify fails → delete or `[unverified]` |
| Blog as primary law | Demote to tertiary; fetch primary text |
| “We are compliant” | Replace with obligation→control + residual risk |
| Counsel sign-off without date/name | Block approval |

## Handoffs

- Unclear lawful basis / DPIA → `templates/docs/dpia-or-privacy-assessment.md`
- Release gate → operations / release manager after counsel gate
- Product claims (“enterprise-ready”, “GDPR compliant”) → product-manager + legal-compliance before marketing
