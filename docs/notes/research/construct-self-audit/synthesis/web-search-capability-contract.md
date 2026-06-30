---
intake: none
---

# Governed Web/Search Capability — contract (tool-contract-gate)

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Bead: `construct-rr63.5.2`
Owner decision (`construct-rr63.5.1`, 2026-06-29): **build** a governed public web/search capability
rather than leave it host-delegated. This is the Wave-2 contract; the build is gated to Wave-4 behind
Opus review (`construct-rr63.5.3`). Grounded in ADR-0017 (source credibility) and the
`schemas/mcp-tool-output.schema.json` degradation vocabulary from `construct-rr63.6.1`.

## Why this exists

Agent E confirmed Construct has **five** search surfaces — `knowledge_search`, `provider_fetch`
(GitHub/Jira/Linear/Slack), `rovo_search`, `memory_search`, `session_search` — and **no public web
search**; web search is host-delegated with no typed degradation. None of the five conflates source
search with web search today (good). A governed capability must preserve that non-conflation and add
citations, not erode either.

## Capability shape

A new MCP surface (`web_search`, long-tail / behind the `call` gateway) that performs public web
search and returns cited results.

### Inputs
| Field | Required | Meaning |
|---|---|---|
| `query` | yes | the search string |
| `claim` | yes | the claim the results are meant to support — drives ADR-0017 claim-relative classing |
| `recency` | no | freshness window (research recency discipline) |
| `domains` | no | optional domain allow/deny hints |

### Result — every item MUST carry a citation
Per ADR-0017, no result may be presented without:
- a verifiable `url` (research URL-verification rule),
- a **claim-relative class** (`internal` | `primary` | `secondary` | `tertiary`) — community content is
  admissible `primary` for sentiment/demand claims under the admissibility checklist, `tertiary` for
  factual/version/security/pricing/compatibility claims,
- an **Admiralty grade** (`reliability` `A`–`F` × `credibility` `1`–`6`, e.g. `B2`),
- a derived `confidence` (`high` | `medium` | `low`), where `high` is reserved for `A1`/`A2`/`B1`.

A result lacking a `url` + class + grade is a contract violation, not a soft warning.

## Non-conflation rule (load-bearing)

Web results are labeled `source: "web"` and are **never** merged into, or returned in place of,
`knowledge_search` / `provider_fetch` / repo results. A caller can always tell web-sourced evidence
from repo/local/configured-source evidence. The capability must not "fall back" to source search and
present it as web search — that is the exact fake-capability failure (#7) this program forbids.

## Typed degradation (no faking)

When web search cannot run — no provider configured, provider unreachable, or the host has disabled
it — the tool returns the structured envelope from `schemas/mcp-tool-output.schema.json`:

```json
{ "degraded": true, "degradationReason": "capability-unavailable" }
```

(or `server-unreachable` for a configured-but-unreachable provider). It returns **no** results and
makes **no** claim of having searched the web. The descriptive `researchExecutionPolicy.toolRouting`
remains advisory: it tells a host what to use; it never asserts the host did.

## Governance

- Provider-backed and **opt-in** (configured via env / `construct.config` `providers`), consistent
  with how `provider_fetch` surfaces configure sources.
- The capability declares itself in `registry/capabilities.json` (a `web-search` entry) so it is
  discoverable and documented — currently there is none (pinned by
  `tests/functional/mcp-output-contract.functional.test.mjs`).

## Wave-4 build (gated, `construct-rr63.5.3`, Opus review)

1. Add the `web_search` MCP tool (long-tail) with the input schema above.
2. Enforce the citation contract (class + Admiralty grade + verified URL) on every result.
3. Return the typed degradation envelope when unavailable; never conflate with source search.
4. Add the `web-search` entry to `registry/capabilities.json`.
5. Tests: **citations-required**, **no-conflation**, **typed-degradation** — these flip the
   characterizations in `mcp-output-contract.functional.test.mjs` deliberately.

## Gate status

This contract opens the path; no `web_search` code or `capabilities.json` entry lands until the
Wave-4 bead is taken under Opus review.
