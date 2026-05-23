<!--
skills/docs/research-workflow.md (Research Workflow) Use when: the user asks to research a topic, investigate a question, or gather e

Use when: the user asks to research a topic, investigate a question, or gather evidence for a decision. ## Steps
-->
# Research Workflow

Use when: the user asks to research a topic, investigate a question, or gather evidence for a decision.

Follow [rules/common/research.md](../../rules/common/research.md) as the default policy.

## Steps

1. **Clarify the question**: one specific, falsifiable question the research must answer.
2. **Apply recency discipline**: always search from the most recent year backward. For fast-moving domains (AI tools, security, market data), treat anything older than 12 months as presumptively stale unless a newer source confirms it is still accurate.
3. **Check internal evidence first**: search `.cx/research/`, `.cx/knowledge/`, `docs/prd/`, `docs/meta-prd/`, ADRs, runbooks, and ingested artifacts before going external.
4. **Choose the research path and starting point** by domain:

   | Domain | Authoritative starting points |
   |---|---|
   | AI tools / LLM behavior / multi-agent | arXiv (cs.AI, cs.SE, cs.CL), ACL Anthology, conference proceedings (NeurIPS, ICML, ICLR, HICSS) |
   | Developer tools / IDE / adoption | Stack Overflow Developer Survey, JetBrains Developer Ecosystem Report, GitHub blog, editor changelogs |
   | Security / CVEs / supply chain | NVD, GitHub Security Advisories, OWASP, vendor security blogs (Google Project Zero, Microsoft Security), ProjectDiscovery |
   | Market data / ARR / adoption | Primary company announcements, SEC filings, then TechCrunch/Bloomberg citing company sources |
   | Cloud / API / SDK / version | Official vendor docs for exact version, changelog, migration guide |
   | Regulatory / compliance / privacy | Primary regulation text, then official agency guidance |

5. **Use a source hierarchy**:
   - Primary: official docs, exact-version API references, standards, source code, peer-reviewed papers
   - Secondary: changelogs, migration guides, maintainer issue comments, release notes
   - Tertiary: blogs/forums/Q&A only to locate primaries: never cite tertiary alone for a load-bearing claim
6. **Verify every URL**: fetch each URL cited and confirm it resolves and matches the cited claim. Mark unconfirmed URLs as `[unverified]`.
7. **Structure findings** using the template from `get_template("research-brief")`: resolves `.cx/templates/docs/research-brief.md` (override) then `templates/docs/research-brief.md` (shipped)
8. **Write to `.cx/research/{topic-slug}.md`**: cx-docs-keeper owns this
9. **Reference the research doc** in the requesting agent's output (link by path)

## Verification bar

- Every load-bearing claim must cite a verified source path, URL, or document reference.
- Record publication date, version, or access date for each source. If no date is available, state `[undated]` and treat confidence as `low`.
- Fetch and confirm every URL before including it in a committed document.
- Separate observation from inference: label each finding's confidence as `high`, `medium`, or `low`.
- Name contradictions and unresolved gaps.
- Prefer two independent sources per load-bearing claim unless one authoritative primary source is sufficient.
- State the strongest counter-evidence when one exists.

## File naming
- Topic slug: lowercase, hyphens, no spaces: e.g., `firebase-auth-v9-migration.md`
- Date prefix for time-sensitive research: `2026-04-release-comparison.md`

## When research feeds a decision
→ Also create `.cx/decisions/ADR-{NNN}-{slug}.md` referencing the research doc

## When research feeds a PRD
→ Reference it in the PRD's References section
