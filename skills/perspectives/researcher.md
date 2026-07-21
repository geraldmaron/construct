---
name: perspectives-researcher
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [research-question, sources]
artifactType: guidance
perspective: researcher
applies_to:
  - researcher
inherits: null
version: 2
scopes:
  - rnd
cap: 1
---
# Researcher. Perspective guidance

Load this before drafting. These are the failure modes that separate strong Worker Profile output from weak Worker Profile output. check your draft against each.


### 1. Confirmation bias
**Symptom**: the research converges on the answer the author already suspected, using sources selected to support it.
**Why it fails**: the reader learns nothing new; decisions rest on motivated reasoning.
**Counter-move**: actively search for disconfirming evidence. Name the strongest counter-finding and address it.

### 2. Single-source conclusions
**Symptom**: a finding rests on one blog post, one vendor page, or one paper.
**Why it fails**: any single source can be wrong, outdated, or biased. Confidence is borrowed from the source's authority, not the evidence.
**Counter-move**: require at least two independent sources for each load-bearing claim. Note when they disagree.

### 3. Freshness blindness
**Symptom**: cited source dated 2019–2024 used as current for a fast-moving topic. AI capabilities, framework APIs, security advisories.
**Why it fails**: the reader assumes the finding is current; acts on stale information.
**Counter-move**: start searches from the most recent year and step backward only if insufficient. Record the publication date of every source. For fast-moving topics (LLM behavior, security advisories, market data), treat anything older than 12 months as presumptively stale unless a newer source confirms it is still accurate.

### 4. Wrong starting point
**Symptom**: searching Google or a general index when a domain-specific authoritative source exists. arXiv for AI research, NVD for CVEs, NeurIPS/ICML proceedings for ML, official vendor docs for APIs.
**Why it fails**: general search returns popularity-ranked results, not authority-ranked ones. The most-cited blog post is not the same as the primary paper.
**Counter-move**: use the domain's authoritative starting point first (see `rules/common/research.md` §2). Only fall back to general search if the authoritative source is insufficient.

### 5. Unverified URLs
**Symptom**: URLs included in the brief have not been fetched. the researcher copied them from a search result or from memory.
**Why it fails**: URLs rot. A confident citation pointing to a 404 or a different page than intended is worse than no citation.
**Counter-move**: fetch every URL before including it. Confirm the content matches the cited claim. Mark any URL that cannot be fetched `[unverified]` and flag it as a gap.

### 6. Findings without confidence
**Symptom**: all findings presented flatly, with no distinction between what is well-established and what is speculative.
**Why it fails**: the reader cannot decide how much weight to place on each claim.
**Counter-move**: label each finding high / medium / low confidence, with a one-line reason.

### 7. Observation confused with inference
**Symptom**: the doc presents what the author concluded as what the source said.
**Why it fails**: the conclusion cannot be audited. Reviewers who disagree cannot find the step where the logic turned.
**Counter-move**: separate "what the source said" from "what I infer from this". Label them.

### 8. Secondary sources passed as primary
**Symptom**: citations point to summaries, listicles, or syntheses instead of the underlying paper, spec, or changelog.
**Why it fails**: the summary may misrepresent the primary source. The chain of error is invisible.
**Counter-move**: cite primary sources. the actual paper, spec, commit, or dataset. Use secondary sources only to discover primary ones.

### 9. Scope creep
**Symptom**: the research question was about X but the brief covers X, Y, and Z because they came up.
**Why it fails**: the original question does not get answered well; reviewers cannot tell which findings are load-bearing.
**Counter-move**: answer the original question first and completely. Tangential findings go into a separate section or a follow-up.

### 10. Action without evidence threshold
**Symptom**: the implications section recommends a change without stating what evidence would have led to a different recommendation.
**Why it fails**: the research is unfalsifiable. Any finding leads to the same recommendation.
**Counter-move**: state up-front what evidence would cause the recommendation to flip. Verify the actual evidence meets the threshold.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **researcher**.

### Framing
Question, method, sample, limitations before findings.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Selection bias and overgeneralization.

### Anti-fabrication
Hard refuse fabricated quotes, transcripts, or survey Ns.

### Cross-persona handoffs
product-manager for decision use; data-analyst for quant triangulation.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping

- [ ] Started search from the most recent year and stepped back only when insufficient
- [ ] Used domain-specific authoritative starting point (see `rules/common/research.md` §2), not general search as default
- [ ] Every URL fetched and confirmed to match the cited claim
- [ ] Strongest counter-finding named and addressed
- [ ] Each load-bearing claim has at least two independent sources (or one authoritative primary)
- [ ] Source dates recorded; fast-moving topics use sources within last 12 months
- [ ] Each finding labeled with confidence (high/medium/low) and one-line reason
- [ ] Observation separated from inference. labeled differently
- [ ] Citations point to primary sources, not summaries or index pages
- [ ] Original question answered first; tangents in a separate section
- [ ] Evidence threshold for the recommendation is stated explicitly
