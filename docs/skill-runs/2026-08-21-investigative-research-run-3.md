# investigative-research — recorded run 3 (2026-08-21, Sonnet tier)

Run conditions: Sonnet-tier producing agent, skill file outside the
repository as its only method reference, repository forbidden, web access
on. The task was real and design-gating: survey the popular agent-skills
ecosystem to (1) test the wedge claim against collections beyond ECC,
(2) establish whether a standalone deliverable-challenge skill exists
anywhere popular, and (3) settle where the ecosystem draws the skill-vs-tool
line on context/relationship navigation — the input hypothesis H2's design
was waiting on. The deliverable below is verbatim as produced; nothing was
edited. (The producer left "(DRAFT)" in its title while shipping a complete
verification record — a label/record mismatch noted here as observed.)

The one-line verdict for the use ledger: the pre-mortem gate directly
shaped a shipping design — its warning (a static mapping skill that implies
persistence fails at the "agent forgot the map" wall) became a named
control in the context-mapping skill (an explicit no-persistence statement
and a hand-off to whatever store is present). The independence discipline
also caught and corrected a summarizer-inflated star count mid-run by
re-querying the primary API.

Findings now on the program record: every flagship collection checked
(anthropics/skills ~171k, obra/superpowers ~275k, addyosmani/agent-skills
~89k, the skills.sh leaderboard) is engineering/config-shaped or
engineering-dominant; no flagship carries a decision/deliverable-challenge
skill (the genre exists only as sub-40-star scattered repos); and every
popular context/relationship solution is a runtime tool (memory MCP ~90k,
Graphiti ~30k), with even the dedicated context-engineering skill
collection teaching how to wire external stores rather than mapping
statically.

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading).

---

# Agent Skills ecosystem survey — landscape, adversarial review, context navigation (DRAFT)

## 1. Landscape: popularity and catalog shape

Star counts pulled directly from the GitHub REST API (`api.github.com/repos/...`), a **record** class source, on 2026-08-21 — a live snapshot, not a trend line.

| Collection | Stars (2026-08-21, record) | Catalog shape |
|---|---|---|
| **anthropics/skills** | 170,707 [research: GitHub API, `api.github.com/repos/anthropics/skills`] | Mixed, small (19 skill folders): design/dev tooling (`frontend-design`, `mcp-builder`, `webapp-testing`, `skill-creator`) alongside document/comms skills (`docx`, `pdf`, `pptx`, `xlsx`, `internal-comms`, `doc-coauthoring`, `brand-guidelines`). No adversarial-review or relationship-mapping skill present. |
| **obra/superpowers** | 275,004 [research: GitHub API] — higher than anthropics/skills itself | 14 skills, entirely software-development methodology: `test-driven-development`, `systematic-debugging`, `writing-plans`, `subagent-driven-development`, `requesting-code-review`/`receiving-code-review`, `using-git-worktrees`. Zero business/analytic-shaped skills; pure engineering process. |
| **addyosmani/agent-skills** | 88,831 [research: GitHub API] | 23 skills, described by its own README as "production-grade engineering skills"; folder names (`api-and-interface-design`, `debugging-and-error-recovery`, `security-and-hardening`, `spec-driven-development`) confirm pure engineering shape. |
| **skills.sh (Vercel)** | Registry, not a repo — the `npx skills add`/`npx skills find` installer | Vercel-operated; launched 2026-01-20 [research: Vercel Changelog, "Introducing skills, the open agent skills ecosystem"]. Install leaderboard (2026-08-21 snapshot) tops with `find-skills` (3.0M), `grill-me` (920K, a joke/roast skill), `frontend-design` (800K), `grill-with-docs` (783K), `improve-codebase-architecture` (755K), TDD (729K), `agent-browser` (707K) [research: skills.sh homepage leaderboard]. Site's own category filters are React/Next.js, Design & UI, Mobile, Agent workflows, Databases, Testing, Marketing — engineering-dominant. Total catalog size (~669,670 skills as of June 2026) rests on one aggregator writeup (explainx.ai) and was not independently corroborated — held as **single-source**. |
| **ComposioHQ/awesome-claude-skills** and **VoltAgent/awesome-agent-skills** | 72,912 and 30,635 respectively [research: GitHub API] | Curated link-list aggregators, not skill collections themselves — real traction, but their "shape" is whatever they index, which is dominated by the repos above. |
| affaan-m/ECC (~241k stars) | Not re-verified, per requester's instruction [cite: requester] | Majority engineering-shaped with a lighter-weight business/analytic minority — used below only as a comparison point. |

**Reading:** every high-traction collection independently checked is engineering/config-shaped or a mixed catalog where business/process content is a minority, never a plurality. This matches, rather than contradicts, the ECC pattern the requester already holds [cite: requester]. Note obra/superpowers outstars anthropics/skills — worth knowing if "official" is being used as a popularity proxy; it currently isn't the most-starred.

## 2. Adversarial review / decision-challenge skills

**What exists in the popular collections:** nothing standalone. Superpowers' closest entries are `requesting-code-review` and `receiving-code-review` [research: `github.com/obra/superpowers/tree/main/skills`, confirmed via GitHub API contents listing] — these are code-review protocol skills (how to ask for and receive a PR review), not decision- or document-challenge skills. Anthropics/skills and addyosmani/agent-skills carry no review-challenge skill at all; addyosmani's closest is `code-review-and-quality`, again code, not deliverables.

**What exists in the long tail:** a real but small genre. Searching GitHub for repos literally named `adversarial-review` returns over a dozen independent implementations, none with meaningful traction [research: GitHub Search API, `q=adversarial-review+in:name`]:

- `alecnielsen/adversarial-review` — 34 stars (the largest found)
- `Carlos-Dominguez-faber/adversarial-review` — 28
- `prime-radiant-inc/parallel-adversarial-review` — 17 — notable because Prime Radiant is Jesse Vincent's company, the author of obra/superpowers [research: web search result describing superpowers as "built by Jesse Vincent and the rest of the folks at Prime Radiant"]. Even its own author kept this **outside** the 275k-star superpowers repo, in a separate low-traction repo. That is a direct data point against "the popular ecosystem has normalized this as part of a flagship collection."
- The rest cluster at 0–11 stars.

Distinct from these, `ecfm/adversarial-review` (1 star) [research: GitHub API] does something narrower — parallel red-team/blue-team review of academic manuscripts — closer to your differentiator (challenging a document before commitment) than to code review, but with no adoption signal at all.

Marketplace aggregators (mcpmarket.com, skills.rest, LobeHub) list a few similarly-scoped skills — "Red Team Thinking," "Red Team Claude Code Skill," a `skills.rest` entry describing itself as running "Pre-Mortems and the 'Steelman' technique" for pressure-testing proposals [research: web search result, skills.rest listing] — but these are aggregator catalog pages, not evidence of usage; none appears in the skills.sh install leaderboard, and I found no star or install count for any of them above single digits to low tens.

**Distinction the requester asked for, stated plainly:** code-review skills (present, popular, embedded in flagship collections) check a diff for bugs/style/security. Decision/deliverable-challenge skills (disconfirmation passes, pre-mortems, steelmanning a document or a plan before it ships) exist only as scattered, low-traction individual repos. No popular collection has folded one in as a first-class member. This is the clearest, best-evidenced finding in this survey — it is a genuine gap, not an artifact of where I looked (see disconfirmation below).

## 3. Context navigation: skill or tool?

The record is one-sided. Every high-traction solution for "understand how the pieces of a system relate before acting" is a **runtime tool**, not a static skill file:

- **Memory/knowledge-graph MCP servers**, real traction: `modelcontextprotocol/servers` (the official reference server collection, which includes the memory/knowledge-graph server) — 89,725 stars [research: GitHub API]. Graphiti (Zep's open-source temporal knowledge-graph framework, purpose-built for "facts have validity windows" relationship tracking) — 30,142 stars [research: GitHub API, `getzep/graphiti`].
- **Codebase-relationship tools**: `codebase-memory-mcp` and `mcp-codebase-index` build dependency graphs (functions/files/packages, call chains, change-impact) and expose them via MCP query tools rather than a document an agent reads. Their specific efficiency claims (e.g., "83% answer quality at 10x fewer tokens," "28M-line kernel indexed in 3 minutes") come only from the vendor's own blog/marketing posts (toknow.ai, aibuilderclub.com, dev.to) — **single-source, self-reported, not independently corroborated** — so I'm citing their existence and shape, not their performance numbers.
- **A dedicated "context engineering" skill collection exists** and is popular by GitHub standards — `muratcankoylan/agent-skills-for-context-engineering`, 17,784 stars [research: GitHub API]. This is the single most relevant test case for your open question, because it is a *skills* collection specifically about context. Its `memory-systems` skill is described as designing "short/long-term and graph-based memory **architectures**" [research: WebFetch of repo README/contents] — i.e., even the skill closest in subject to your question teaches how to *choose and wire up* an external memory/graph system; it does not itself perform relationship-mapping as a static procedure. No skill in that collection, or in any collection checked, attempts entity/dependency/ownership mapping as a self-contained instruction file.

**Where the ecosystem draws the line, stated as a finding:** the popular record treats "map these entities and their relationships" as inherently a state-and-retrieval problem — it needs a persistent store (graph DB, vector index, MCP server) that outlives one context window and can be queried, not a one-shot instruction set an agent reads and discards. A static skill has no place to put the map once built; the pattern that recurs across every popular tool is "index once, query repeatedly," which a SKILL.md file structurally cannot do on its own.

## Single-source list

- skills.sh total catalog size (~669,670 skills) — one aggregator (explainx.ai), no second independent source found.
- Codebase-memory-mcp / mcp-codebase-index performance claims — vendor's own posts only; not corroborated by a third party or a benchmark I could independently read.
- "obra/superpowers is more starred than anthropics/skills" — this is a plain GitHub API comparison (record vs. record), not single-source, but flagged here because it is counterintuitive enough to warrant restating: both numbers came from the same API endpoint pattern, queried independently, same day.

## Disconfirmation pass

**Hypothesis A (leaning toward):** the popular ecosystem has no standalone decision/deliverable-challenge skill, and treats relationship-mapping as a tool problem, not a skill problem.
**Hypothesis B (rival):** I simply didn't search with the right terms, and a popular collection does carry one or both under different naming (e.g. "pressure-test," "pre-mortem," "second-opinion," "sanity-check").

What would refute A, and what I went and looked for specifically: repo/skill names using "pre-mortem," "steelman," "second opinion," "sanity check," "challenge," "critique" within the three flagship collections' own contents listings (anthropics/skills, obra/superpowers, addyosmani/agent-skills) — none present in any of the three folder listings pulled directly via the GitHub Contents API. For context-mapping, I searched specifically for "relationship mapping," "who owns what," "entity mapping," and "system understanding" as skill names/descriptions and additionally inspected the one collection whose entire premise is context — none of its 17 skills perform mapping statically.

This does not fully refute B — GitHub search and web search both have blind spots (private forks, non-English names, skills embedded inside larger repos under unrelated top-level names). But the search was specific and repeated across three independent framings each, and it returned a consistent negative. I weigh this as A holding, with residual uncertainty stated below rather than hidden.

## Coverage frame and absences

This survey covers public, English-language, GitHub-indexed collections plus the skills.sh registry, as of 2026-08-21. It does not cover closed/enterprise skill marketplaces, non-English collections, or skills distributed only inside larger private repos without a discoverable name match. Absences are classified: the lack of a flagship adversarial-review skill is **not-recorded-as-absent-with-confidence** (actively searched for and not found across three collections and general search) rather than not-yet-collected; the lack of enterprise/closed-marketplace data is **not-yet-collected** — genuinely out of reach here, not evidence those marketplaces lack such skills.

## Strongest objection

Stars measure attention, not usage. Superpowers at 275k stars could be substantially viral curiosity rather than daily production use; skills.sh's install telemetry is arguably the better usage signal, and by that signal the top skills are `find-skills`, `grill-me`, and `frontend-design` — none of them touch review, challenge, or context-mapping either way, so the install-based view doesn't contradict the star-based view here, but a reader should not treat star count as proof of active use in general.

## Pre-mortem

If the requester ships a context-mapping *method* skill on the assumption this is open, uncontested territory: the failure mode is that a static skill can describe a good procedure for building a relationship map by hand (interview-style entity/dependency capture) but cannot persist or re-query that map across sessions the way every popular tool in this space does — a user who tries it once, hits the "the agent forgot the map next session" wall, and concludes the skill doesn't work, when the actual gap is architectural (no store), not procedural. Shipping a skill that explicitly hands off to a memory/knowledge-graph MCP for persistence, while owning the *method* for what to capture and how to interview for it, avoids this failure; shipping a skill that implies it replaces a memory tool does not.

## Handbacks

None. Every open sub-question here was one I could search and answer directly.

## Verification record
- Claims cited: answered — `[research: ...]` markers throughout §1–3, all against sources actually opened (GitHub REST API direct curl, Vercel changelog, skills.sh homepage, repo content listings)
- Source classes: answered — record (GitHub API repo/contents data), aggregator (explainx.ai, marketing blogs, web-search summaries) explicitly distinguished throughout, especially in §3
- Independence: answered — single-source list above; GitHub star counts cross-checked by re-querying the API directly rather than trusting a first summarized pass (caught and corrected a WebFetch-summarizer inconsistency on obra/superpowers' star count)
- Disconfirmation: answered — see "Disconfirmation pass" | reversed the draft conclusion: no (initial finding held under the refutation search)
- Coverage frame: answered — see "Coverage frame and absences"
- Ground exhausted: answered — every named repo/registry was queried directly (API or WebFetch); vendor performance claims for codebase-mapping tools were read but explicitly not relied upon due to single-source status
- Strongest objection: answered — see "Strongest objection"
- Pre-mortem: answered — see "Pre-mortem"
- Handbacks: none
