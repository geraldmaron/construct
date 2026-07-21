---
name: docs-prfaq-workflow
description: "Use when: the user asks for a PRFAQ, working-backwards doc, launch narrative, or FAQ grounded in product evidence."
inputs: [prd, evidence-brief]
artifactType: prfaq
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
---
# PRFAQ Workflow

Use when: the user asks for a PRFAQ, working-backwards doc, launch narrative, or FAQ grounded in product evidence.

## Modes

- **From PRD**: load the PRD, related evidence brief, customer profiles, and linked docs.
- **From evidence**: gather evidence first. If evidence is below threshold, write a signal brief instead.

## Steps

1. Load `get_template("prfaq")`.
2. Identify PM flavor and product area.
3. Draft problem statement from evidence, not positioning.
4. Write the press release in shipped-state language.
5. Write external FAQ for customers and internal FAQ for engineering, sales, support, security, finance, and leadership.
6. Include unknowns as `TBD` with what would resolve them.
7. Save to `.construct/knowledge/internal/prfaqs/` until approved.

## Approval

Stop before marking a PRFAQ approved or publishing it as a document of record.
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.
