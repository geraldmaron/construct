---
name: docs-artifact-authorship
description: "Use when: drafting or reviewing any Construct typed artifact (PRD, ADR, research, runbook, strategy, security review, QA plan, etc.). Canonical framing, population, storytelling, adversarial, anti-fabrication, and cross-persona trigger contract."
inputs: [artifact-type, evidence, audience]
artifactType: guidance
verificationBar: "Every load-bearing claim cites a re-verifiable source; unknowns marked; cross-persona triggers fired before ship."
triggers: ["artifact", "prd", "requirements", "draft", "author", "anti-fabrication"]
---
# Artifact authorship (all specialists)

Canonical contract for how Construct specialists create and review typed artifacts. Load before drafting. Persona overlays add failure modes; they do not waive this contract. See also `rules/common/no-fabrication.md` and `registry/worker-profiles/prompts/_shared/validation-contract.md`.

## Lifecycle (do not skip steps)

```text
intake → framing → template select → populate with evidence → adversarial review → validate → publish → handoff
```

- **Intake**: capture the user ask, constraints, and known unknowns. Do not invent scope.
- **Framing**: name problem, audience, decision sought, non-goals, and success evidence *before* solutions.
- **Template**: `get_template(<type>)`; never invent a parallel structure that drops required sections.
- **Populate**: fill every required section with sourced content or an explicit `unknown` / `[unverified]` with owner + date needed.
- **Adversarial**: challenge before consensus; recruit legal/privacy/security/accessibility/ops when triggers fire.
- **Validate**: `construct artifact validate <path> --type=<type>` then release gate.
- **Publish**: `construct publish … --strict --figures` when distribution is in scope.
- **Handoff**: note who reviewed, what remains open, and which beads own follow-up.

## Framing (every artifact)

Answer before drafting body prose:

| Question | Refuse to invent |
|---|---|
| What problem is this solving, in user-observable terms? | Feature wishlist phrased as problem |
| Who is the primary audience and what decision do they need? | Generic "stakeholders" |
| What is explicitly out of scope? | Empty non-goals |
| What evidence already exists (path, URL+date, intake id, bead)? | Anecdote without citation |
| What would falsify the proposal? | Unfalsifiable success language |

## Content and evidence standards

- Load-bearing claims need a re-verifiable source. If you did not fetch or read it, do not cite it.
- Separate **observation**, **inference**, and **recommendation**. Label confidence.
- Percentages, market sizes, competitor features, legal conclusions, and customer quotes are high-risk fabrication surfaces: mark `unknown` until evidenced.
- User advocacy requires researched user data (interviews, tickets, telemetry, research briefs). Stakeholder preference alone is insufficient for requirements that claim user benefit.
- Competitive landscape sections require named competitors, compared dimensions, and sources. "Everyone does X" is blocked.

## Template population rules

1. Prefer the canonical template under `templates/docs/` (or project override `.construct/templates/docs/`).
2. Leave placeholders only when the field is truly unknown: replace `{…}` with `unknown` + owner + decision-by date.
3. Do not delete required sections to hide ignorance. Empty required sections fail review.
4. Narrative sections use short paragraphs. Tables for comparisons. Bullets for scans only.
5. Diagrams use Mermaid/D2 with hand-drawn distribution styling on publish (`--figures`). Caption every figure; alt text for accessibility.
6. **Hierarchy depth (PRD and phased delivery docs):** Phase → Requirement (`FR-<phase>.<n>`) → Acceptance Criteria (`AC-<phase>.<n>.<k>`). Skeleton bullets without nested ACs fail. Customer PRDs must use the exact 12-section set in `templates/docs/prd.md` (TL;DR … References).
7. **Refusal:** if the user asks for a “quick PRD” that would drop hierarchy, competitive/financial honesty, legal triggers, or user evidence, refuse the thin shape and return the template sections that remain `unknown` with owners.

## PRD section contract (customer `prd`)

Exact top-level headings (validators match case-insensitively):

1. TL;DR
2. Background
3. Problem
4. Outcomes - Goals & Non-Goals
5. Why This Matters Now
6. Competitive Landscape & Financial Considerations
7. Phases
8. Requirements
9. Acceptance Criteria
10. Success Metrics
11. Risks
12. References

Legal trigger tables, FMEA, and open questions live under **Risks**. User-evidence tables live under **Background**. Do not invent parallel top-level sections that replace these.

## Artifact family spines (native; do not force the 12 PRD sections)

Each type keeps its own spine. Depth contract is shared: framing, evidence, goals/non-goals (or equivalent), adversarial challenge, references/anti-fabrication, and nested delivery where the type has phases/reqs/ACs (or MR/DR, diagnostic→remediation→rollback, bet→kill criteria).

| Type | Native spine (authoring surface) | Nested delivery |
|---|---|---|
| `prd` / `prd-platform` | 12-section PRD (platform adds actors/contracts) | Phase → FR-p.n → AC-p.n.k |
| `prd-business` | The bet → … → Kill criteria → Risks → References | Bet assumptions → kill thresholds |
| `meta-prd` | TL;DR → … → Phases → Failure modes → Rollout → References | Phase → MR/DR → *Acceptance* |
| `adr` | Problem → Context → Decision → Rationale → Rejected alternatives → Consequences → Reversibility → Adversarial → References | Alternatives table required |
| `rfc` / `rfc-platform` | Summary → Motivation → Goals → Design/Contract → Tradeoffs → Risks → Verification → Unresolved → References | Platform: breaking-change table |
| `strategy` | Vision → Bets → Non-bets → Metrics → Competitive → Risks → References | Every Bet needs kill criterion |
| `research-brief` | Question → Method → Sources → Findings → Counter-evidence → Recommendation → References | Observation ≠ inference |
| `runbook` | Alert → Symptoms → Impact → Diagnostic → Remediation → Rollback → Escalation → Adversarial → References | D-* → R-* → RB-* |

Runtime: `lintArtifactDeliveryDepth(type, body)` via `construct artifact validate` / release gate.

## Storytelling (all artifact families)

- Lead with the decision or outcome the busy reader needs (TL;DR / Summary / Decision).
- Escalate certainty only as evidence accumulates. Do not open with confident metrics that appear later as `[unverified]`.
- Make tradeoffs and the strongest counter-argument visible before the recommendation.
- End with open questions that name owners. Do not bury blockers in prose.
- Publish/PDF/PPT: preserve the same hierarchy — phases as chapters or slides; one FR cluster per slide max; never dump a dense PRD into a single PPTX slide (use `---` separators; layout audit must pass).

## Adversarial review (minimum)

Before calling done, the author or recruited reviewer must answer:

1. What is the strongest case that this artifact is wrong or premature?
2. Which claim would hurt users or the business most if fabricated or overstated?
3. Which persona was *not* consulted who owns a triggered risk (legal, privacy, security, accessibility, ops, finance)?
4. If this ships as written, what fails first (FMEA: failure mode, effect, cause, S×O×D, mitigation)?

High-risk types (PRD family, threat-model, security-review, strategy with regulatory scope) require an independent reviewer in the execution log before ship.

## Anti-fabrication (persona-agnostic checks)

- No invented URLs, ticket IDs, file paths, customer names, percentages, or dates.
- No "studies show" without a citation the reader can open.
- No silent promotion of inference to fact.
- Research evidence gate and output quality gate failures are unfinished work, not warnings to ignore.

## Cross-persona trigger matrix (authors must fire these)

Use during PRD/requirements/strategy authoring even when the user did not ask for the specialty.

| Signal in the ask or draft | Recruit / consult | What to add before ship |
|---|---|---|
| PII, accounts, children, health, biometrics, location | security.privacy + security.legal-compliance | Data classes, legal basis, retention/deletion, consent |
| Payments, contracts, terms, licenses, export controls | security.legal-compliance | Obligation→control map; counsel escalation if needed |
| Auth, secrets, multi-tenant, AI model I/O | security / security.appsec / security.ai | Trust boundaries, STRIDE notes, disclosure |
| UI, flows, forms, media | designer + designer.accessibility | WCAG targets, keyboard/SR paths |
| SLOs, on-call, migrations, feature flags | operations | Runbook delta, rollback, observability |
| User outcome claims, "users need", adoption | researcher + data-analyst | Evidence brief; refuse vanity metrics |
| Market position, pricing, competitors | researcher + product-manager | Competitive table with sources; mark gaps |
| APIs, schemas, platform contracts | architect | ADR/RFC link; compatibility stance |
| Acceptance criteria, release | qa | Testable criteria; coverage plan |
| Cost, margins, ROI claims | data-analyst (+ finance if recruited) | Model assumptions; `[unverified]` until sourced |

**PRD author who did not think about legal:** still complete the Legal & compliance trigger checklist in the PRD template. Route findings to `security.legal-compliance` / privacy before approval. Do not ship "we'll figure compliance later" without an owned open question and date.

**Requirements that advocate for users:** cite at least two independent user-evidence sources or open a research task. Include competitive landscape with sources or `unknown` rows. Prefer outcome metrics over activity metrics.

## Specialist ownership (who authors what)

| Artifact family | Primary author | Required challenger |
|---|---|---|
| PRD / one-pager / PRFAQ | product-manager | reviewer (+ recruited legal/privacy/security as triggered) |
| ADR / RFC / system design | architect | reviewer + engineer (feasibility) |
| Research / evidence / signal briefs | researcher | reviewer (methods) + data-analyst when quantitative |
| Security review / threat model | security | reviewer (FMEA) |
| Test plan / QA strategy | qa | engineer (feasibility) |
| Runbook / incident / postmortem | operations | reviewer |
| Strategy / memo | product-manager or business-strategist | reviewer + researcher |
| Accessibility audit | designer.accessibility | designer + qa.web-ui |

## DONE definition (shared)

An artifact is DONE only when:

1. Framing questions answered
2. Template sections populated or explicitly unknown with owners
3. Triggered cross-persona reviews completed or queued with dates
4. Adversarial pass recorded
5. `construct artifact validate` passes for the type
6. Publish evidence present if distribution was requested
