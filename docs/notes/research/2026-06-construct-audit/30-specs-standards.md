---
intake: none
---

# 30 — Specs & Standards: MCP, AGENTS.md, ACP, Multi-Lab Tool Design

Date: 2026-06-09 · Branch: research/capability-registry · Bead: construct-qd8p
Part of the Construct Challenge-Everything Audit. Methodology, evidence rules, and the
per-area template are defined in `00-methodology.md` (this doc follows them exactly).

Scope: judge Construct against four external standards — the MCP specification, the
AGENTS.md standard, the Agent Client Protocol (ACP), and tool-design guidance synthesized
across multiple labs (Anthropic, OpenAI, and a non-frontier/community tier). Every
load-bearing claim cites a primary source (URL or repo path:line). Inferences are labeled
`INFERENCE:`. Facts not in a source are marked `[unverified]`.

---

## Established facts about Construct (cited to repo, used across all four sections)

- construct-mcp exposes a **curated flat core of 7 tools** plus **one dispatcher**
  (`construct_call`). Core set: `orchestration_policy`, `get_skill`, `search_skills`,
  `knowledge_search`, `memory_search`, `project_context`, `summarize_diff`
  (`lib/mcp/server.mjs:1223-1226`). `exposedTools()` returns the 7 core defs +
  `construct_call` = **8 tools on the wire** (`lib/mcp/server.mjs:1257-1259`).
- The full catalog `ALL_TOOL_DEFS` begins at `lib/mcp/server.mjs:126`; the dispatch table
  `dispatchToolByName` contains **69 `name ===` branches** (reproduce:
  `grep -c "name ===" lib/mcp/server.mjs`). `LONG_TAIL_DEFS` = every tool not in the core
  set (`lib/mcp/server.mjs:1234`), i.e. ~61–62 long-tail tools collapsed behind the
  dispatcher (the audit prompt's "61" figure is consistent with this count).
- `construct_call` constrains its `tool` argument to an **enum of the long-tail tool names**
  and carries a **compact one-line catalog** ("`- name — first sentence`") in its
  description instead of the full schemas (`lib/mcp/server.mjs:1241-1255`). The stated
  rationale in-code: "≈1 token each — kills hallucinated names, the key small-model lever"
  and "the description carries a compact one-line catalog instead of ~10k of full schemas"
  (`lib/mcp/server.mjs:1236-1246`).
- Dispatch is shared: the direct `tools/call` path and `construct_call` both re-enter
  `dispatchToolByName`, guarded against self-recursion (`lib/mcp/server.mjs:1263-1268`).
- Construct ships an ACP server at `lib/acp/server.mjs`. Its header documents the methods it
  implements: "`initialize`, `session/new`, `session/prompt`, `session/cancel`; progress
  streams as `session/update` notifications" (`lib/acp/server.mjs:12-13`). The
  `agent_message_chunk` update type and `promptCapabilities: { image: false, audio: false,
  embeddedContext: true }` are emitted at `lib/acp/server.mjs:48` and `:81`. `construct acp`
  runs this over stdio (established fact from the audit prompt; deeper code claims are
  marked `[unverified]` per scope).

---

## 1. MCP specification — judging the dispatcher/gateway pattern

### Current

construct-mcp presents **8 tools** (7 flat core + `construct_call`) and routes ~61 long-tail
tools through the single `construct_call({tool, args})` dispatcher, with `tool` constrained
to an enum and a one-line catalog in the description
(`lib/mcp/server.mjs:1223-1259`). Construct does **not** implement `tools/list` pagination,
the `listChanged` capability, or dynamic tool filtering — `setRequestHandler(ListToolsRequestSchema, ...)`
returns the same flat `exposedTools()` array unconditionally (`lib/mcp/server.mjs:1261`).

### What the MCP spec actually says

The spec is a wire protocol; it is **silent on tool count** and does **not** name the
dispatcher/gateway pattern at all — it neither endorses nor forbids it. What it *does*
specify is the machinery a server is expected to use when its surface is large:

- **`tools/list` is paginated.** "To discover available tools, clients send a `tools/list`
  request. This operation supports pagination." Pagination is cursor-based: the response
  carries an optional `nextCursor`; the client continues by re-issuing `tools/list` with
  that cursor. Clients **MUST NOT** assume a fixed page size and **MUST** treat cursors as
  opaque. (Tools page; Pagination utility.)
- **Dynamic discovery via `listChanged`.** "Servers that support tools **MUST** declare the
  `tools` capability," and `listChanged` "indicates whether the server will emit
  notifications when the list of available tools changes." When it changes, such servers
  **SHOULD** send `notifications/tools/list_changed`, prompting the client to re-list. This
  is the spec's blessed mechanism for a tool surface that grows/shrinks with context.
- **Tool names** SHOULD be 1–128 chars, case-sensitive, `[A-Za-z0-9_.-]`, and unique within
  a server. `inputSchema` **MUST** be a valid JSON Schema object. (Tools page, "Tool Names"
  / "Data Types".)
- **Tool annotations exist and are first-class** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`, `title`) but clients **MUST** treat them as untrusted
  unless from a trusted server. (Tools page, annotations.)
- The MCP **server-instructions** guidance (the closest the project itself comes to "writing
  effective tools") explicitly recommends behavioral steering such as "Always prefer
  `search_*` tools over `list_*` tools when possible" and "process large datasets in batches
  of 5–10 items," and notes some models "benefit significantly from explicit guidance."
- Servers **SHOULD** "return tools in a deterministic order to enable clients to reliably
  cache the tool list and improve LLM prompt cache hit rates."

### Verdict on the dispatcher

**Tolerated, not endorsed, and not an anti-pattern *in the spec* — but it sidesteps two
spec-blessed alternatives.** Nothing in the MCP spec prohibits a meta-tool whose `tool`
parameter is a constrained enum; it is a legal tool with a valid `inputSchema`. However, the
spec's intended answer to "I have 68 tools and don't want to front-load them all" is
**(a) `tools/list` pagination** and/or **(b) dynamic discovery via `listChanged`** — not a
hand-rolled dispatcher. The dispatcher achieves the *same goal the spec designed pagination
and `listChanged` for* (small front-loaded surface, full reachability) but does so **outside
the protocol**, which has costs: a generic MCP client cannot enumerate the 61 long-tail
tools via `tools/list`, cannot read their individual `inputSchema`s, cannot apply per-tool
annotations (`readOnlyHint`/`destructiveHint`), and cannot render per-tool confirmation UI —
all of the long tail looks like one opaque `construct_call` to the host. The spec's
"human-in-the-loop SHOULD deny tool invocations" and "show tool inputs to the user before
calling" guidance is weakened because the host only sees `{tool: "...", args: {...}}`.

`INFERENCE:` The in-code rationale (enum kills hallucinated names; one-line catalog beats
~10k of schemas) is a **real, defensible local-model optimization** that the spec does not
provide a clean equivalent for — pagination still requires the client to drive multiple
round-trips and most current hosts don't paginate aggressively, and `listChanged` requires
the server to *know* which subset to surface per turn. So the dispatcher is best read as a
pragmatic workaround for **gaps in host support for the spec's own mechanisms**, not a
rejection of the spec.

### Spec-blessed alternative that preserves the local-model win

`INFERENCE:` A hybrid is available: keep the enum-constrained dispatcher as the *default* low
surface, **but also** wire `tools/list` pagination + `listChanged` so spec-conformant hosts
that want full per-tool schemas/annotations can opt into the real tools. This is additive —
the dispatcher stays for thin/local hosts, the protocol path lights up for rich hosts.

---

## 2. AGENTS.md standard

### Current

Construct "emits AGENTS.md / CLAUDE.md marker blocks" (audit prompt; the emit path itself is
`[unverified]` in this doc — not read in depth here). The judgment below is the standard's
prescription vs. what marker-block emission implies.

### What the standard prescribes

- **Plain Markdown, no required schema.** "AGENTS.md is just standard Markdown. Use any
  headings you like; the agent simply parses the text you provide." No required frontmatter,
  no required fields. (agents.md.)
- **File name and placement:** the file is `AGENTS.md` at the **repository root**; nested
  copies are allowed per subproject and **"the closest AGENTS.md to the edited file wins."**
  (agents.md.)
- **Recommended (optional) sections:** project overview, build/test commands, code style,
  testing instructions, security considerations, commit/PR guidelines, deployment steps.
- **One file, many agents.** The whole point is a *single* instructions file read by 25+
  agents (Claude Code, Codex, Cursor, Gemini CLI, Copilot, Devin, etc.); the standard does
  **not** prescribe tool-specific variants. Where a tool needs pointing at it, that's the
  tool's own config (e.g. Aider `read: AGENTS.md`, Gemini CLI `"fileName": "AGENTS.md"`).
- Now stewarded by the **Agentic AI Foundation under the Linux Foundation**.

### Verdict

**Conformant in spirit if marker blocks are idempotent, non-destructive, and additive; at
risk on two points the standard cares about.**

1. **Single-file ethos vs. CLAUDE.md duplication.** The standard's explicit value is *one*
   `AGENTS.md` for all agents; emitting a parallel `CLAUDE.md` reintroduces the
   tool-specific fragmentation AGENTS.md exists to kill. The standard does not bless
   `CLAUDE.md`; "No mention of CLAUDE.md exists in this document" (agents.md fetch).
   Construct's own repo runs the opposite pattern internally (it has a `CLAUDE.md`, not an
   `AGENTS.md`), which is a conformance smell for a tool that claims platform-agnosticism.
   `INFERENCE:` Best practice is to make `AGENTS.md` the source of truth and have Claude
   Code read it directly (Claude Code is on the supporting-tools list), or generate
   `CLAUDE.md` as a thin pointer to `AGENTS.md` rather than a duplicate body.
2. **Marker blocks must respect "closest file wins" and user content.** Because Markdown has
   no schema, the only safe way to co-own a user's `AGENTS.md` is an explicitly delimited, [source: Evidence section of this document]
   regenerable block that never clobbers prose outside it. `INFERENCE:` If the marker block
   is idempotent and bounded, emission is conformant; if it rewrites the whole file or
   fights a nested per-package `AGENTS.md`, it violates the "closest file wins" rule.
   (Block behavior is `[unverified]` here.)

---

## 3. Agent Client Protocol (ACP)

### Current

`lib/acp/server.mjs` advertises itself as an ACP server for Zed/JetBrains and implements
(per its own header): `initialize`, `session/new`, `session/prompt`, `session/cancel`, and
`session/update` notifications carrying `agent_message_chunk`; capabilities declared are
`promptCapabilities: { image: false, audio: false, embeddedContext: true }`
(`lib/acp/server.mjs:12-13,48,81`). Deeper behavior is `[unverified]` per scope.

### What ACP v1 requires (primary source: agentclientprotocol.com)

ACP is JSON-RPC 2.0 with Methods (request/response) and Notifications (one-way), the agent
running as a subprocess of the editor. The surface:

**Agent methods**
- `initialize` — "Negotiate versions and exchange capabilities" (**baseline/required**).
- `authenticate` — auth if required (**required if the agent advertises an auth method**).
- `session/new` — "Create a new conversation session" (**baseline/required**).
- `session/prompt` — "Send user prompts to the Agent" (**baseline/required**).
- `session/load` — load existing session (**capability-gated:** `loadSession`).
- `session/set_mode` — switch agent operating modes (**optional**).
- `logout` — (**capability-gated:** `auth.logout`).

**Client methods (the agent calls these on the editor)**
- `session/request_permission` — "Request user authorization for tool calls"
  (**baseline/required** on the client side).
- `fs/read_text_file`, `fs/write_text_file` — (**capability-gated:** `fs.readTextFile` /
  `fs.writeTextFile`).
- `terminal/create | output | release | wait_for_exit | kill` — (**capability-gated:**
  `terminal`).

**Notifications**
- `session/cancel` — cancel ongoing operations, no response.
- `session/update` — the streaming channel; transmits **agent/user/thought message chunks,
  tool calls and tool-call updates, plans, slash-command availability, and mode changes.**

**Hard rules:** "All file paths in the protocol **MUST** be absolute" and "Line numbers are
1-based."

### Verdict — spec areas Construct's implementation may be missing

Construct covers the **required core handshake + prompt loop**: `initialize` (with
capabilities), `session/new`, `session/prompt`, `session/cancel`, and `session/update`
streaming. That is enough to be a *minimally valid* ACP agent. Gaps to flag against the v1
surface (each is a spec area, not a confirmed defect — Construct's emit path is `[unverified]`
here):

1. **Tool-call streaming granularity.** Construct streams `agent_message_chunk`
   (`lib/acp/server.mjs:48`), but ACP's `session/update` is also the channel for
   **`tool_call` / `tool_call_update`** events and **plan** updates. A multi-specialist
   orchestration that only emits message chunks would render in Zed/JetBrains as flat text,
   not as the structured tool-call/plan timeline ACP clients are built to display.
   `[unverified]` whether Construct emits tool_call updates; if it does not, this is the
   highest-value gap.
2. **`session/request_permission`.** ACP makes the **client** the permission authority for
   tool calls. If Construct executes its orchestration's tool/worker actions internally
   without round-tripping `session/request_permission`, it bypasses the editor's
   human-in-the-loop gate — the same trust concern the MCP spec raises in §1. `[unverified]`.
3. **`fs/read_text_file` / `fs/write_text_file`.** ACP wants file I/O routed through the
   client (so the editor sees unsaved buffers and stays the source of truth) under the `fs`
   capability. `INFERENCE:` A server that reads/writes the workspace directly via Node fs
   would diverge from this model. `[unverified]`.
4. **`session/load`.** Construct declares `promptCapabilities` but the header lists no
   `session/load`; without `loadSession`, editors can't resume a prior Construct session.
   Optional by spec, but a UX gap. (`lib/acp/server.mjs:12` lists no load method.)
5. **`session/set_mode` / slash commands / terminal.** All optional/capability-gated; absent
   is spec-legal. Worth noting only as "areas the surface doesn't yet reach."

`INFERENCE:` The implementation is a **valid but thin** ACP agent — correct on the required
methods, likely under-using `session/update`'s structured event types (`tool_call`,
`tool_call_update`, `plan`) and the client-side permission/fs methods that make an ACP agent
feel native rather than a text firehose.

---

## 4. Multi-lab tool-design guidance (Anthropic + OpenAI + non-frontier/community)

This is the explicit cross-lab requirement. Sources span three tiers.

### Anthropic — "Writing effective tools for AI agents"

- **Fewer, higher-impact tools.** "More tools don't always lead to better outcomes." "We
  recommend building a few thoughtful tools targeting specific high-impact workflows …
  scaling up from there." "Too many tools or overlapping tools can also distract agents from
  pursuing efficient strategies."
- **Consolidate, don't wrap every endpoint.** Replace `list_users` + `list_events` +
  `create_event` with one `schedule_event`; collapse `get_customer_by_id` +
  `list_transactions` + `list_notes` into `get_customer_context`; prefer `search_logs` over
  `read_logs`.
- **Namespacing/naming.** Group related tools under common prefixes
  (`asana_search`, `asana_projects_search`), but "choose a naming scheme according to your
  own evaluations" — effects vary by LLM.
- **Token-efficient, high-signal returns;** expose a `response_format` enum
  (`concise`/`detailed`). "Even small refinements to tool descriptions can yield dramatic
  improvements." "Think of how you would describe your tool to a new hire."

### OpenAI — Function-calling guide (primary source)

- **Soft cap.** "Aim for fewer than 20 functions available at the start of a turn at any one
  time, though this is just a soft suggestion," plus "evaluate your performance with
  different numbers of functions."
- **Functions cost context.** "Functions are injected into the system message … This means
  callable function definitions count against the model's context limit and are billed as
  input tokens."
- **The blessed dispatcher alternative is `tool_search`.** When you have many functions, use
  the `tool_search` feature to **"defer loading rarely-used tools until needed,"** or shorten
  descriptions / fine-tune. This is the same deferral goal as Construct's dispatcher and
  MCP's pagination/`listChanged` — three labs/specs converging on "don't front-load the long
  tail."
- **Clear names + enums.** "Write clear and detailed function names, parameter descriptions,
  and instructions"; "use enums to prevent invalid states."

### Non-frontier / community tier

- **Ollama** (community + docs): the official tool-calling docs define tools as JSON with
  `name`/`description`/`parameters` (JSON Schema) and **do not** document grammar
  constraints, a tool-count guideline, or small-model reliability — i.e., no built-in
  small-model safety rails. Community findings are blunter: "Function calling is the area
  where local LLMs are most uneven … some get confused above 3 tools," and grammar-true
  constraint "would need to combine all possible tools into one JSON Schema" so the model is
  constrained to a valid tool — which "is already very low level," better served by
  llama.cpp directly.
- **llama.cpp / LLGuidance** (grammar-constrained decoding): LLGuidance is "a library for
  constrained decoding … for LLMs that supports JSON Schemas and arbitrary context-free
  grammars." llama.cpp offers three constraint paths: **GBNF grammars**, **JSON-Schema→GBNF
  conversion**, and **function/tool calling via chat templates + parsers.** Mask computation
  is ~50μs avg (p99 0.5ms) per token for a 128k-token tokenizer — cheap enough to constrain
  every decode step. This is the mechanism that makes tool calls *reliable* on small local
  models: the decoder can only emit a token sequence the grammar/enum allows, so it
  **cannot hallucinate a tool name or malformed JSON.**

### Cross-lab consensus (synthesis)

| Question | Anthropic | OpenAI | Community/local | Consensus |
|---|---|---|---|---|
| How many tools is too many? | "a few thoughtful tools"; too many distract | "< 20 at start of turn" (soft) | local models "confused above 3 tools" | **Keep the always-on surface small; single digits for local, <20 cloud.** |
| Schema verbosity | high-signal, concise; `response_format` enum | descriptions billed as input tokens; shorten | one-JSON-Schema-for-all-tools is "very low level" | **Verbose schemas are a token + reliability tax — minimize what's front-loaded.** |
| Naming | prefix-group; evaluate | clear, detailed, enums | n/a | **Namespaced, evaluated names; enums to constrain.** |
| When to use a dispatcher / deferral | consolidate many endpoints into few tools | `tool_search` defers rarely-used tools | combine tools into one constrained schema | **Deferral/consolidation is endorsed; an enum-constrained meta-tool is one valid form.** |
| Grammar-constrained decoding | (not its focus) | strict mode / structured outputs | GBNF / LLGuidance / JSON-Schema→GBNF | **For local models, constrain decoding so tool name + args are valid by construction.** |

**Where Construct lands against the consensus:** Construct's design is **strongly aligned**
with the consensus on surface size and deferral — 8 front-loaded tools is well under
OpenAI's <20 and near the local "single-digit" comfort zone, and the enum-constrained `tool`
parameter is *exactly* the "constrain the tool name so it can't be hallucinated" move the
community tier prescribes (`lib/mcp/server.mjs:1250`, in-code rationale at `:1236-1238`).
Two consensus levers it under-uses: **(a)** it ships a flat enum, not Anthropic-style
*consolidation* — 61 long-tail tools is still 61 distinct behaviors, just hidden, so the
"too many overlapping tools distract the agent" risk persists once `construct_call` is
chosen; **(b)** the enum constraint lives only in the JSON Schema, which a cloud model
respects but a **local** model only honors if the *host* applies grammar-constrained
decoding over that enum (llama.cpp/LLGuidance) — JSON Schema alone is advisory at the
sampler unless the runtime enforces it. `INFERENCE:` The dispatcher's small-model benefit is
**conditional on the serving runtime enforcing the enum**; on a host that doesn't
grammar-constrain, the enum is a hint, not a guarantee.

---

## Standards-conformance scoring (six rubric dimensions)

Scored 0–5 where the dimension applies to *standards conformance* (not Construct's absolute
quality). Cited to the sections above.

| # | Dimension | Score | Basis |
|---|---|---|---|
| 1 | Prompt economy | **4/5** | 8 front-loaded tools + one-line catalog instead of ~10k of schemas (`server.mjs:1244-1246`) matches OpenAI's "<20 / shorten descriptions" and Anthropic's "few thoughtful tools." Loses 1: the catalog string itself grows linearly with the long tail and is always-on. |
| 2 | Tool surface design | **3/5** | Enum-constrained meta-tool is a legal, well-motivated MCP tool and matches the cross-lab deferral consensus. Loses points: bypasses MCP `tools/list` pagination + `listChanged`; collapses per-tool annotations (`readOnlyHint`/`destructiveHint`) and per-tool host confirmation into one opaque tool; is enum-deferral, not Anthropic-style consolidation. |
| 3 | Local-model strategy | **4/5** | Enum on `tool` is the right small-model lever (kills hallucinated names) and the front-load is small. Loses 1: the guarantee is conditional on the host applying grammar-constrained decoding (llama.cpp/LLGuidance); JSON Schema alone is advisory at the sampler. |
| 4 | Skill/knowledge architecture | **n/a** | Covered in `40-memory-knowledge.md`; this doc only touches `get_skill`/`search_skills` as core-tool members. |
| 5 | Hook/gate philosophy | **2/5 (conformance only)** | Standards lens: both MCP ("human-in-the-loop SHOULD deny," "show tool inputs") and ACP (`session/request_permission`) put the *client* in the approval loop. The dispatcher and (likely) the ACP server route long-tail/worker actions internally, weakening that gate. `[unverified]` for ACP permission flow. |
| 6 | Test strategy | **n/a here** | Owned by `70-test-infra-verdict.md`. Standards note only: no observed test asserts MCP `tools/list` pagination or ACP `tool_call`/`request_permission` conformance against the live spec. `[unverified]`. |

---

## Proposed changes (evidence-backed; each becomes a P2 bead)

### P-1 · Add a spec-conformant tool-discovery path alongside the dispatcher

- **Current** — `ListToolsRequestSchema` returns a fixed flat array; no pagination, no
  `listChanged`, no per-tool annotations on the long tail (`lib/mcp/server.mjs:1257-1261`).
- **Proposed** — Keep `construct_call` as the default low surface for thin/local hosts, but
  (a) implement `tools/list` cursor pagination over `ALL_TOOL_DEFS`, (b) declare
  `tools.listChanged`, and (c) attach annotations (`readOnlyHint`/`destructiveHint`/
  `idempotentHint`) to each long-tail tool so rich hosts can opt into real per-tool
  schemas + confirmation UI.
- **Pros** — Conformant with the MCP-blessed mechanisms (pagination/`listChanged`); restores
  per-tool human-in-the-loop and annotation rendering; still preserves the small-model win
  on hosts that prefer the dispatcher.
- **Cons** — More code paths to keep in sync; some hosts will front-load all tools and lose
  the prompt-economy benefit.
- **Reasoning** — The spec designed pagination + `listChanged` for exactly Construct's
  "68 tools, don't front-load" problem; doing it out-of-protocol forfeits annotations and
  per-tool consent (MCP Tools/Pagination pages, §1).
- **Counter-argument** — Most current hosts don't paginate well; the dispatcher already
  works; YAGNI until a host demands it.
- **Falsified-if** — A survey of target hosts shows none consume `tools/list` pagination or
  per-tool annotations, making the extra surface dead weight.

### P-2 · Consolidate the long tail, don't just hide it

- **Current** — 61 long-tail tools behind an enum; each is a distinct behavior
  (`LONG_TAIL_DEFS`, `server.mjs:1234`).
- **Proposed** — Apply Anthropic-style consolidation: fold overlapping `workflow_*`,
  `storage_*`, `session_*` families into a handful of intent-shaped tools (e.g. one
  `workflow` tool with an `action` enum) so the *number of distinct behaviors* drops, not
  just their visibility.
- **Pros** — Directly addresses "too many overlapping tools distract the agent" (Anthropic);
  shrinks the enum and the always-on catalog string; fewer dispatch branches.
- **Cons** — Wider per-tool schemas (action-union); migration churn for callers.
- **Reasoning** — Hiding 61 tools doesn't remove the 61-way decision once `construct_call`
  is selected; consolidation does (Anthropic, §4).
- **Counter-argument** — The flat enum is simpler to dispatch and reason about; action-unions
  re-introduce the schema verbosity the dispatcher was built to avoid.
- **Falsified-if** — Telemetry shows the agent picks the right long-tail tool reliably and
  the enum size has no measurable effect on selection accuracy or tokens.

### P-3 · Make the local-model guarantee real: grammar-constrained enum on local hosts

- **Current** — `tool` enum lives only in JSON Schema (`server.mjs:1250`); enforcement
  depends on the serving runtime.
- **Proposed** — On local/OpenCode paths, drive tool selection through a
  grammar-constrained decode (llama.cpp GBNF / JSON-Schema→GBNF / LLGuidance) so the enum is
  enforced at the sampler, not merely suggested.
- **Pros** — Turns "kills hallucinated names" from a hope into a guarantee on the exact tier
  (small local models) the design targets (community/llama.cpp evidence, §4); matches the
  audit's local-model floor.
- **Cons** — Requires runtime support (LLGuidance needs a Rust toolchain build of llama.cpp);
  not all local backends expose grammar hooks.
- **Reasoning** — JSON Schema is advisory at decode time; only constrained decoding makes the
  enum binding for weak models (LLGuidance/llama.cpp, §4).
- **Counter-argument** — Capable 14B+/32k models (the decided floor) already honor the enum
  without grammar enforcement, so the complexity buys little.
- **Falsified-if** — Floor-tier models (qwen3-coder/devstral class) hit ~0 hallucinated tool
  names without grammar constraint in OpenCode traces.

### P-4 · AGENTS.md: single source of truth, CLAUDE.md as a pointer

- **Current** — Construct emits both AGENTS.md and CLAUDE.md marker blocks (audit prompt);
  the repo itself uses `CLAUDE.md`, not `AGENTS.md`.
- **Proposed** — Treat `AGENTS.md` as canonical (Claude Code is on the supporting-tools
  list) and emit `CLAUDE.md` as a thin pointer to it, not a duplicated body; ensure the
  marker block is idempotent and never clobbers nested per-package `AGENTS.md`.
- **Pros** — Honors the standard's single-file ethos and "closest file wins" rule; less
  drift between two instruction files.
- **Cons** — Some Claude-Code-specific directives may not map cleanly to the shared file.
- **Reasoning** — The standard exists to end tool-specific fragmentation; shipping a parallel
  CLAUDE.md body reintroduces it (agents.md, §2).
- **Counter-argument** — CLAUDE.md supports Claude-specific affordances AGENTS.md can't
  express; duplication is the price of full fidelity per host.
- **Falsified-if** — Claude Code measurably ignores AGENTS.md in practice for directives it
  honors in CLAUDE.md.

### P-5 · ACP: emit structured tool-call/plan updates and route permission through the client

- **Current** — ACP server streams `agent_message_chunk` only; `tool_call`/`tool_call_update`/
  `plan` emission and `session/request_permission` usage are `[unverified]`
  (`lib/acp/server.mjs:48`).
- **Proposed** — Emit ACP `session/update` tool-call and plan events for the multi-specialist
  run, and route any workspace tool/worker action through `session/request_permission` and
  `fs/*` so the editor stays the source of truth.
- **Pros** — Makes Construct render as a native ACP agent (structured timeline, consent UI)
  in Zed/JetBrains rather than a text firehose; satisfies the client-as-permission-authority
  model both ACP and MCP assume.
- **Cons** — Larger ACP surface to implement and test; requires mapping orchestration
  internals to ACP event types.
- **Reasoning** — ACP `session/update` is explicitly the channel for tool calls and plans,
  and `session/request_permission` is the required client method for tool authorization
  (agentclientprotocol.com, §3).
- **Counter-argument** — The thin agent already works for the prompt loop; structured events
  are polish until users ask for the timeline.
- **Falsified-if** — Reading `lib/acp/server.mjs` in depth shows it already emits tool_call
  updates and round-trips permission (this doc deliberately left that `[unverified]`).

---

## Sources

MCP spec
- Tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Pagination: https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination
- Server instructions (search_* over list_*, batching guidance): https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/

AGENTS.md
- https://agents.md/

ACP
- Overview / method surface: https://agentclientprotocol.com/protocol/v1/overview
- Repo: https://github.com/agentclientprotocol/agent-client-protocol

Multi-lab tool design
- Anthropic, Writing effective tools for AI agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- OpenAI function-calling guide: https://developers.openai.com/api/docs/guides/function-calling
- Ollama tool-calling docs: https://docs.ollama.com/capabilities/tool-calling
- Ollama grammar/JSON-Schema discussion: https://github.com/ollama/ollama/issues/6002
- llama.cpp LLGuidance: https://github.com/ggml-org/llama.cpp/blob/master/docs/llguidance.md
- llama.cpp grammars README: https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md

Repo (Construct)
- construct-mcp surface: `lib/mcp/server.mjs:126,1218-1268`
- ACP server: `lib/acp/server.mjs:6-13,35-92`
