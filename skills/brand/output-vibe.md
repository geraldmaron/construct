---
name: brand-output-vibe
description: Use when drafting or exporting customer-facing artifacts (PRD, deck, brief, runbook). Sets typography, prose rhythm, sketch diagrams, and export consistency.
inputs: [artifact-draft, export-target]
artifactType: style-guide
triggers: ["prd", "write a prd", "product requirements doc", "export", "deck", "pdf", "presentation", "artifact vibe"]
---

# Output vibe (construct-modern)

Apply this skill before drafting or exporting any customer-facing artifact (PRD, deck, brief, runbook, video script). User instructions always win; this sets the default feel.

## Typography and color

- Sans: Plus Jakarta Sans (400–700). Mono: JetBrains Mono for code, IDs, and tables.
- Monochrome ink ramp only for page furniture: near-black body (`#2c313a`), muted labels (`#545b66`), hairline rules (`#e3e4e8`). Color belongs in diagrams and data, not chrome.
- Do not stamp "Construct" on external deliverables unless the user asks.

## Prose rhythm

- Lead with a clear opening paragraph (a few connected sentences are better than a stack of fragments), then structure (headings, one compact table, selective bullets).
- Prefer longer prose that still scans: clause-bearing sentences, natural contractions (`it's`, `don't`, `we're`), and only occasional short lines for emphasis.
- Avoid bullet walls; never more than seven bullets in a row without a prose bridge.
- No spaced em dashes; refuse LLM tells, keynote sermon cadence, and Disney-movie uplift. Full bar: `rules/common/human-voice.md` and `get_skill("docs/artifact-authorship")`.

## Diagrams (D2 sketch for structure; Mermaid classic for simple flows)

- Prefer **D2** with publish `--sketch` for domains, systems, component maps, multi-persona paths, and layered models — hand-drawn strokes with clean layout. Do not put `pad:` in D2 source (it becomes a stray node); pad is a CLI/env flag only.
- Use **Mermaid classic** (Plus Jakarta Sans, field-notebook palette) only for simple linear or sequence diagrams. Do **not** use Mermaid `handDrawn` or Caveat on publish — that path is retired.
- Keep diagrams compact: short node labels; put path meaning in the caption when edge labels would collide with sketch strokes; never cross edges if a simpler chain works.
- Never allow overlapping text, nodes, or edge labels. After export, run `construct publish … --preview` and inspect every figure page; SVG label overlap is also checked via `lib/figure-layout.mjs` in tests.
- Caption every figure in one sentence that states what to notice.
- Excalidraw embeds remain optional at the tool/canvas layer, not the publish injector.

## Tables and metrics

- Use tables for metrics, acceptance criteria, and comparisons, not for narrative.
- Pin baselines and targets; cite sources or mark `[unverified]`.

## Export parity

- PDF/HTML/PPTX inherit the same fonts and ink ramp from distribution templates.
- No stock clip-art icons; use simple line icons or typographic labels.

When invoked at the start of a workflow skill, restate which vibe choices apply to this artifact type in one sentence, then proceed.
