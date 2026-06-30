---
description: Anti-fixture — content slide packed so densely that fitting it implies a sub-floor font — MUST fail auditDeckMarkdownLayout (font_below_floor).
cx_fixture_type: asset-quality-anti
---

# Deck title

Monochrome stakeholder deck

# Wall-of-text slide

This slide stacks paragraph after paragraph of uninterrupted prose, each one well past the readable limit, so that fitting the whole region onto a single sixteen-by-nine slide would force the renderer to shrink the body text far below the eight-point floor that keeps slide text legible at projection distance.

A second equally long paragraph continues the wall, repeating the same density problem, adding yet more lines that compete for the fixed vertical budget and push the implied font size lower and lower until it crosses well under the readability floor.

A third paragraph compounds the overflow, ensuring the estimated stacked height runs far beyond the slide content budget, so the implied shrink-to-fit font lands unmistakably below the floor and the audit must flag it rather than silently shipping unreadable text.

A fourth paragraph removes any doubt, piling on enough additional prose that no honest layout could fit it at a legible size on one slide while keeping every line above the readability floor that the audit defends.

A fifth paragraph keeps stacking, each sentence consuming more of the fixed vertical budget and dragging the implied shrink-to-fit font further beneath the eight-point line that separates legible slide text from an unreadable wall.

A sixth paragraph seals it, guaranteeing the estimated stacked height runs so far past the slide content budget that the only way to fit it would be a font no audience could read from across a room.

A seventh paragraph is pure overflow insurance, ensuring the implied font lands unambiguously below the floor so the font_below_floor heuristic fires distinctly and not by coincidence.
