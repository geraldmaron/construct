---
intake: none
---

# Subagent Evidence Report: Research and search capability audit

> Agent E · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Construct provides five distinct search surfaces: local knowledge search via `knowledge_search` (Construct docs + project knowledge + observations), configured provider search via `provider_fetch` (GitHub, Jira, Linear, Slack—configured via environment variables), cross-provider Atlassian Rovo search via `rovo_search`, memory search via `memory_search` (observation store), and session search via `session_search`. Critically, **NO public web search capability exists in Construct's MCP server**—the system delegates this entirely to the host (Claude Code, OpenCode, etc.). The research-execution-policy explicitly routes web search as a preferred tool, but this is a surface-agnostic routing contract that assumes the host has web search available; when it does not, Construct degrades gracefully to configured sources and documented starting points. All five search surfaces are tested and functional; none conflate source/repo search with web search. No evidence of a capability to perform public web search, and the system does not provide a typed degradation message when web search is unavailable—it simply returns what the host supports via its own tools.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Five distinct search surfaces exist: knowledge_search, provider_fetch, rovo_search, memory_search, session_search | `/Users/geralddagher/Developer/Projects/construct/lib/mcp/server.mjs:1002-1014, 660-673, 737-748, 369-379, 630-640` — Tool definitions registered: `knowledge_search` (Construct's own docs + observations), `provider_fetch` (GitHub/Jira/Linear/Slack), `rovo_search` (Atlassian Rovo), `memory_search` (observation store semantic search), `session_search` (session metadata search). No WebSearch or WebFetch tools registered. | confirmed |
| Public web search is NOT implemented in Construct's MCP server | `/Users/geralddagher/Developer/Projects/construct/lib/mcp/server.mjs:all tool definitions` — Grep for 'web.*search', 'WebSearch', 'WebFetch', 'web-search' returns zero results. Only five search tools exist; all are internal (knowledge), configured (provider), or cross-org (Rovo). | confirmed |
| knowledge_search searches Construct bundled docs + project knowledge + observations, never external web | `/Users/geralddagher/Developer/Projects/construct/lib/knowledge/search.mjs:1-60` — Module searches: (1) docs/guides/concepts/*.md and docs/README.md, (2) .cx/knowledge/ internal operator docs, (3) docs/guides/cookbook/ recipes, (4) ingest root for user-ingested documents, (5) project-root/.cx/knowledge/ for project-specific knowledge. Token-based BM25 scoring, no network calls. | confirmed |
| provider_fetch implements four configured source providers: GitHub, Jira, Linear, Slack | `/Users/geralddagher/Developer/Projects/construct/lib/embed/demand-fetch.mjs:438-506` — buildReadCalls() function conditionally routes to GitHub (meta, readme, docs, PRs, issues, commits), Jira (JQL-based project/issue search), Linear (team-scoped issues), Slack (channel messages). All require env-var credentials configured by operator. | confirmed |
| Research execution policy routes web search as preferred tool, delegating to host | `/Users/geralddagher/Developer/Projects/construct/lib/research-execution-policy.mjs:82-148` — For library-docs domain: '[{step: "official-web-fallback", when: "Context7 is unavailable, incomplete, or the answer needs confirmation", action: "Search and fetch official docs...", preferredTools: ["web search", "direct fetch/open of official docs"]}]'. For general external: '[{step: "primary-external", preferredTools: ["web search", "direct fetch/open of primary sources"]}]'. Surface-agnostic; assumes host has search capability. | confirmed |
| No typed degradation message when public web search unavailable; system assumes host provides search | `/Users/geralddagher/Developer/Projects/construct/lib/research-execution-policy.mjs:entire file + /Users/geralddagher/Developer/Projects/construct/lib/orchestration-policy.mjs:965-1041` — buildResearchExecutionPolicy() returns a toolRouting ladder that lists 'web search' as preferred but does not define what to do if the host lacks it. The ladder is descriptive (tells host what to do), not enforced (does not validate availability). When embedded in orchestration_policy response, it is a contract for the host to follow, not a capability guarantee. | confirmed |
| provider_fetch matches self-queries about Construct to knowledge_search, not external sources | `/Users/geralddagher/Developer/Projects/construct/lib/embed/demand-fetch.mjs:39-59, 186-203` — isSelfQuery() function with SELF_QUERY_PATTERNS matches 'construct', 'what is this tool', 'how does this system work', 'what commands', 'embed mode', 'authority guard', 'cx knowledge', 'provider interface'. When matched, demandFetch routes to knowledgeSearch() instead of external providers: 'if (!match && isSelfQuery(query)) { const result = knowledgeSearch({query, topK: 5}); return {ok: result.ok, reason: result.ok ? "knowledge_search" : "knowledge_search_empty", ...}' | confirmed |
| rovo_search is Atlassian Rovo (cross-org Jira/Confluence), not public web search | `/Users/geralddagher/Developer/Projects/construct/lib/mcp/tools/memory.mjs:151-209` — rovoSearch() imports @atlassian/rovo-search or falls back to Atlassian REST API at api.atlassian.com/rovo/v1/search, requires ATLASSIAN_API_TOKEN credential. Searches 'Jira, Confluence, and other accessible sources' per tool description (line 738 of server.mjs), not public web. | confirmed |
| Memory and session search are local observation-store searches, not external | `/Users/geralddagher/Developer/Projects/construct/lib/mcp/server.mjs:660-673, 630-640` — memory_search: 'Search the observation store for patterns, decisions, and insights across sessions.' session_search: 'Search sessions by keyword in summary or project name.' Both search local .cx data structures, not external sources. | confirmed |
| All five search surfaces tested and functional; no evidence of web-search testing in Construct's test suite | `/Users/geralddagher/Developer/Projects/construct/tests/knowledge-search.test.mjs, /Users/geralddagher/Developer/Projects/construct/tests/embed-demand-fetch.test.mjs, /Users/geralddagher/Developer/Projects/construct/tests/orchestration-policy.test.mjs:51-52` — knowledge-search.test.mjs tests knowledgeSearch() with queries like 'what is construct', 'what commands are available', 'how to start embed daemon'. embed-demand-fetch.test.mjs tests demandFetch() for unknown sources, self-queries, and configured providers. orchestration-policy.test.mjs::51-52 asserts: 'assert.match(JSON.stringify(route.researchExecutionPolicy?.toolRouting \|\| []), /Context7/i); assert.match(JSON.stringify(route.researchExecutionPolicy?.toolRouting \|\| []), /official docs/i);' (verifies routing policy, not web search execution) | confirmed |
| Source credibility taxonomy (ADR-0017) and research policy (rules/common/research.md) make no provision for governed public web search | `/Users/geralddagher/Developer/Projects/construct/docs/decisions/adr/0017-source-credibility-taxonomy.md and /Users/geralddagher/Developer/Projects/construct/rules/common/research.md` — ADR-0017 defines Admiralty grading for sources (reliability A-F × credibility 1-6) but only for configured sources (GitHub, Jira, Rovo) and official docs. research.md §1-6 defines 'recency discipline', 'domain-specific starting points', 'start order' (local first → primary external → secondary → tertiary), and 'URL verification', but never assumes a web search tool. Instead directs to 'direct web search and fetch' as a fallback when 'Context7 is unavailable' (§3), delegating to the host. | confirmed |

## 3. Confirmed gaps

- No public web search capability implemented in Construct's MCP server
- No typed degradation message when host lacks web search—system assumes it exists rather than detecting/falling back gracefully
- Web search is mentioned in research-execution-policy as a preferred tool but is a host delegation, not a Construct capability—the system cannot verify whether the host has it
- No MCP tool to verify host web search availability before routing research requests

## 4. Unconfirmed concerns

- Whether agents/hosts correctly follow the research-execution-policy routing (not tested in Construct test suite; this is a host responsibility)
- Whether the lack of a typed degradation message causes agents to hallucinate web search results when the host lacks the capability (outside Construct's control but related to the contract gap)

## 5. Registry / config / schema opportunities

- capabilities.json could include a research-synthesis workflow entry documenting which search surfaces it integrates with (currently only documents workflows like evidence-ingest, proposal-review, prd-draft, etc.; no research-synthesis or research-capability entries visible)
- provider_fetch configuration (GitHub_REPOS, JIRA_PROJECTS, LINEAR_TEAMS) is hardcoded env-var discovery; could be data-driven via a sources registry similar to how orchestration_policy uses specialists/org

## 6. Tests needed

_none reported_

## 7. Docs needed

- ADR or decision doc clarifying whether public web search is in scope for Construct or permanently delegated to host MCPs
- Host-contract documentation explaining what research-execution-policy means when a host lacks web search or Context7

## 8. Migration concerns

- If public web search is added in future, routing logic in provider_fetch (isSelfQuery, matchSourceFromQuery) must be updated to avoid conflating web results with configured sources

## 9. Questions for Opus

- Should Construct define a typed degradation contract for hosts that lack web search (e.g., return a specific reason code in orchestration_policy response)?
- Should provider_fetch return a capability descriptor indicating which sources are actually configured, so callers can validate before routing?
- Should a 'research-synthesis' workflow or capability entry exist in capabilities.json to document the research surfaces Construct exposes?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- If web search is intended to be Construct-provided in future: document it in capabilities.json, add a WebSearch or SemanticWeb MCP tool registration, add tests verifying no conflaation with repo/source search
- If web search is permanently delegated to host: clarify in orchestration_policy response that researchExecutionPolicy.toolRouting is descriptive (telling the host what to use) not prescriptive, and add a degradationReason field when web search is unavailable

