<!--
skills/docs/prd-workflow.md — Workflow for producing a PRD and connecting it to workflow task packets.

Guides cx-product-manager through requirements gathering, user research, and writing a PRD
to docs/prd/. Once approved, the PRD feeds /plan feature to create bead packets in
.cx/workflow.json — closing the loop from discovery to execution.
-->
# PRD Workflow

Use when: the user asks to create a PRD, platform spec, business case, RFC, or requirements document.

Choose the document type before drafting:

| Template | Use when |
|---|---|
| `prd` | Customer-facing product capabilities, user workflows, end-user requirements |
| `prd-platform` | Internal platform, APIs, SDKs, developer tooling, operational infrastructure, shared services |
| `prd-business` | Strategic bets, market positioning, business model changes, make-vs-buy, pricing strategy |
| `meta-prd` | Requirements about the product operating system itself: agent workflows, evidence pipelines, templates, evaluation loops, governance |
| `rfc` | Technical or architectural proposals that need structured review before implementation — no contract changes |
| `rfc-platform` | Proposals that change an external contract: API, SDK, schema, event payload, permission model, protocol |

Style constraint: do not produce a wall of bullets. Use paragraphs for reasoning and narrative, tables for comparison, and bullets only where scanability helps. Keep em dashes rare.

## Steps

1. **cx-product-manager** produces the requirements package
2. **cx-ux-researcher** grounds requirements in user behavior (invoke in parallel for new features)
3. **cx-researcher** fills any evidence gaps
4. **Write to the appropriate `docs/` subdirectory** using the selected template. Each `get_template()` call resolves `.cx/templates/docs/` first, then the Construct default.

   | Template | Output path |
   |---|---|
   | `prd` | `docs/prd/{YYYY-MM-DD}-{slug}.md` |
   | `prd-platform` | `docs/prd-platform/{YYYY-MM-DD}-{slug}.md` |
   | `prd-business` | `docs/prd-business/{YYYY-MM-DD}-{slug}.md` |
   | `meta-prd` | `docs/meta-prd/{YYYY-MM-DD}-{slug}.md` |
   | `rfc` | `docs/rfc/{YYYY-MM-DD}-{slug}.md` |
   | `rfc-platform` | `docs/rfc/{YYYY-MM-DD}-{slug}.md` |
5. **cx-docs-keeper** updates `.cx/context.md` with a link to the PRD

## File naming
- `docs/{template-type}/{YYYY-MM-DD}-{slug}.md`
- Examples:
  - `docs/prd/2026-04-search-autocomplete.md`
  - `docs/prd-platform/2026-04-events-api-v2.md`
  - `docs/prd-business/2026-04-enterprise-tier.md`
  - `docs/meta-prd/2026-04-product-intelligence-workflow.md`
  - `docs/rfc/2026-04-storage-backend-migration.md`

## PRD lifecycle
- Draft → stakeholder review → approved → link to implementation tasks
- Once shipped, update status field to `shipped` and add a link to the implementation

## After approval → beads

Once the PRD is approved, run `/plan feature {feature-slug}` to produce a structured implementation plan and import it as workflow task packets (beads) into `.cx/workflow.json`. Link the resulting `.cx/plans/` file back in the PRD as the implementation reference.
