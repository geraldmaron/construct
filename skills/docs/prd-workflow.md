---
name: docs-prd-workflow
description: "Use when: the user asks to create a PRD, platform spec, business case, RFC, or requirements document."
inputs: [research-question, evidence-brief]
artifactType: prd
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
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

Style constraint: do not produce a wall of bullets. Use paragraphs for reasoning and narrative, tables for comparison, and bullets only where scanability helps. Keep em dashes rare.

## Steps

The numbered chain below is the manifest baseline, not the final roster. `construct workflow invoke` and `author_artifact` evaluate the request's content signals and append condition-recruited participants after the baseline chain (ADR-0070): the invoke result carries `recruitment: {recruited, addedRoles, rationale}`, and `author_artifact` returns `recruited: [{specialist, reason, role, gate, source}]`. Honor the recruited set — run those participants at their stated role and gate alongside the baseline; do not substitute a memorized roster. Override only on explicit request: `recruitment: "off"` skips recruitment for the run; on `author_artifact`, an explicit list of cx- ids replaces the signal-derived set.

1. **cx-product-manager** produces the requirements package
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
4. **cx-reviewer** runs the FMEA challenge pass (`perspectives/devil-advocate`) on the draft; highest-RPN failure modes need a mitigation or explicit accept-with-rationale before ship. Their specialist id must appear in `.construct/agent-log.jsonl` (manifest `releaseGate.requiredReviewers` for PRD-family types).
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

**`construct workflow invoke` returns a plan only** — it does not draft the PRD. Run the specialists the plan returns — the baseline chain plus every entry in its `recruitment.recruited` block — to author and review the artifact from the template. **Do not hand-write a stub and publish.**

Before distribution:

```bash
node bin/construct artifact validate docs/prd-platform/<slug>.md --type=prd-platform
node bin/construct publish docs/prd-platform/<slug>.md --strict --figures
```

`construct publish` runs the artifact release gate by default. Thin or unscaffolded docs **exit 2** with remediation hints. Do not use `--no-gate` or `--no-strict` in demos or ship paths.

**Presentation is part of done.** Published PDFs use type-specific Typst templates (`construct-prd.typ`, `construct-research.typ`, `construct-decision.typ`) with violet editorial branding and Inter body typography. Lead with an `::: executive-summary` narrative paragraph — not a bullet wall. Diagrams on the publish path use D2 `--sketch` and Mermaid `handDrawn` styling with Construct violet accent.

`--strict` means **toolchain and release gate** both pass. Invoke alone is not "done."
