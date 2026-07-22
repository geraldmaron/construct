---
name: docs-artifact-authorship
description: "Use when: drafting or reviewing any Construct typed artifact (PRD, ADR, research, runbook, strategy, security review, QA plan, etc.). Canonical framing, population, storytelling, adversarial, anti-fabrication, and cross-persona trigger contract."
inputs: [artifact-type, evidence, audience]
artifactType: guidance
verificationBar: "Every load-bearing claim cites a re-verifiable source; unknowns marked; cross-persona triggers fired before ship."
triggers: ["artifact", "prd", "requirements", "draft", "author", "anti-fabrication"]
---
# Artifact authorship (all specialists)

Canonical contract for how Construct specialists create and review typed artifacts. Load before drafting. Persona overlays add failure modes; they do not waive this contract. See also `rules/common/no-fabrication.md`, `rules/common/human-voice.md`, and `registry/worker-profiles/prompts/_shared/validation-contract.md`.

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
- Competitive landscape sections require named competitors, compared dimensions, and sources (`skills/strategy/competitive-intel.md`). "Everyone does X" is blocked.
- **Why This Matters Now** owns timing economics (revenue at risk, upside window, market timing, cost of delay, competitive window, compliance deadline). Structural unit economics stay under Competitive/Financial; use `skills/strategy/financial-model.md` for Low/Base/High ranges.

## Template population rules

1. Prefer the canonical template under `templates/docs/` (or project override `.construct/templates/docs/`).
2. Leave placeholders only when the field is truly unknown: replace `{…}` with `unknown` + owner + decision-by date.
3. Do not delete required sections to hide ignorance. Empty required sections fail review.
4. Narrative sections use short paragraphs. Tables for comparisons. Bullets for scans only.
5. Diagrams on publish (`--figures`): **D2 `--sketch`** for multi-node domains, systems, and component maps (the intentional hand-drawn structural engine); **Mermaid classic** + Plus Jakarta Sans for simple linear or sequence flows only. Mermaid `handDrawn` / Caveat is retired — do not reintroduce it. Short node labels; put path meaning in the caption when edge labels would collide with sketch strokes. Caption every figure. Never ship overlapping nodes, edges, or labels; proof with `construct publish --preview` and SVG label overlap checks (`lib/figure-layout.mjs`) before claiming done. Lean heavily on diagrams for complex concepts; skip only for pure checklists, single-column tables, or legal obligation lists where a drawing adds noise.
6. **Hierarchy depth (PRD and phased delivery docs):** Phase → Requirement (`FR-<phase>.<n>`) → Acceptance Criteria (`AC-<phase>.<n>.<k>`). List ACs under each FR; keep ## Acceptance Criteria as an index. Don't restate Phase on every FR; use `### Phase N: Name` then `#### Area` then `##### FR`. Skeleton bullets without nested ACs fail. Why Now must include the timing-economics table; one-line stubs fail lint. Mix prose, short lists, compact tables, and diagrams; walls of tables fail review. **How that hierarchy is displayed** is load-bearing: see **Information display for delivery hierarchies** below.
7. **Phase Why? (phased docs):** Every phase needs a human **Why?**: purpose, who benefits (named roles/contexts), what risk it reduces. Put Why? in the Phases roadmap table and as `**Why?**` prose under each `### Phase N` heading before FRs/MRs. Meta-PRDs use `- **Why?**:` beside Goal. Skeleton phase tables without Why? fail review (`lintPrdDeliveryDepth` checks customer/platform PRDs).
8. **Inclusive / human framing:** Write for people in named roles and contexts. Avoid ableist or gendered defaults. Name impact: who is helped or harmed if the artifact ships wrong. Accessibility (WCAG) is product quality where UI ships, not a footnote. Sterile body duplicates of masthead (H1 + Date/Owner/Status) are banned when YAML frontmatter already carries those fields.
9. **Human voice bar (load-bearing):** Sound like a careful colleague, not a corporate LLM and not a staged keynote. See `rules/common/human-voice.md`.

   - **Prefer contractions** in prose: `don't`, `won't`, `can't`, `isn't`, `we're`, `it's`, `that's` (prefer `it's` over `it is` unless an exception applies).
   - **Prefer longer, connected sentences** that carry a stake, constraint, or next action in one pass. Mix short sentences sparingly; stacked fragments feel gimmicky.
   - **Avoid spaced em dashes** (` — `) and Unicode em dash (U+2014). Prefer commas, periods, colons, or parentheses.
   - **Mild warmth, not performance:** earn attention with clarity; refuse sermon beats, destiny talk, Disney-movie uplift, and celebrity-mimicry checklists.
   - **Refuse LLM tells** (non-exhaustive): `delve`, `landscape` (outside required section titles), `robust`, `leverage` as filler, `it's important to note`, `In today's…`, `This ensures that…`, stacked empty tricolons.
   - **Tone:** concrete, slightly encouraging when earned, skeptical of fluff; still no fabrication and still depth-first.
   - **Exceptions:** acceptance-criteria precision; legal `shall` / `must` / `must not`; quoted statute or primary source; validators that require exact section titles.
   - **Psychology as craft:** product and org artifacts may name attention, trust, and belief-change as decision inputs. Don't turn that into inspirational theater.
10. **Refusal:** if the user asks for a “quick PRD” that would drop hierarchy, Phase Why?, Why-Now timing economics, competitive/financial honesty, legal triggers, user evidence, or human voice, refuse the thin shape and return the template sections that remain `unknown` with owners.

## Information display for delivery hierarchies

The Phase → FR → AC contract is about **completeness**. Display is about **extraneous cognitive load**: the mental tax of decoding a jumble when the content itself isn't that hard. I-O / instructional design treats that tax as real workplace friction (intrinsic vs extraneous vs germane load; Sweller's cognitive load theory as used in workplace learning design). Progressive disclosure (Nielsen Norman framing for interfaces; the same sequencing idea in technical docs) says: give each audience a complete stop-point before the next layer of detail.

Use density to pick a layout. Don't default to an ID salad (`FR-1.1` then a bullet wall of `AC-1.1.k`) at the same visual weight as the Why.

| Density | What the reader sees first | Detail layer | Avoid |
|---|---|---|---|
| Sparse (1–2 FRs, ≤3 ACs each) | Phase heading + **Why?** prose (2–4 sentences) | Each FR as a short titled block; ACs as a compact 2-column table (`AC` / `Check`) under that FR | Orphan AC ids floating above the FR they belong to |
| Medium (typical phase) | Phases **roadmap table** (outcome, why, exit), then one section per phase | Under each phase: Why → optional one-line "what ships" → FR blocks with AC tables | Nesting FR/AC as undifferentiated bullets |
| Dense (≥4 FRs or cross-cutting ACs) | Roadmap table + per-phase **summary table** (`ID` / `Requirement` / `Done when`) | Full FR prose + AC tables in an appendix or collapsed "Spec detail" subsection labeled for implementers | Making executives traverse every AC to learn the phase outcome |

**Hard rules**

1. **Signpost layers.** Label the roadmap as the decision layer and the FR/AC blocks as the verification layer so a VP can stop after the table.
2. **Keep related work adjacent.** Why, FRs, and ACs for one phase stay together (aligning / grouping reduces search cost).
3. **One visual grammar per layer.** Prose for why; tables for checks; never three competing bullet trees for the same objects.
4. **Decision-critical facts stay in the open layer.** Risks, cost, and kill criteria are not buried under AC lists.
5. **IDs are handles, not headings.** Prefer a human title with the id in a table column or quiet suffix (`Retired CLI teaching (FR-1.1)`), not a page of `FR-1.1` / `AC-1.1.1` alone.
6. **Acceptance Criteria index** (PRD §9) stays an index or traceability table, not a second full dump of every AC in a different order.

**Worked shape (medium density)**

```markdown
### Phase 1: Baseline honesty

**Why?** Day-one friction trains disbelief before anyone reads a strategy sentence.
Operators and authors pay that cost; fixing teaching and verify gates restores
enough trust to judge writing quality at all.

| ID | Requirement | Done when |
|---|---|---|
| FR-1.1 | Retired CLI teaching removed from live surfaces | Capability + publish remediation teach procedure invoke |
| FR-1.2 | Lean init passes docs:verify | Fresh lean README has Usage; verify exits 0 |

#### FR-1.1 Retired CLI teaching removed from live surfaces

Live surfaces must match the Construct 2.0 CLI so first-run sessions don't
teach a dead path.

| AC | Check |
|---|---|
| AC-1.1.1 | `capability describe --json` lists `procedure invoke`, not `workflow invoke` |
| AC-1.1.2 | Publish gate failure text points at `procedure invoke` |
```

Sources for the load/disclosure framing (re-verify when citing externally): MATC Group summary of I-O psychology and documentation cognitive load ([matcgroup.com](https://www.matcgroup.com/documentation/reducing-cognitive-load-with-better-documentation-lessons-from-i-o-psychology/); accessed 2026-07-22); HSI overview of cognitive load theory in workplace learning ([hsi.com](https://hsi.com/blog/what-is-cognitive-load-and-why-does-it-matter-for-corporate-training-and-development); accessed 2026-07-22); progressive disclosure as sequencing access so each level is usable alone (NN/g interface framing; technical-doc layering discussions such as [howtothink.ai](https://www.howtothink.ai/learn/progressive-disclosure-through-hierarchy) and executive/technical layering at [soreng.co](https://soreng.co/how-to-align-technical-depth-with-executive-clarity); accessed 2026-07-22). Mark any stronger quantitative claims `[unverified]` until primary studies are attached.

## Layout by intent (choose the vessel, not a default colon stack)

Different intents need different vessels. A wall of `Label: value` lines (Audience:, Decision sought:, Out of scope:, Evidence baseline:) is a common failure: every field gets the same scent, so nothing reads as primary, and the page looks like a form dump. Information scent research (NN/g) is about predictive cues; equal-weight labels predict nothing.

Pick the vessel from intent:

| Intent | What the reader is doing | Prefer | Avoid |
|---|---|---|---|
| Orient / decide | Needs the ask in one breath | 1–3 prose sentences that embed who, decision, and non-goals | Four+ `Field:` lines stacked under Framing |
| Compare options or bounds | Scanning differences | Compact 2–3 column table | Paragraphs of parallel `X: … / Y: …` |
| Trace a system or domain | Building a mental model | Compact D2 sketch (prefer) or Mermaid classic for simple flows; short labels + caption | Long nested prose that recreates the graph; Mermaid handDrawn |
| Verify a check | Confirming done/not-done | AC check-table under the FR | Mixing verification into the orientation paragraph |
| Cite evidence floor | Trusting the claim | Short “Evidence” subsection or footnote-style list with links/dates | Stuffing URLs into the opening decision paragraph |
| Bind a decision record | Recording commitments | Decision card table with fixed rows (For / Decide / Not now / Evidence) used sparingly | Turning every subsection into a mini decision record |

**Framing sections specifically**

1. Open with prose that states the problem and the decision in plain English (high scent for “what is this doc for?”).
2. If you still need scannable bounds, use one **decision card** table with human row names (`For`, `Decide`, `Not now`, `Evidence floor`), not a colon list.
3. Put long source catalogs under References or a short Evidence subsection, not in the opening breath.
4. If the framing is about a multi-step path or layered reading model, **draw it** (see diagram rule above) instead of enumerating layers as labels.

```markdown
## Framing

Construct turns messy signals into durable decisions, but the pages we publish
still lose people when the writing is cold or the phase plan reads like an id
dump. This note asks product and platform owners to treat voice and delivery
layout as product surfaces for one cycle, measure whether readers can restate
the decision after one pass, and keep or kill the bet with evidence.

| | |
|---|---|
| For | Product and platform owners |
| Decide | Adopt refined human-voice + density-based Phase/FR/AC display; measure restatement |
| Not now | Model fine-tuning, new UI chrome, celebrity mimicry packs, invented testimonials |
| Evidence floor | Customer sim 2026-07-22; cognitive-load / progressive-disclosure sources in References |
```

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

Legal trigger tables, FMEA, and open questions live under **Risks**. User-evidence tables live under **Background**. Why Now carries financially meaningful **timing** pressure; Competitive/Financial carries landscape + structural economics. Do not invent parallel top-level sections that replace these.

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
- **One continuous story** across related artifacts (PRD ↔ ADR ↔ compliance memo ↔ deck): same problem, same phase boundaries, same open questions with the same owners, not jumpy rewrites per persona.
- **Multi-persona fingerprints** must be substantive: researcher evidence gaps, architect tradeoffs, privacy/legal gates, a11y criteria, ops/QA verify paths, engineer constraints, reviewer FMEA, written into Requirements/Risks/Open questions, not Contributors name-drops.
- Publish/PDF/PPT: preserve the same hierarchy (phases as chapters or slides; one FR cluster per slide max). Never dump a dense PRD into a single PPTX slide (use `---` separators; layout audit must pass).

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
- **Inline citations** per `rules/common/citation.md`: after each load-bearing claim use `([Short title](https://…); accessed YYYY-MM-DD)`, `[source: path#anchor]`, or a defined `[^n]` footnote. Keep the Sources/References table, but do not rely on title-only cites ("see Architecture") with no link. Verify http(s) URLs with `construct artifact validate … --check-links` before publish.

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

## Before you write (voice checklist)

- [ ] Contractions prose where natural (`don't` / `won't` / `can't`)
- [ ] No spaced em-dash theater; commas/periods/colons/parens instead
- [ ] No LLM tells from the refuse set above
- [ ] Reads like a careful colleague; inclusive impact named
- [ ] Exceptions respected (ACs, legal shall/must, quotes, exact section titles)

## DONE definition (shared)

An artifact is DONE only when:

1. Framing questions answered
2. Template sections populated or explicitly unknown with owners
3. Human voice bar met (contractions prose; no em-dash theater; no AI tells)
4. Triggered cross-persona reviews completed or queued with dates
5. Adversarial pass recorded
6. `construct artifact validate` passes for the type
7. Publish evidence present if distribution was requested
