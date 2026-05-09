<!--
rules/common/research.md — canonical research and evidence policy for Construct.

Defines how research starts, which sources to prefer, how claims are verified,
and what must be recorded so findings are reproducible. Applies to research,
product evidence synthesis, document ingest follow-up, and any recommendation
that depends on external facts or evolving internal evidence.
-->
# Research Policy

Construct treats research as a reproducible evidence-gathering process, not free-form browsing. If a claim could change decisions, scope, architecture, or roadmap, it must be tied to verifiable evidence.

## 1. Start order

Start with the narrowest authoritative source that can answer the question:

1. **Local project evidence first**
   - `.cx/research/`
   - `.cx/knowledge/`
   - `docs/prd/`, `docs/meta-prd/`, `docs/adr/`, `docs/runbooks/`
   - ingested markdown artifacts under `.cx/knowledge/`
   - repo code, tests, configs, and existing decisions
2. **Primary external sources second**
   - official docs for the exact version in use
   - source code, standards, specifications, API references, vendor security advisories
3. **Secondary sources third**
   - changelogs, migration guides, maintainer issue comments, release notes
4. **Tertiary sources last**
   - blogs, forums, Q&A, analyst summaries, AI-generated summaries

Tertiary sources may help discover primary sources. They are not sufficient evidence for load-bearing claims.

## 2. Required metadata for every source

Record:

- source title or path
- source class: internal, primary, secondary, or tertiary
- version or revision when applicable
- publication date, release date, or access date
- why this source is relevant

If a source has no date and the topic is time-sensitive, treat confidence as reduced until recency is established another way.

## 3. Verification rules

For each load-bearing claim:

- prefer **two independent sources**
- one source is acceptable only when it is the authoritative primary source for that exact fact
- separate **observation** from **inference**
- label confidence as `high`, `medium`, or `low`
- state the strongest counter-evidence or contradiction when one exists

Claims about versions, APIs, security, pricing, compatibility, regulations, and timelines must cite the exact version/date basis.

## 4. Reproducibility

Research must be reproducible by another person in the repo.

Record:

- the exact question being answered
- search terms, commands, paths, or systems queried
- inclusion/exclusion decisions
- unresolved gaps that would change the recommendation

If you cannot explain how the answer was obtained, the research is incomplete.

## 5. Evidence thresholds

Recommendations must state what evidence threshold was used.

Examples:

- feature demand threshold
- migration-risk threshold
- security severity threshold
- benchmark or performance threshold
- confidence threshold for acting now vs gathering more evidence

If the threshold is not met, the output should recommend more research, a weaker artifact, or a narrower decision.

## 6. Output standard

Research outputs should include:

- question
- method
- sources
- findings
- confidence
- open questions
- recommendation or next step

Every substantive finding should point to a source path, URL, or document reference.

## 7. Anti-patterns

Do not:

- stop at the first plausible answer
- cite a blog when the spec or source code is available
- present inference as if the source said it directly
- ignore conflicting evidence
- use stale undated material for fast-moving topics without saying so
- promote weak product evidence into committed requirements
