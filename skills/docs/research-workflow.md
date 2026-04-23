<!--
skills/docs/research-workflow.md — Research Workflow — Use when: the user asks to research a topic, investigate a question, or gather e

Use when: the user asks to research a topic, investigate a question, or gather evidence for a decision. ## Steps
-->
# Research Workflow

Use when: the user asks to research a topic, investigate a question, or gather evidence for a decision.

Follow [rules/common/research.md](../../rules/common/research.md) as the default policy.

## Steps

1. **Clarify the question** — one specific, falsifiable question the research must answer.
2. **Check internal evidence first** — search `.cx/research/`, `.cx/product-intel/`, `docs/prd/`, `docs/meta-prd/`, ADRs, runbooks, and ingested artifacts before going external.
3. **Choose the research path**:
   - Library/API/framework/version questions → primary vendor docs, source code, changelogs, exact-version references
   - Market, competitive, policy, or general evidence → cx-researcher using primary sources first
4. **Use a source hierarchy**:
   - Primary: official docs, exact-version API references, standards, source code
   - Secondary: changelogs, migration guides, maintainer issue comments
   - Tertiary: blogs/forums/Q&A only to locate primaries
5. **Structure findings** using the template from `get_template("research-brief")` — resolves `.cx/templates/docs/research-brief.md` (override) then `templates/docs/research-brief.md` (shipped)
6. **Write to `.cx/research/{topic-slug}.md`** — cx-docs-keeper owns this
7. **Reference the research doc** in the requesting agent's output (link by path)

## Verification bar

- Every load-bearing claim must cite a source path, URL, or document reference.
- Record publication date, version, or access date for each source.
- Separate observation from inference.
- Name contradictions and unresolved gaps.
- Prefer two independent sources per load-bearing claim unless one authoritative primary source is sufficient.

## File naming
- Topic slug: lowercase, hyphens, no spaces — e.g., `firebase-auth-v9-migration.md`
- Date prefix for time-sensitive research: `2026-04-langfuse-v2-vs-v3.md`

## When research feeds a decision
→ Also create `.cx/decisions/ADR-{NNN}-{slug}.md` referencing the research doc

## When research feeds a PRD
→ Reference it in the PRD's References section
