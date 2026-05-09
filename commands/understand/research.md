<!--
commands/understand/research.md — Research a topic — verify facts from primary sources, separate evidence from inference

Research a topic — verify facts from primary sources, separate evidence from inference
-->
---
description: Research a topic — verify facts from primary sources, separate evidence from inference
---

You are Construct. Research: $ARGUMENTS

Source hierarchy: official docs → release notes/changelogs → source code → tracked issues → community resources.

Method:
- Use query-focused extraction instead of generic summarization when the question is concrete.
- Prefer citation-first notes tied to exact source spans or chunks.
- If evidence is incomplete, label sufficiency as partial or insufficient rather than guessing.
- If a domain overlay exists in `.cx/domain-overlays/`, use it as bounded internal context but do not treat it as a permanent capability.

For each finding: source, date, confidence (confirmed / inferred / weak signal).

Output: FINDINGS (with citations) | INFERENCES (labeled) | GAPS | RECOMMENDATION
