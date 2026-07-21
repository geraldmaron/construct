---
name: docs-prd-workflow
description: "Use when: the user asks to create a PRD, platform spec, business case, RFC, or requirements document."
inputs: [research-question, evidence-brief]
artifactType: prd
verificationBar: "Exact 12-section PRD structure; Phase→Requirement→AC hierarchy with depth; every load-bearing claim cites a verifiable source or unknown/[unverified]; adversarial + legal/privacy/user/competitive/financial discovery complete."
triggers: ["prd", "product requirements", "write a prd"]
---
# PRD Workflow

Use when: the user asks to create a PRD, platform spec, business case, RFC, or requirements document.

Choose the document type before drafting:

Resolve tone from `specialists/tone-profiles.json` and optional `.construct/brand-voice.json` override for the selected template.

| Template | Use when |
|---|---|
| `prd` | Customer-facing product capabilities, user workflows, end-user requirements |
| `prd-platform` | Internal platform, APIs, SDKs, developer tooling, operational infrastructure, shared services |
| `prd-business` | Strategic bets, market positioning, business model changes, make-vs-buy, pricing strategy |
| `meta-prd` | Requirements about the product operating system itself: agent workflows, evidence pipelines, templates, evaluation loops, governance |
| `rfc` | Technical or architectural proposals that need structured review before implementation: no contract changes |
| `rfc-platform` | Proposals that change an external contract: API, SDK, schema, event payload, permission model, protocol |

Style constraint: do not produce a wall of bullets. Use paragraphs for reasoning and narrative, tables for comparison, and bullets only where scanability helps. Prefer contractions; avoid spaced em dashes; refuse LLM tells (`rules/common/human-voice.md`).

## Canonical PRD structure (customer `prd` template — exact)

1. TL;DR
2. Background
3. Problem
4. Outcomes - Goals & Non-Goals
5. Why This Matters Now — **timing economics** table (revenue at risk, upside window, market timing, cost of delay, competitive window, compliance deadline). One-line stubs fail `lintPrdDeliveryDepth`.
6. Competitive Landscape & Financial Considerations — landscape + structural Low/Base/High finance (not a duplicate of Why Now)
7. Phases — roadmap table includes **Why? (human purpose)** per phase
8. Requirements — each `### Phase N` opens with `**Why?**` before FRs
9. Acceptance Criteria
10. Success Metrics
11. Risks
12. References

Do not invent alternate top-level headings. Fold legal triggers, FMEA, and open questions under **Risks**. Fold user-evidence tables under **Background**.

## Hierarchy contract (blocking)

```text
Phase  →  Why? (human purpose)  →  one or more Requirements (FR-<phase>.<n>)
Requirement  →  one or more Acceptance Criteria (AC-<phase>.<n>.<k>)
```

- Skeleton one-line FRs fail review. Each FR needs prose (what/why/constraint) plus linked AC ids.
- Each phase needs Why? — who benefits (named roles), what risk it reduces. Multi-persona tension belongs here and under Risks, not as contributor name-drops.
- Inclusive / human framing: avoid ableist or gendered defaults; WCAG targets where UI ships.
- Each AC is stranger-checkable. Ban “intuitive / fast / robust / delightful” without thresholds.
- `construct artifact validate` runs `lintPrdDeliveryDepth` for type `prd` and `prd-platform`: missing sections, missing Phase headings, missing Phase Why?, orphan AC ids, or FRs without a Phase all fail.

## Variant spines (same depth bar, native headings)

### `prd-business`

The bet → Market thesis → Problem and opportunity → Strategic goals → Alternatives rejected → What must be true → Competitive analysis → Make vs. buy vs. partner → Go-to-market → Financial frame → Kill criteria → Risks (legal + FMEA) → Constraints → Open questions → References.

`lintPrdBusinessDeliveryDepth` requires kill criteria and adversarial FMEA. No Phase→FR→AC (this is a bet doc, not a feature spec).

### `meta-prd`

TL;DR → Background → Problem → Outcomes - Goals & Non-Goals → Principles → Inputs and evidence → Phases → Human approval gates → Failure modes (legal + FMEA) → Rollout → Open questions → References.

```text
Phase  →  MR-<phase>.<n> (workflow) and/or DR-<phase>.<n> (document + evaluation)
Requirement  →  *Acceptance* (or AC-* markers)
```

`lintMetaPrdDeliveryDepth` enforces Phase + MR/DR + Acceptance markers.

## Steps

Call `get_skill("docs/artifact-authorship")` and `get_skill("perspectives/product-manager")` before drafting. The numbered chain below is the manifest baseline, not the final roster. `construct procedure invoke` and `author_artifact` evaluate the request's content signals and append condition-recruited participants after the baseline chain (ADR-0070): the invoke result carries `recruitment: {recruited, addedRoles, rationale}`, and `author_artifact` returns `recruited: [{specialist, reason, role, gate, source}]`. Honor the recruited set — run those participants at their stated role and gate alongside the baseline; do not substitute a memorized roster. Override only on explicit request: `recruitment: "off"` skips recruitment for the run; on `author_artifact`, an explicit list of cx- ids replaces the signal-derived set.

**Discovery the author must force (even if the user never mentioned them):**

1. **Legal & compliance triggers** — complete the Risks → Legal table; recruit `security.legal-compliance` / `security.privacy` when any row is yes/unknown with risk.
2. **User advocacy** — ≥2 independent evidence rows in Background, or **research-required** + owned research task.
3. **Competitive + financial honesty** — named alternatives with sources or `unknown`; ROI/cost rows may be `unknown` / `[unverified]` with owners — never fabricated.
4. **Adversarial FMEA** — at least one high-cost failure mode with S×O×D and mitigation or accept-with-rationale.
5. **Security / a11y / ops** — fire from the authorship trigger matrix when signals appear.

1. **cx-product-manager** produces the requirements package (full 12 sections + hierarchy)
2. **cx-researcher** grounds requirements in user behavior and fills evidence gaps (invoke in parallel for new features)
3. **Write to the appropriate `docs/` subdirectory** using the selected template. Each `get_template()` call resolves `.construct/templates/docs/` first, then the Construct default.

   | Template | Output path |
   |---|---|
   | `prd` | `docs/specs/prd/{YYYY-MM-DD}-{slug}.md` |
   | `prd-platform` | `docs/prd-platform/{YYYY-MM-DD}-{slug}.md` |
   | `prd-business` | `docs/prd-business/{YYYY-MM-DD}-{slug}.md` |
   | `meta-prd` | `docs/meta-prd/{YYYY-MM-DD}-{slug}.md` |
   | `rfc` | `docs/decisions/rfc/{YYYY-MM-DD}-{slug}.md` |
   | `rfc-platform` | `docs/decisions/rfc/{YYYY-MM-DD}-{slug}.md` |
4. **cx-reviewer** runs the FMEA challenge pass (`perspectives/devil-advocate`) on the draft; highest-RPN failure modes need a mitigation or explicit accept-with-rationale before ship. Their specialist id must appear in `.construct/agent-log.jsonl` (manifest `releaseGate.requiredReviewers` for PRD-family types). Reviewer also verifies legal/privacy/user-evidence/financial honesty and Phase→FR→AC nesting.
5. **cx-operations** updates `.construct/context.md` with a link to the PRD

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## File naming
- `docs/{template-type}/{YYYY-MM-DD}-{slug}.md`
- Examples:
  - `docs/specs/prd/2026-04-search-autocomplete.md`
  - `docs/prd-platform/2026-04-events-api-v2.md`
  - `docs/prd-business/2026-04-enterprise-tier.md`
  - `docs/meta-prd/2026-04-product-intelligence-workflow.md`
  - `docs/decisions/rfc/2026-04-storage-backend-migration.md`

## PRD lifecycle
- Draft → stakeholder review → approved → link to implementation tasks
- Once shipped, update status field to `shipped` and add a link to the implementation

## After approval → beads

Once the PRD is approved, run `/plan feature {feature-slug}` to produce a structured implementation plan and import it as workflow task packets (beads) into `.construct/workflow.json`. Link the resulting `.construct/plans/` file back in the PRD as the implementation reference.

## Distribution (publish pipeline)

**`construct procedure invoke` returns a plan only** — it does not draft the PRD. Run the specialists the plan returns — the baseline chain plus every entry in its `recruitment.recruited` block — to author and review the artifact from the template. **Do not hand-write a stub and publish.**

Authoring and publish surfaces return a **lifecycle handoff** object (`lifecycle: { state, evidence, nextAction, nextCommand? }`) so you can tell plan-only (`planned`), release-gate pass (`validated`), and export complete (`published`) apart. `author_artifact` also mirrors plan-only state on `workflow_lifecycle` / `invokePlan.lifecycle`. Prepared inline runs use `prepared`; they are not authored artifacts.

Before distribution:

```bash
node bin/construct artifact validate docs/specs/prd/<slug>.md --type=prd
node bin/construct publish docs/specs/prd/<slug>.md --strict --figures
```

`construct publish` runs the artifact release gate by default. Thin or unscaffolded docs **exit 2** with remediation hints. Do not use `--no-gate` or `--no-strict` in demos or ship paths.

**Presentation is part of done.** Published PDFs use type-specific Typst templates (`construct-prd.typ`, `construct-research.typ`, `construct-decision.typ`) with the field-notebook brand: Plus Jakarta Sans, cool stone paper, slate-teal evidence accent (see `templates/distribution/construct-brand.typ`). Lead with a filled **TL;DR**, not a bullet wall. Deck/PPTX exports require `---` slide separators and must pass the PPTX layout audit. Diagrams on the publish path use crisp D2 (no `--sketch`) and Mermaid classic styling with charcoal ink (`#1a1d24`) and Plus Jakarta Sans labels.

`--strict` means **toolchain and release gate** both pass. Invoke alone is not "done."

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
