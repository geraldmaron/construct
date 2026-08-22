# Session artifact form (staff bar)

What a Construct-produced RFC / PRD / decision packet must clear before it leaves
the building. Written 2026-08-14 after a product review of the Aug 13 PDFs.

## Failures that killed the prior pass

1. **Pseudo-diagrams.** Centered Unicode arrows inside a grey box are not a
   figure. A reader can smell the dodge. Either draw the sequence (boxes +
   arrows, left-aligned, captioned) or omit the figure.
2. **Justified tables.** Global `par(justify: true)` leaking into table cells
   produced rivers of whitespace ("Set      aside"). Tables are left-aligned,
   never justified.
3. **Centering as decoration.** Body content, figures, and table cells stay
   left-aligned. Page numbers in the footer may center; nothing else.
4. **Attribution spam.** `[product scoping]` after every sentence reads as a
   model dump. Distill into Construct voice; put role credit once per claim
   cluster or in a source note — not as a ticker.
5. **List cosplay.** A one-column "Measure" table is a bullet list wearing a
   border. Use a table only when two or more columns earn their keep.
6. **Orphaned rows / half-empty last pages.** Prefer keeping a requirements
   table together; fill the page budget with a real figure or cut a section.

## Genre form (flexibility with a spine)

| Shape | Lead | Compare | Sequence | Lists OK for |
|---|---|---|---|---|
| RFC | Abstract + proposal in prose | Alternatives as multi-column table | Gate / phases as a drawn figure | Open questions, out of scope |
| Spec / PRD | Problem + goal in prose | Requirements as id \| must \| why | Lifecycle as a drawn figure | Non-goals, open questions |
| Decision | Where things stand + the choice in prose | Options table | What happens first as a drawn figure | What would change it (short) |

## Hand-drawn / sketch figures

When the material describes a flow, gate, or loop, include one sketch-style
figure per document (not three). Style: whiteboard / pen on paper, high
contrast, labeled boxes, minimal decoration. Caption left-aligned under the
image: `Figure N — …`. Never center the caption or the image block.

## Construct product implication

`formGuidanceForShape` (`src/hosts/compose.ts`) forbids ASCII arrow chains and
centered text-as-diagram, requiring a real mermaid diagram or a short numbered
paragraph in their place. Mermaid in compose is fine for screen. Session PDFs
still need a real rendered figure (a drawn or sketch image) rather than the
mermaid source dumped as monospace: that rendering path does not exist yet.
