<!--
rules/common/research.md: canonical research and evidence policy for Construct.

Defines how research starts, which sources to prefer, how claims are verified,
and what must be recorded so findings are reproducible. Applies to research,
product evidence synthesis, document ingest follow-up, and any recommendation
that depends on external facts or evolving internal evidence.
-->
# Research Policy

Construct treats research as a reproducible evidence-gathering process, not free-form browsing. If a claim could change decisions, scope, architecture, or roadmap, it must be tied to verifiable evidence.

## 1. Recency discipline

Research always starts from the most recent available evidence.

- Default to sources from the current year before earlier years: always search most-recent-first.
- For fast-moving topics (AI tools, LLM behavior, cloud APIs, security advisories, market data), treat anything older than 12 months as presumptively stale unless a newer source confirms it is still accurate.
- When using a search engine or index, always filter or sort by date: do not rely on relevance ranking alone.
- State the publication or access date for every external source. If a source has no date, treat its confidence as `low` until recency is established another way.

## 2. Domain-specific starting points

Use the narrowest, most authoritative starting point for the research domain:

| Domain | Starting points (most recent first) |
|---|---|
| AI tools, LLM behavior, multi-agent | arXiv (cs.AI, cs.SE, cs.CL), ACL Anthology, NeurIPS/ICML/ICLR proceedings, then vendor research blogs |
| Developer tools, IDE, editor | Stack Overflow Developer Survey (current year), JetBrains Developer Survey, GitHub/Copilot blog, then product changelogs |
| Security, CVEs, supply chain | NVD, GitHub Security Advisories, OWASP, vendor security blogs (Google Project Zero, Microsoft Security Response), then ProjectDiscovery/Snyk reports |
| Market data, adoption, ARR | Primary company announcements or SEC filings, then TechCrunch/Bloomberg/WSJ (where citing company sources), then analyst reports |
| Cloud infra, APIs, SDKs | Official vendor docs for the exact version, changelog, migration guides |
| Regulatory, compliance, privacy | Primary regulation text, then official guidance from the issuing authority, then law firm analysis |

Tertiary sources (blogs, forums, Q&A, AI-generated summaries) may help locate primaries. They are not sufficient evidence for load-bearing claims.

## 3. Start order

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

## 4. Required metadata for every source

Record:

- source title or path
- source class: internal, primary, secondary, or tertiary
- version or revision when applicable
- publication date, release date, or access date
- why this source is relevant

## 5. URL verification

Every URL cited in a committed document must be verified before the document is published.

- Fetch the URL. Confirm it resolves and the content matches the cited claim.
- Do not cite aggregate or index pages (e.g., arxiv.org search results, Google Scholar listings) for quantitative claims: cite the specific paper or article URL.
- If a URL returns a 404, paywall, or redirect loop, find the canonical source or replace the citation.
- Unverified URLs must be marked `[unverified]` until confirmed.

## 6. Verification rules

For each load-bearing claim:

- prefer **two independent sources**
- one source is acceptable only when it is the authoritative primary source for that exact fact
- separate **observation** from **inference**
- label confidence as `high`, `medium`, or `low`
- state the strongest counter-evidence or contradiction when one exists

Claims about versions, APIs, security, pricing, compatibility, regulations, and timelines must cite the exact version/date basis.

## 7. Reproducibility

Research must be reproducible by another person in the repo.

Record:

- the exact question being answered
- search terms, commands, paths, or systems queried
- inclusion/exclusion decisions
- unresolved gaps that would change the recommendation

If you cannot explain how the answer was obtained, the research is incomplete.

## 8. Evidence thresholds

Recommendations must state what evidence threshold was used.

Examples:

- feature demand threshold
- migration-risk threshold
- security severity threshold
- benchmark or performance threshold
- confidence threshold for acting now vs gathering more evidence

If the threshold is not met, the output should recommend more research, a weaker artifact, or a narrower decision.

## 9. Output standard

Research outputs should include:

- question
- method
- sources (with dates and classes)
- findings
- confidence
- open questions
- recommendation or next step

Every substantive finding should point to a verified source path, URL, or document reference.

## 10. Anti-patterns

Do not:

- start research from older years when more-recent sources are available
- stop at the first plausible answer
- cite a blog when the spec or source code is available
- cite an aggregate or index page when the specific document is available
- present inference as if the source said it directly
- ignore conflicting evidence
- use stale undated material for fast-moving topics without saying so
- promote weak product evidence into committed requirements
- include URLs that have not been fetched and confirmed
