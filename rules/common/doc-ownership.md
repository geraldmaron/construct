---
description: which Worker Profile owns which document type.
---
# Document Ownership

A document type names a body of work. That body of work has an owner. The orchestrator routes; it does not author.

If Construct (or any general persona) drafts a PRD, ADR, research brief, or RFC directly, the Worker Profiles who would normally challenge the framing, demand external research, or enforce domain rigor never get invoked. The artifact looks complete and is structurally weak.

## Ownership table

| Document type | Owner | Why |
|---|---|---|
| PRD, meta-PRD, PRFAQ, one-pager, backlog proposal, customer profile | **product-manager** | Requires evidence-traceable requirements, user grounding, scope discipline |
| ADR, RFC, architecture overview, system design | **architect** | Requires trade-off analysis, reversibility reasoning, interface contract scrutiny |
| Research brief, evidence brief, signal brief, product intelligence report | **researcher** | Requires external-source policy (`rules/common/research.md`), citation standards |
| Runbook | **operations** | Requires on-call reality, incident experience |
| Incident report, postmortem | **operations** | Requires blameless structure, reliability framing (SRE overlay) |
| Test plan, QA strategy | **qa** | Requires coverage threshold reasoning, risk-based prioritization |
| Security review, threat model | **security** | Requires attacker-perspective scrutiny |
| Memo, internal explainer | **operations** | Requires narrative discipline and cross-linking (docs overlay; retired `cx-docs-keeper`) |
| Changelog, CHANGELOG.md | **operations** | Lightweight but still a documentation deliverable (docs overlay) |

## Routing rules

1. **Detect the doc type from the request.** Keywords like "write a PRD", "draft an ADR", "produce a research brief" trigger ownership routing. Construct must not author these itself.

2. **Route before framing.** The owning Worker Profile runs the framing step (`rules/common/framing.md`) as part of their drafting process. Pre-framing by the orchestrator defeats the purpose.

3. **Research precedes architecture.** If the request is for architecture/ADR/RFC work and references a named concept not in the project glossary, `researcher` runs *before* `architect` and returns the reference set `architect` must cite.

4. **The orchestrator reviews, does not redraft.** If the owner's draft has issues, the orchestrator surfaces them back to the same Worker Profile. Only the owner revises.

5. **Cross-doc coherence is operations' docs job.** When a set of documents must stay consistent (PRD ↔ ADR ↔ research), `operations` runs after drafting to enforce cross-references, not to rewrite content.

## Failure mode this rule prevents

An orchestrator that writes a PRD directly:

- Skips requirements traceability (`product-manager` would demand evidence)
- Skips external research (`researcher` would demand primary sources)
- Skips framing (framing is the owning profile's first step, not the orchestrator's)
- Produces a structurally complete artifact that reflects the orchestrator's reasoning, not the domain's rigor

This is exactly how "it looks done but feels shallow" happens.

## The one rule

**If the document type has an owner in the table above, route to the owner. Do not author it yourself.**
