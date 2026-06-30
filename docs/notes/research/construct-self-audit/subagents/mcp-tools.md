---
intake: none
---

# Subagent Evidence Report: MCP tool and discovery audit

> Agent D · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Construct's MCP server implements a well-structured two-tier tool surface (16-item flat core plus 59 long-tail via call gateway) with semantic discovery via find_tool. All 75 tools have registered inputSchemas; no outputSchemas are formally defined. Tool-name recovery tolerantly handles gateway aliases and host prefixes, with misses recorded to .cx/observations/. The ADR-0048 implementation closely matches its specification. Discrepancies are minimal: 75 tools in ALL_TOOL_DEFS split 16 core plus 59 long-tail; 75 documented tool headings; zero dispatch/advertisement mismatches; tests cover parity between registry and docs, input schemas, tool discovery ranking, and dispatch coverage. Two structural gaps: no formal outputSchema definitions in tool registrations (outputs described textually only) and docs lack comprehensive return-value guidance on most tools.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Core tool surface: 16 tools (flat) plus 1 gateway (call) plus 1 discovery (find_tool) equals 18 of 75 advertised in ListTools. | `lib/mcp/server.mjs:1323-1356` — CORE_TOOL_NAMES set defined at lib/mcp/server.mjs:1323-1328 contains orchestration_policy, get_skill, get_template, search_skills, knowledge_search, memory_search, project_context, summarize_diff, find_tool, author_artifact, document_export, publish_run, artifact_workflow, workflow_invoke, triage_recommend, orchestration_readiness. CONSTRUCT_CALL_TOOL (name: call) at line 1338. Node analysis confirmed: 75 total advertised, 16 core, 59 long-tail. | confirmed |
| find_tool semantic discovery implements hybrid BM25 plus embedding ranking with graceful degradation to BM25-only when embedding model unavailable. | `lib/mcp/tools/find-tool.mjs:49-86` — lib/mcp/tools/find-tool.mjs lines 49-86 implement hybrid scoring. Lines 24-47 compute cosine similarity and merge with normalized BM25. Line 30: degraded embeddings skipped to preserve offline safety. Line 51 returns clean error on empty query. Functional test (tests/functional/find-tool.functional.test.mjs:53-56) verifies BM25-only path returns ranked tools without error. | confirmed |
| All 75 registered tools dispatch correctly with zero mismatches between ALL_TOOL_DEFS and CallTool handler branches. | `tests/mcp-tools-list-coverage.test.mjs:52-64` — Verified via mcp-tools-list-coverage test (tests/mcp-tools-list-coverage.test.mjs:52-57): extractDispatchedNames and extractAdvertisedNames both yield 75 names, no missing or orphaned entries. Test passed: 'every dispatched MCP tool is advertised in ListTools' and 'no ListTools entry advertises a name the dispatcher does not handle'. | confirmed |
| Tool documentation fully covers all 75 registered tools with no stale or undocumented entries. | `docs/guides/reference/mcp-tools.md (832 lines, 75 headings) and tests/mcp-tools-doc-parity.test.mjs` — mcp-tools-doc-parity test (tests/mcp-tools-doc-parity.test.mjs) passed: 75 tool headings in docs/guides/reference/mcp-tools.md match ALL_TOOL_DEFS registry. Test lines 42-54 verify 'every registered MCP tool has a doc entry' and 'no doc entry references a tool that is no longer registered', both passing. | confirmed |
| Tool-name recovery layer tolerantly recovers construct_call alias and host prefixes, recording all misses for observability. | `lib/mcp/tool-recovery.mjs and lib/mcp/server.mjs:1520-1527` — lib/mcp/tool-recovery.mjs lines 20-33 implement isGatewayName (checks call and construct_call), stripHostPrefix (removes construct-mcp_ prefix), and recoverToolName (returns {gateway: true} or {name: stripped}). recordToolNameMiss (lines 35-44) appends miss records to .cx/observations/tool-name-misses.jsonl with timestamp and recovery status. Server.mjs line 1521-1527 invokes recovery on unknown names. | confirmed |
| Every advertised tool has type: object inputSchema with description, enforced by test. | `tests/mcp-tools-list-coverage.test.mjs:66-75` — mcp-tools-list-coverage.test.mjs:66-75 verifies inputSchema contains type: 'object' and non-empty description. Test extracts tool blocks via regex and checks both conditions. Passed: 'every advertised tool has type: object inputSchema with at least a description'. | confirmed |
| No formal outputSchema definitions registered in tool definitions; all outputs described textually in docs only. | `lib/mcp/server.mjs (grep outputSchema yields 0 results)` — Grep for 'outputSchema' in lib/mcp/ yields zero hits in tool registration code. lib/embedded-contract/workflow-defs.mjs uses outputSchema for workflow contracts (not MCP tools). Tool returns documented informally: scan_file returns {secrets, quality_issues, clean} (line 61 of mcp-tools.md); cx_trace returns {trace_id} (line 329); most tools lack formal return specs. | confirmed |
| Docs provide output shape guidance on only 2 of 75 tools (scan_file and cx_trace) via inline 'Returns:' clauses. | `docs/guides/reference/mcp-tools.md:61, 329` — Grep 'Returns:' in docs/guides/reference/mcp-tools.md yields 2 matches (lines 61, 329). scan_file documents {secrets, quality_issues, clean}; cx_trace documents {trace_id}. Remaining 73 tools lack explicit return-value documentation in reference guide. | confirmed |
| Structured error handling via { error: string } pattern applied consistently across tool implementations. | `lib/mcp/tools/find-tool.mjs:51 and lib/mcp/tools/document.mjs:35, 64, 97` — Grep { error in lib/mcp/tools/*.mjs shows: find-tool.mjs:1, document.mjs:6, orchestration-run.mjs:9, scope.mjs:14, skills.mjs:13, project.mjs:6, storage.mjs:3, memory.mjs:3. Example: find-tool.mjs:51 returns {error: 'find_tool requires a query...'} on empty input. No formal ErrorSchema in MCP definitions; errors surface as { error: message_string } in tool responses. | confirmed |
| ADR-0048 (semantic-tool-discovery) implementation matches specification: find_tool added to core, call gateway description lists namespaced groups instead of full catalog, enum constrains names to prevent hallucination. | `docs/decisions/adr/0048-semantic-tool-discovery.md and lib/mcp/server.mjs:1338-1353` — ADR-0048 Decision section (lines 22-29) specifies: add find_tool, shrink core to universal entry points, keep call executor with tolerant recovery, list namespaced groups. Implementation note (lines 67-72) confirms reuse of ranking layer from lib/storage/embeddings.mjs, embedding engine from lib/storage/embeddings-engine.mjs. Verified: call description at server.mjs:1340-1344 lists 'Long-tail tool groups' and points to find_tool; enum at line 1348 constrains to LONG_TAIL_DEFS names. | confirmed |
| Gateway enum ( call inputSchema.properties.tool.enum ) statically lists all 59 long-tail tool names for host-side name validation and complete visibility. | `lib/mcp/server.mjs:1330, 1348` — server.mjs:1348 enum: LONG_TAIL_DEFS.map((t) => t.name). LONG_TAIL_DEFS = ALL_TOOL_DEFS.filter((t) => !CORE_TOOL_NAMES.has(t.name)) at line 1330. Enum preserves complete visibility at approx. 1 token per name (per ADR-0048 Consequences, line 57). Test host-mcp-emulation.functional.test.mjs confirms enum is enumerated and reachable. | confirmed |
| find_tool returns full inputSchema for each ranked tool, enabling direct invocation without requiring call gateway lookup. | `lib/mcp/tools/find-tool.mjs:74-79` — find-tool.mjs:74-79 constructs result with name, description, inputSchema, score for each top-k tool. Functional test (find-tool.functional.test.mjs:40-46) verifies 'find_tool returns full schemas and a how-to-invoke note': asserts first.inputSchema is object type and note explains call gateway invocation. | confirmed |
| Tool timeout enforcement on every MCP call with configurable override (CONSTRUCT_MCP_TOOL_TIMEOUT_MS), default 120s. | `lib/mcp/server.mjs:1545-1577` — server.mjs:1545-1548 defines TOOL_TIMEOUT_MS, honors env var or defaults to 120000ms. Lines 1564-1577 wrap dispatch in Promise.race with timeout, catch timeout error cleanly. Prevents stalled tools from blocking client indefinitely. | confirmed |
| Trace context propagation (W3C traceparent) extracted from MCP params._meta and passed through tool calls, isolated to prevent failures. | `lib/mcp/server.mjs:1535-1539` — server.mjs:1535-1539 extracts trace context from request.params._meta, wrapped in try-catch to prevent malformed traces from breaking dispatch. Comment: 'Tracing must never break dispatch'. | confirmed |

## 3. Confirmed gaps

- OutputSchema definitions: No MCP tool registration includes outputSchema field. Outputs described only in textual docs (2 of 75 tools have inline Returns clauses). A schema definition would enable host-side response validation and agent planning.
- Output return-value documentation: 73 of 75 tools lack explicit structured return-value docs in reference guide. Only scan_file and cx_trace document Returns: {...}. Most tools describe output only in prose descriptions.
- Semantic model fallback observability: find_tool silently degrades from embedding+BM25 to BM25-only when model unavailable. No explicit signal in response to indicate which ranking path executed (semantic vs lexical-only).
- Test coverage gaps: No dedicated test suite verifies find_tool ranking accuracy on cross-domain queries or adversarial/edge-case queries beyond the 4 functional tests (export, prd, publish, empty query).
- Tool discovery completeness: find_tool is limited to static corpus (tool name + description). It cannot rank by implementation type (read-only vs action), cost (token budget), or approval requirements (broker-gated). Discoverer has no way to filter by these axes.
- Long-tail tool error patterns: No systematic error contract across long-tail tools. Error shapes vary from {error: string} to ad-hoc structures. No error codes, typed discriminants, or standardized payload shapes for structured error handling.

## 4. Unconfirmed concerns

- Tool schema mutation risk: MCP spec requires immutable tool schemas per session. If find_tool corpus grows (new tools added at runtime), embeddings cache (toolVectorCache at find-tool.mjs:12) may become stale mid-session or across daemon restarts. Unclear if ADR-0048 or implementation notes address lifecycle.
- Embedding model provisioning: ADR-0048 implies 'local Xenova ONNX 384d' is the default embedding engine. Actual provisioning path, fallback order, and conditions for 'model unavailable' are in embeddings-engine.mjs, not audited here.
- Recovery telemetry completeness: recordToolNameMiss appends to .cx/observations/tool-name-misses.jsonl. No evidence of alerting, analysis, or remediation workflow when misses accumulate (e.g., detecting a systematic hallucination pattern).
- Dispatch latency under load: Tool timeout defaults to 120s, but no evidence of request queuing, adaptive backoff, or circuit-breaker patterns when tools are slow or stuck. Timeouts fail hard; no graceful degradation.
- Cross-tool contract validation: workflow_contract_validate enforces producer-to-consumer handoffs, but no automated check validates tool-to-tool compatibility (e.g., tool A's output schema as input to tool B). Humans must verify.
- Gateway input validation: call gateway constrains tool name to enum, but args are unchecked additionalProperties. Malformed args are silently passed to dispatch and caught only if the tool's handler validates or crashes.

## 5. Registry / config / schema opportunities

- Define outputSchema registry: Add optional outputSchema field to ALL_TOOL_DEFS. Use JSON Schema references to a schemas/ directory (like artifact workflows do). Hosts can validate tool responses against expected shape.
- Tool metadata expansion: Extend tool definitions with cost (token budget), approval_required (boolean), read_only (boolean), tags (array). find_tool could then rank by relevance + availability + cost. Enables cost-aware and policy-aware discovery.
- Error schema manifest: Create tools/error-schemas.json or add errorSchema field to tool defs. Define discriminants (errorCode, reason, details) instead of ad-hoc {error: string}. Hosts and agents can parse errors programmatically.
- find_tool result ranking metadata: Return {tools: [...], rankingMethod: 'embedding+BM25' | 'BM25-only', rankingNote: '...'}. Signals degradation to consumers so they can adjust confidence or retry with fallback.
- Tool deprecation/versioning: Add status field ('active' | 'deprecated' | 'experimental') and version to tool defs. Allows find_tool to prefer active versions and warn on deprecated tools.
- Test suite for find_tool edge cases: Add queries that span multiple tool families (e.g., 'show me both storage and document tools'), domain-specific queries (e.g., healthcare, finance), and adversarial inputs (e.g., jailbreak attempts). Measure recall and precision.
- Telemetry aggregation on tool-name-misses.jsonl: Create a dashboard or periodic report that rolls up missed names, recovery success rate, and patterns (e.g., 'construct_call is attempted 50 times/day despite call being the correct name'). Surface to stakeholders for UX improvement.

## 6. Tests needed

- find_tool cross-family queries: Verify find_tool ranks correctly when query spans multiple tool namespaces (workflow_*, document_*, storage_*), ensuring no single family dominates the ranking unfairly.
- find_tool off-by-one and typo resilience: Test queries with common typos (e.g., 'documnet_export', 'publish_run' as 'pub_run'), verify tool still surfaces in top-5 via BM25.
- Tool timeout enforcement under load: Integration test with slow tool (sleeps > 120s) to verify timeout fires and clean error returned, not a hung connection.
- Tool dispatch error shape consistency: Scan all error returns across tools (via grep {error in lib/mcp/tools/*.mjs) and verify all follow {error: string} pattern, no exceptions.
- Call gateway enum sync: Test that call.inputSchema.properties.tool.enum exactly matches KNOWN_TOOL_NAMES at runtime; fails if enum drifts.
- Recovery telemetry round-trip: Invoke a known tool via a misspelled name (e.g., 'summarize_diff' as 'summarize_duff'), verify recovery succeeds, and verify tool-name-misses.jsonl entry is recorded.
- find_tool corpus cache invalidation: Restart MCP server with new tool added to ALL_TOOL_DEFS, verify find_tool can rank new tool on first query (cache invalidates on size change).
- OutputSchema validation (future): Once outputSchemas are added, write end-to-end tests validating tool responses against their registered schemas; fail if response schema mismatches definition.

## 7. Docs needed

- Output schema reference: For each tool (or at least high-frequency tools), add a 'Returns' or 'Output' section in docs/guides/reference/mcp-tools.md describing the response shape (JSON structure, field types, example).
- find_tool usage guide: Add docs/guides/how-tos/find-tool-discovery.md with examples of queries (natural language descriptions), expected rankings, when to use find_tool vs direct calls, and how semantic ranking works.
- MCP error handling guide: docs/guides/concepts/mcp-error-handling.md explaining the {error: string} pattern, how to detect errors, when errors are transient vs fatal, and recommended client-side retry logic.
- Tool metadata / capability matrix: Table in docs/guides/reference/mcp-tools.md showing which tools read-only vs action, which require approval, estimated token cost, and dependencies. Helps agents choose efficiently.
- Gateway aliasing and name recovery: docs/guides/how-tos/construct_call-fallback.md explaining construct_call → call recovery, construct-mcp_ prefix stripping, and how missed names are recorded and used for observability.
- ADR-0048 implementation notes: Expand docs/decisions/adr/0048-semantic-tool-discovery.md with: actual embedding model path, fallback order, cache invalidation policy, and migration path if embedding engine changes.

## 8. Migration concerns

_none reported_

## 9. Questions for Opus

- Should outputSchema be added to the MCP tool registry, or does the project intentionally defer response schema validation to client/host layer?
- Is the embedding model for find_tool truly offline via Xenova ONNX, or does it fall back to a remote service? If remote, what is the SLA and fallback?
- Tool metadata (cost, approval_required, read_only) expansion would enable policy-aware discovery. Is this a planned follow-up to ADR-0048, or out of scope?
- What is the intended use of tool-name-misses.jsonl? Is there a monitoring dashboard or periodic analysis workflow that surfaces patterns to improve UX?
- The long-tail error handling is ad-hoc ({error: string}). Should there be a formal MCP error contract (e.g., {error: {code, message, details}})? Is this upstream MCP SDK scope?
- Should find_tool return a ranking_method field or confidence score to signal degradation (embedding+BM25 vs BM25-only) to the caller?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

_none reported_

