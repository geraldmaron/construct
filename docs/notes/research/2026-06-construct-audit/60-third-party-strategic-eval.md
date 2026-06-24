---
intake: none
---

# 60 — Third-Party Strategic Fit: Per-Integration Evaluation

Date: 2026-06-09 · Branch: research/capability-registry · Bead: construct-hmv1

This doc audits Construct's third-party tool integrations for **strategic fit only**. Tactical
correctness is already established (the integrations work). The question here is narrower and harder:
for each tool, **is Construct using it the way its authors intended, and is it the right tool for the
job at all?**

Per the methodology (`00-methodology.md`): every load-bearing claim cites a re-verifiable source — an
upstream docs URL (page inspected) or an absolute repo path with line numbers. Inferences are labeled
`INFERENCE:`. Unverifiable facts are marked `[unverified]`. Each sub-section carries the per-tool
fields the prompt requires (upstream intent, our usage, alignment verdict, ≥2 alternatives, switch
cost, strategic verdict); the top-3 strategic changes at the end use the full methodology template
(Current/Proposed/Pros/Cons/Reasoning/Evidence/Counter-argument/Falsified-if).

---

## 1. docling — document extraction

**Upstream intended design.** docling (IBM Research Zurich, MIT, now an LF AI & Data project) is a
Python library + CLI whose entry point is `DocumentConverter`, designed to turn PDFs/DOCX/PPTX/etc.
into LLM-ready Markdown/JSON; "requires just five lines of code to set up"
([github.com/docling-project/docling](https://github.com/docling-project/docling),
[docling-project.github.io/docling/reference/document_converter](https://docling-project.github.io/docling/reference/document_converter/),
[research.ibm.com/blog/docling-generative-AI](https://research.ibm.com/blog/docling-generative-AI)).
The maintainers **also ship an official agentic integration, docling-mcp**
([github.com/docling-project/docling-mcp](https://github.com/docling-project/docling-mcp),
[docling-project.github.io/docling/usage/mcp](https://docling-project.github.io/docling/usage/mcp/)).
docling-mcp **v2.0** is the relevant data point: it is a **long-lived server** (stdio / sse /
streamable-http) with a **hybrid architecture** — a default *remote* mode that calls a Docling Serve
API (base package ~50 MB, no model downloads) and an opt-in *local* mode that installs models via the
`[local]` extra, with a built-in conversion cache
([docling-mcp README](https://github.com/docling-project/docling-mcp/blob/main/README.md)). So the
authors' own answer to "how should an agent consume docling?" is: **use the library directly for
in-process use, or run docling-mcp as a server; keep models warm; consider remote conversion to avoid
the heavy local model footprint.**

**Construct's usage.** Construct spawns one long-lived Python sidecar per Node session
(`/Users/geralddagher/Developer/Projects/construct/lib/document-extract/docling-sidecar.py:1-21`),
framed as newline-delimited JSON-RPC over stdin/stdout
(`/Users/geralddagher/Developer/Projects/construct/lib/document-extract/docling-client.mjs:1-14,
27-91`), explicitly choosing this over MCP because "MCP rides the same transport but adds protocol
overhead unsuitable for the parser sidecar"
(`docling-sidecar.py:14-20`). The venv is provisioned on first use via **uv** (Astral) into
`.cx/runtime/docling/.venv`, pinning `docling==2.45.0`, with full model/ML-dep download on first call
(`/Users/geralddagher/Developer/Projects/construct/lib/runtime/uv-bootstrap.mjs:24-28, 119-157`). The
sidecar enables `generate_picture_images` + base64-embedded image export
(`docling-sidecar.py:45-66`), and the Node side externalizes those into an `assets/` dir
(`/Users/geralddagher/Developer/Projects/construct/lib/document-ingest.mjs:65-82`). The whole docling
attempt is bounded (`DOCLING_TIMEOUT_MS=600_000`) with a legacy-extractor fallback recorded in
`droppedInfo` (`document-ingest.mjs:163-207`).

**Alignment verdict: aligned (with one real divergence to weigh).** Construct uses docling exactly as
the *library* is intended — `DocumentConverter.convert()`, layout-aware Markdown, picture-image
pipeline, all first-class docling API. The long-lived warm process is also what docling-mcp does. The
divergence is that Construct **reimplemented docling-mcp's job** (long-lived server, warm models,
caching, image extraction) as a bespoke sidecar instead of consuming the official server — and it did
so on the merits (avoiding MCP framing overhead for a non-LLM IPC). That is a defensible-but-not-free
choice: Construct now owns provisioning, version pinning, the JSON-RPC framing, and image
externalization that docling-mcp v2.0 ships and maintains upstream.

**≥2 named alternatives.**
- **markitdown (Microsoft, MIT)** — zero ML deps, fastest PDF→MD, but weak on tables/images
  ([benchmark](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)). Trade-off: tiny
  footprint, no Python venv/uv at all, but loses docling's 94–98% complex-table fidelity.
- **unstructured.io** — 30+ file types, built-in chunking + LangChain, strong simple-OCR (100% simple
  tables) but weaker on complex tables (~75%). Trade-off: broader format coverage and chunking out of [source: Evidence section of this document]
  the box, heavier dependency tree, complex-table accuracy below docling.
- **llamaparse** — highest complex-doc accuracy (~92% F1), ~6 s/doc regardless of size, but [source: Evidence section of this document]
  **API-key + $0.10/page** and cloud-only. Trade-off: best accuracy, but a paid network dependency
  that breaks Construct's local-first/offline posture.
- **plain pymupdf / pdfminer** — pure-Python, no models, instant; this is effectively Construct's
  existing *legacy* fallback extractor. Trade-off: zero footprint, no layout/table/figure
  understanding.

**Switch cost: low-to-medium.** The ingest layer already abstracts extraction behind a strategy
(`adapter | provider`) with injectable extractor functions and a fallback
(`document-ingest.mjs:182-239`). Swapping the *adapter* implementation (e.g. docling sidecar →
docling-mcp client, or → markitdown) is a contained change behind `extractViaAdapter`. Medium only if
moving to docling-mcp's remote mode, which adds a Docling-Serve dependency and network posture.

**Strategic verdict: keep-but-adjust.** Keep docling — the benchmarks make it the correct
local-first, high-fidelity, MIT choice, and Construct uses its real API. The maintainer's explicit
question ("should we take a different approach?") has a concrete answer: **the bespoke sidecar
duplicates docling-mcp v2.0 with no remaining advantage worth its maintenance.** The original
justification ("MCP framing overhead unsuitable for a parser sidecar") is real for an in-process LLM
transport, but docling-mcp also offers **stdio** framing and, more importantly, a **remote mode** that
deletes the ~500 MB local-model + uv-venv provisioning liability Construct currently carries on every
machine. The adjustment to evaluate is *not* "wrap docling in MCP for the agent" — it is "stop
hand-rolling the warm-server + caching + image-extraction that upstream now ships." See P2 change #1.

`[unverified]`: the "~2 s uv/venv warm-up" and the exact first-run model-download size are Construct's
own notes (`docling-client.mjs:5-6`, `uv-bootstrap.mjs:130`), not measured in this audit. docling-mcp's
"~50 MB remote / ~500 MB local" figures are upstream's README claims, not independently re-measured.

---

## 2. beads/bd + Dolt — issue tracking

**Upstream intended design.** beads (Steve Yegge) is a "distributed graph issue tracker powered by
Dolt," purpose-built as **persistent memory for coding agents** — a dependency-aware DAG replacing
markdown TODO plans ([gastownhall.github.io/beads](https://gastownhall.github.io/beads/),
[github.com/steveyegge/beads](https://github.com/steveyegge/beads/blob/main/docs/ARCHITECTURE.md)).
Two upstream facts are decisive for our question:
1. **The CLI is the intended programmatic surface.** "All commands produce JSON output by default,
   making it trivial for agents to parse results programmatically." There is an official `beads-mcp`
   server, **but the upstream README itself recommends against it when shell access exists:** "for
   environments with shell access (Claude Code, Cursor, Windsurf), the **CLI + hooks approach is
   recommended over MCP**" ([beads-mcp README](https://github.com/steveyegge/beads/blob/main/integrations/beads-mcp/README.md)).
2. **Dolt is load-bearing by design,** not incidental: "version-controlled SQL database with
   cell-level merge, native branching, and built-in sync via Dolt remotes," for multi-agent
   coordination on shared codebases
   ([ARCHITECTURE.md](https://github.com/steveyegge/beads/blob/main/docs/ARCHITECTURE.md),
   [aitoolly summary](https://aitoolly.com/ai-news/article/2026-04-29-beads-the-dolt-powered-memory-upgrade-and-distributed-graph-issue-tracker-for-ai-programming-agents)).

**Construct's usage.** Construct wraps the `bd` CLI via `spawnSync` with an actor env var
(`/Users/geralddagher/Developer/Projects/construct/lib/beads-client.mjs:133-248`), classifying ops as
read (lock-free concurrent) vs write (optimistic locking + retry, legacy file-lock fallback)
(`beads-client.mjs:75-99, 145-248`). The optimistic layer derives a "version" from `bd show --json`'s
`commitHash` (`/Users/geralddagher/Developer/Projects/construct/lib/beads-optimistic.mjs:40-56,
68-128`). The legacy lock guards `.beads/embeddeddolt/.lock-meta.json`
(`/Users/geralddagher/Developer/Projects/construct/lib/beads-lock.mjs:1-16`). Construct relies on
bd's own Dolt commands for sync — `CLAUDE.md` session-close runs `bd dolt push` — and bd 1.0.3
exposes `bd dolt` / `branch` / `compact` / `gc` (verified: `bd version` → 1.0.3;
`bd --help` lists "Sync & Data: branch / restore / dolt / compact / flatten / gc").

**Alignment verdict: partial (the wrapper fights bd's own concurrency model).** Wrapping the JSON CLI
is **exactly** the upstream-recommended path for a shell-access host — that part is fully aligned, and
the official `beads-mcp` would be the *worse* choice here per upstream's own guidance. **But the
optimistic-locking + legacy-file-lock machinery is Construct reimplementing concurrency control that
Dolt already provides.** bd is backed by a versioned SQL DB with cell-level merge and a documented
`dolt.auto-commit` policy (`off|on|batch`, with SIGTERM/SIGHUP flush — from `bd --help`); the conflict
domain bd is built to resolve at the database layer is being pre-serialized by a Node-side file lock
and a `commitHash`-as-version compare-and-swap. The `getBeadVersion` check is also racy: it reads the
version, then shells out to `bd update` as a *separate* process with no transaction spanning the two
(`beads-optimistic.mjs:82-106`) — it narrows a window, it does not close it.

**Is Dolt's versioned-DB capability leveraged or incidental?** **Leveraged — but by bd, not by
Construct's wrapper.** Construct uses `bd dolt push`/branch for cross-session/cross-agent sync (the
genuine Dolt value), which is the intended use. Construct's *own* code treats Dolt as an opaque
embedded store it must lock around, which is the incidental framing — and is where the friction is.

**≥2 named alternatives.**
- **GitHub Issues** — zero local infra, native to the PR workflow, but not a dependency-DAG, not
  offline, API-rate-limited, and not "agent memory." Trade-off: ubiquity vs no graph/offline/agent
  semantics — bd exists precisely because Issues is the wrong shape for agent memory.
- **Plain git-tracked markdown** — trivial, diffable, no daemon; but exactly the "messy markdown
  plans" bd was built to replace (no dependency graph, no `ready` query). Trade-off: simplicity vs
  losing the entire reason to adopt bd.
- **SQLite (e.g. one `.db` file)** — single-file, embedded, no Dolt; but loses branch/merge/remote
  sync — you would rebuild Dolt's distinguishing feature by hand. Trade-off: lighter store vs
  forfeiting versioned multi-agent merge.
- **Drop the wrapper's lock layer; rely on `bd dolt` + a single writer / `--dolt-auto-commit=batch`.**
  Trade-off: less Construct code and no double-locking vs trusting bd/Dolt to serialize (which is what
  it is for).

**Switch cost: high to replace bd; low-to-medium to fix the wrapper.** Replacing bd is high — it is
woven into CLAUDE.md, the session protocol, hooks, and `rules/common/beads-hygiene.md`. But the
*strategic* fix is not replacement; it is **removing or thinning the optimistic/legacy lock layer**
(`beads-optimistic.mjs`, `beads-lock.mjs`) and leaning on bd's `dolt.auto-commit` + a serialized
writer — a contained change behind `runBd`, low-to-medium.

**Strategic verdict: keep-but-adjust.** Keep bd; keep the CLI wrapper (upstream-blessed for
shell hosts). Adjust by **retiring the home-grown concurrency control** in favor of bd/Dolt's native
mechanism. See P2 change #2. The `commitHash`-as-version compare-and-swap is the specific anti-pattern:
it is a non-transactional read-then-write across two `bd` processes that gives the *appearance* of
optimistic locking without its guarantee.

---

## 3. LanceDB — vector store

**Upstream intended design.** LanceDB is an **embedded, in-process, serverless** vector DB on the
Lance columnar format, "designed to be lightweight," runs with "no separate server required," built
for local-first / edge / data-science retrieval where "spinning up a separate database service is
overhead" ([github.com/lancedb/lancedb](https://github.com/lancedb/lancedb),
[lancedb.com/documentation/overview](https://lancedb.com/documentation/overview/index.html)). Its
whole pitch is the *opposite* of "run a server" — it is for when you specifically do **not** want a
separate DB process.

**Construct's usage.** `VectorClient` lazy-imports `@lancedb/lancedb` + `apache-arrow`, connects to a
file dir (`.cx/lancedb` or `CONSTRUCT_LANCEDB_PATH`), and stores `observations_v1` / `documents_v1`
tables with cosine search and `mergeInsert` upserts
(`/Users/geralddagher/Developer/Projects/construct/lib/storage/vector-client.mjs:11-14, 55-130,
178-209, 224-255`). It serializes writes per-db-path at module scope and adds a conflict retry because
"LanceDB uses optimistic concurrency" (`vector-client.mjs:16-53`). The observation store wires
embeddings → LanceDB and degrades gracefully if the store is unhealthy
(`/Users/geralddagher/Developer/Projects/construct/lib/observation-store.mjs:31-36, 190-251`).

**The Postgres premise — examined and largely falsified.** The prompt asks whether running LanceDB
separately is duplicative given "Construct already uses Postgres in team mode." Evidence: in the
deployment topology, `team`/`enterprise` modes *declare* `database: 'postgres'`
(`/Users/geralddagher/Developer/Projects/construct/lib/deployment-mode.mjs:27-44`), and the parity
contract says solo "degrades to file BM25 + local vectors when Postgres is absent"
(`/Users/geralddagher/Developer/Projects/construct/lib/deployment/parity-contract.mjs:21,40`). **But
the SQL backend is now a stub:** `createSqlClient` returns `null` and `probeSqlClient` reports "SQL
backend is no longer used for local operations"
(`/Users/geralddagher/Developer/Projects/construct/lib/storage/backend.mjs:1-22`). There is **no
pgvector vector-store implementation** — `VectorClient.isPgvectorEnabled()` is just an alias for
`isHealthy()` on LanceDB (`vector-client.mjs:174-176`). So "Postgres in the stack for vectors" is a
*topology declaration and a comment*, not a wired backend. LanceDB is the **only** live vector store
today, in all modes.

**Alignment verdict: aligned (and the duplication premise does not currently hold).** Embedded,
file-based, in-process is precisely LanceDB's intended deployment, and Construct uses it that way.
Because pgvector is not actually implemented, LanceDB is not duplicative of anything — it is the sole
backend. The one tension is internal coherence, not upstream fit: Construct *also* ships sqlite
elsewhere (`lib/orchestration/run-store-sqlite.mjs`, `lib/config/schema.mjs`) and a hashing/BM25 path,
so the storage story is "LanceDB + sqlite + file-BM25 + a dead Postgres topology," which is more
surfaces than the local-first job needs.

**≥2 named alternatives.**
- **sqlite-vec** — a single `.db` file, zero config, no daemon; the canonical "local-first CLI tool"
  vector store, and Construct **already runs SQLite** for orchestration. Trade-off: one fewer storage
  engine + native SQL filtering alongside existing sqlite, vs LanceDB's better large-scale IVF-PQ /
  disk-spill indexing (which a per-project agent-memory corpus rarely needs).
- **pgvector** — the *intended* team-mode backend per the topology; documents + vectors in one
  transactional DB. Trade-off: the right answer **if/when** team mode is actually built, but it is
  currently a stub — adopting it means *implementing* the team backend, not switching from LanceDB.
- **chromadb** — batteries-included embedded/served vector DB. Trade-off: simple Python-native API but
  adds a Python dependency to a Node-first storage path; no advantage over LanceDB for an in-process
  Node store.

**Switch cost: medium.** `VectorClient` is a clean seam (`observation-store.mjs` and `lib/embed/*` go
through it), so swapping LanceDB→sqlite-vec is a contained re-implementation of ~2 tables + cosine
search. Medium, not low, because the Arrow schema, `mergeInsert` upsert semantics, and the write-queue
retry would all need sqlite-vec equivalents, and existing `.cx/lancedb` stores would need migration.

**Strategic verdict: keep (re-examine only as part of a storage-consolidation pass).** LanceDB is
upstream-aligned and not duplicative today. The strategic action is **not** "replace LanceDB because
Postgres exists" (Postgres does not exist for vectors). It is to recognize the storage surface has
**three live engines** (LanceDB, sqlite, file-BM25) plus a **dead Postgres topology**, and decide
deliberately whether sqlite-vec could collapse LanceDB + sqlite into one engine for solo mode. That is
a consolidation question for the synthesis doc, not a docling-style mis-fit. See P2 change #3.

---

## 4. Ollama — local model runtime

**Upstream intended design.** Ollama's Modelfile is the **documented, intended** mechanism to bake
durable model config: `FROM <base>` + `PARAMETER num_ctx <n>` creates a derived model whose context
window persists across runs without per-call setting; "to make permanent changes to the context window
size, you need to create a new custom model" ([docs.ollama.com/modelfile](https://docs.ollama.com/modelfile),
[localllm.in guide](https://localllm.in/blog/local-llm-increase-context-length-ollama)). Critically,
the **OpenAI-compatible `/v1` endpoint has no field for `num_ctx`** — Ollama's own docs direct users to
a Modelfile + `ollama create` for exactly this case
([docs.ollama.com/api/openai-compatibility](https://docs.ollama.com/api/openai-compatibility), cross-cited
in `20-opencode-ecosystem.md` §Q5). So `ollama create` from a Modelfile is **the** sanctioned extension
point, not a hack.

**Construct's usage.** For each tool-capable model with no baked `num_ctx`, Construct derives a
`<model>-cx<N>k` variant via `ollama create` with `PARAMETER num_ctx 32768`, a Qwen-safe
`repeat_penalty 1.05`, low temperature, and ChatML stops baked in — idempotently, confirmed by the
variant appearing in `ollama list` rather than exit code
(`/Users/geralddagher/Developer/Projects/construct/lib/ollama/provision-context.mjs:1-16, 70-148`).
The rationale matches Ollama's docs verbatim: `/v1` drops `num_ctx`, the Modelfile is the only surface
that sets the runtime window (`provision-context.mjs:1-12`). `ollama-manager.mjs` wraps status/list/
pull/show/test over `/api/*` for management (`lib/ollama-manager.mjs`).

**Alignment verdict: aligned (textbook).** Creating Modelfile variants via `ollama create` is the
**exact** extension mechanism Ollama documents for persistent context/sampler config, and it is the
*only* lever that works given OpenCode's `/v1`-only Ollama path (the established constraint). This is
the strongest fit in the entire audit — Construct automates by hand what the community does manually.

**≥2 named alternatives.**
- **llama.cpp directly** — full control of `--ctx-size`, GBNF grammar-constrained tool calls; but
  Construct would own model lifecycle, server management, and OpenCode wiring that Ollama abstracts.
  Trade-off: maximal control / grammar-enforced tool JSON vs giving up Ollama's registry, `create`,
  and one-line OpenCode provider.
- **LM Studio** — GUI + OpenAI-compatible server with per-model context UI; but GUI-centric, weaker
  for headless/scripted provisioning. Trade-off: nicer UX vs poor automation fit for a CLI tool.
- **vLLM** — high-throughput server-grade inference, true paged-attention long context; but
  GPU/server-oriented, heavyweight for a single-dev laptop. Trade-off: production throughput vs wrong
  weight class for local-first solo use.

**Switch cost: high.** Ollama is wired into provisioning, the OpenCode provider (`baseUrl
:11434/v1`), the coherence probe, embeddings-ollama, and model-router. Replacing the runtime touches
all of these. No reason to incur it.

**Strategic verdict: keep.** Fully aligned, only viable lever for the `/v1` constraint, deeply
integrated. The one watch-item (carried from `20-opencode-ecosystem.md`): if OpenCode ever ships a
native `/api/chat` path or `num_ctx` pass-through, the variant machinery becomes redundant — but that
is a *future* falsifier, not a current mis-fit.

---

## 5. OpenCode — host

**Upstream intended design.** OpenCode configs are **deep-merged** (remeda `mergeDeep`), later layers
win conflicting keys, arrays *replace* except `instructions`/`plugin` which *concatenate*; project
config can override global per-key ([opencode.ai/docs/config](https://opencode.ai/docs/config); source
cited in `20-opencode-ecosystem.md` §Q1). Plugins are the intended extension surface: a function
returning the typed `Hooks` interface (`event`, `chat.params`, `chat.message`,
`tool.execute.before/after`, `permission.ask`, `command.execute.before`, etc.), loaded from
`"plugin": [...]` or `.opencode/plugins/` ([opencode.ai/docs/plugins](https://opencode.ai/docs/plugins),
`20-opencode-ecosystem.md` §Q4/Q6). So **non-destructive config merge + a runtime plugin is the
endorsed integration path** — there is no other supported way to inject lifecycle behavior.

**Construct's usage.** Construct writes `~/.config/opencode/opencode.json` non-destructively: it
reads, merges Construct-managed keys (models→provider mapping, providers, local-model tuning), strips
the internal `construct` key, and writes atomically; project-scoped paths are honored as-is
(`/Users/geralddagher/Developer/Projects/construct/lib/opencode-config.mjs:27-49, 108-209,
sanitizeOpenCodeConfig`). It ships a runtime plugin
(`/Users/geralddagher/Developer/Projects/construct/lib/opencode-runtime-plugin.mjs:881-941`) returning
the `Hooks` object — telemetry on `event`/`chat.*`/`tool.*`/`permission.ask`/`command.execute.before`,
plus a session prelude, read-efficiency nudges, and model fallback on rate-limit `session.error`. It
respects the `/v1` boundary by emitting only OpenAI-standard params and deleting `num_ctx`/penalties
(`opencode-config.mjs:160-187`).

**Alignment verdict: aligned.** Non-destructive merge is exactly right for OpenCode's deep-merge
precedence model, and the plugin uses only documented `Hooks` — no monkey-patching, no fork. The
sibling doc (`20-opencode-ecosystem.md` §"Implications", and its cross-cutting note) independently
concludes Construct's three OpenCode behaviors "are each working *with* OpenCode's design, not against
it." The sole tension it flags is **scope, not mechanism**: machine-global MCP `enabled:false` writes
are broader than the local-model justification needs, where project>global override would permit a
narrower write. That is a tuning nit on an otherwise correct integration.

**≥2 named alternatives.** (Host alternatives, since OpenCode is the host, not a library.)
- **Claude Code** — Construct already targets it (settings.template.json + hooks); a richer hook model
  but Anthropic-coupled. Trade-off: deeper hook surface vs single-provider lock-in. Not a *switch* —
  Construct is multi-host by design; OpenCode is the *local-model* host.
- **Codex** — already a sync target via mcp-catalog `hostSupport.codex`; plugin model differs.
  Trade-off: another supported host vs not the local-model story.
- **Continue / Cline / Roo (VS Code)** — IDE-embedded; different extension API. Trade-off: editor
  integration vs no terminal-agent parity. (Covered in `10-open-agents.md`.)

**Switch cost: n/a (host, not swappable in isolation).** OpenCode is one of several hosts Construct
syncs to; "switching" means dropping a host, not replacing a tool. Integration cost is already paid.

**Strategic verdict: keep (apply the scope adjustment from doc 20).** The integration path is the
endorsed one. The only adjustment is the one `20-opencode-ecosystem.md` already raised — scope MCP
`enabled:false` writes as narrowly as project>global semantics allow. Tracked there; not re-litigated
here.

---

## 6. External MCP servers — defaults

**Upstream intended design.** Each server has a clear, narrow purpose:
- **context7** (Upstash, official) — fetches up-to-date, version-specific library docs into context;
  invoked deliberately ("use context7"); tools `resolve-library-id` + docs fetch
  ([npmjs.com/package/@upstash/context7-mcp](https://www.npmjs.com/package/@upstash/context7-mcp),
  [upstash.com/blog/context7-mcp](https://upstash.com/blog/context7-mcp)).
- **github** (GitHub's remote MCP, `api.githubcopilot.com/mcp/`) — issues/PRs/code search; needs a
  token.
- **memory** (`@modelcontextprotocol/server-memory`-class; here fronted by Construct's cass-memory
  bridge) — persistent cross-session memory.
- **sequential-thinking** (`@modelcontextprotocol/server-sequential-thinking`) — structured multi-step
  reasoning scratchpad.
- **playwright** (`@playwright/mcp`) — browser automation; **downloads browser binaries (hundreds of
  MB)** on first use.

**Construct's usage.** The catalog (`/Users/geralddagher/Developer/Projects/construct/lib/mcp-catalog.json`)
classifies them: context7 + sequential-thinking are `category: "core"`; memory + playwright are
`optional`; github is `optional` (token-gated); the integration MCPs (atlassian/linear/slack/notion)
are `integration`. ADR-0031
(`/Users/geralddagher/Developer/Projects/construct/docs/decisions/adr/0031-browser-automation-is-opt-in.md`)
already demoted **playwright** from default-managed to explicit opt-in (`construct mcp add
playwright`), pinned to `@playwright/mcp@0.0.75`, on footprint + "no prompt invokes it" grounds — and
flags as **follow-up** that `writeProjectClaudeSettings` should honor catalog `category` so *all*
`optional`/`integration` MCPs (memory, sequential-thinking, github) follow the same opt-in rule at
project scope (ADR-0031 §Consequences "Follow-up"). Separately,
`/Users/geralddagher/Developer/Projects/construct/lib/mcp/tool-budget.mjs:8-22` disables all five
heavy externals (`HEAVY_EXTERNAL_MCP_IDS`) in opencode.json for local-capable setups because their
~12k-token schemas `[unverified estimate]` cannot be trimmed per-request.

**Which earn always-on vs opt-in (verdict per server):**
- **context7 — always-on earns it.** A prompt-directed, deliberately-invoked docs lookup with a
  genuine "no hallucinated APIs" payoff; multiple specialists list it (`usedBy`). Keep core/always-on.
- **sequential-thinking — opt-in.** Marked `core`, but it is a *reasoning scratchpad* the model may
  ignore; for the capable 14B+/32k local floor and for frontier models the value is marginal, and its
  schema rides in every agent window. INFERENCE: it does not earn always-on; demote to opt-in like
  playwright (consistent with ADR-0031's follow-up).
- **memory — already optional; keep opt-in.** Persistent memory is high-value but only when the
  cass-memory service is actually running; ambient-installing a bridge to an absent service is dead
  weight. Correctly optional.
- **github — keep opt-in, token-gated.** Real value for PR/issue flows but `gh` CLI covers the common
  case (Construct's own session protocol uses `gh`/`git`, not the MCP); the schema cost is not
  justified always-on. Correctly optional.
- **playwright — opt-in (settled by ADR-0031).** No prompt invokes it; hundreds of MB. Correct.

**Alignment verdict: partial → on the right trajectory.** ADR-0031 made the correct call for
playwright and **named the exact systemic gap**: the project-scope sync merges the full registry/
template `mcpServers` regardless of catalog `category`, so `optional` servers still leak into projects.
Two servers classified `core` (context7, sequential-thinking) are doing different jobs — context7
earns core; sequential-thinking does not. So the defaults are *partially* right: the classification
scheme exists and is correct in intent, but (a) it is not uniformly enforced at project scope, and
(b) sequential-thinking is mis-classified as core.

**≥2 named alternatives.**
- **For sequential-thinking:** rely on the model's native reasoning / Construct's own planning skills
  instead of an MCP scratchpad. Trade-off: −1 always-on schema, −~?k tokens vs losing an explicit
  structured-thinking tool few capable models need.
- **For github:** standardize on `gh` CLI (already a dependency) for the common path, MCP only when
  deep code-search is needed. Trade-off: smaller surface vs MCP's richer structured search.
- **For memory:** Construct's own `knowledge_search` / `memory_search` (construct-mcp) already cover
  search/memory (per `tool-budget.mjs:18-20`), arguing the external memory MCP is redundant on
  local-capable setups. Trade-off: one memory surface vs two.

**Switch cost: low.** These are config entries + a catalog `category` field. Enforcing `category` at
project scope (ADR-0031's named follow-up) and re-tagging sequential-thinking are small, well-scoped
changes already gated by `tests/sync-contract.test.mjs`.

**Strategic verdict: keep-but-adjust.** Keep context7 always-on; keep github/memory/playwright opt-in;
**re-classify sequential-thinking from core to optional**, and **implement ADR-0031's follow-up** so
project-scope sync honors catalog `category` uniformly. See P2 change (priority table). This finishes
the job ADR-0031 started rather than opening a new front.

---

## 7. Embeddings stack — local ONNX / OpenAI / Ollama / hashing fallback

**Upstream intended design.** The stack is model-pluggable: local ONNX via the Transformers.js
lineage (`Xenova/all-MiniLM-L6-v2`, 384d) as default, OpenAI `text-embedding-3-small` (1536d),
Ollama `nomic-embed-text` (768d), and a self-contained 256d SHA256-bucketed bag-of-words "hashing"
adapter (`/Users/geralddagher/Developer/Projects/construct/lib/storage/embeddings-engine.mjs:23-31,
126-133`; `/Users/geralddagher/Developer/Projects/construct/lib/storage/embeddings-legacy.mjs:1-12,
17-18, 30-47`). Intended design of a real embedding model is *semantic* similarity; the hashing
adapter, by construction, has **no semantic understanding** — its own metadata says so:
"hashing-bow-v1 … fast but no semantic understanding" (`embeddings-engine.mjs:131`).

**Construct's usage.** `resolveModelId` defaults to `local`; if `openai` is requested without a key it
**throws** unless `CONSTRUCT_EMBEDDING_FALLBACK=1` opts into a *warned* fallback to `local` —
explicitly "opinionated by design: silent fallback hides misconfiguration"
(`embeddings-engine.mjs:13-21, 40-62`). The hashing adapter is reachable two ways: (1) explicitly via
`CONSTRUCT_EMBEDDING_MODEL=hashing`, and (2) as the **last-resort default** in every dispatch:
`ADAPTERS[modelId] || ADAPTERS.hashing` (`embeddings-engine.mjs:72, 85, 97`). So if `resolveModelId`
ever returns an id not in `ADAPTERS` (a typo, an unknown value, a future-renamed adapter), the engine
**silently** embeds with the 256d no-semantics hasher.

**Is the 256d hashing fallback a sound default-of-last-resort or a latent hazard? — latent hazard.**
The dimension mismatch is the tell. LanceDB tables are created with a **fixed** `FixedSizeList(dim)`
where `dim` comes from the *active* engine
(`vector-client.mjs:88-97, 118` → `getEngineDimensions()` → `getEmbeddingModelInfo`), and
`FALLBACK_DIMENSIONS = 384` (`vector-client.mjs:9`). The default `local` model is 384d; hashing is
**256d**. If a table is first created under `local` (384d) and a later call silently falls through to
hashing (256d) — or vice-versa — the vectors are **dimensionally incompatible** and either error on
insert or, worse, corrupt similarity if a path coerces them. More fundamentally: a hashing vector and
a MiniLM vector are **not comparable at all** (different spaces), so any silent mix degrades retrieval
quality invisibly — no error, just worse results. This is the precise failure class the file's own
OpenAI policy was written to *prevent* ("silent fallback hides misconfiguration") — yet the
`|| ADAPTERS.hashing` default re-introduces exactly that silent path for the non-OpenAI case.

**Alignment verdict: partial / fighting-the-tool (for the fallback specifically).** Using ONNX-local
as default and OpenAI/Ollama as opt-in is well-aligned with the model-agnostic intent. But a
**no-semantics 256d hasher as the implicit catch-all default** fights the entire purpose of an
embedding stack (semantic similarity) and is inconsistent with the file's own anti-silent-fallback
doctrine. As an explicit, opt-in **test fixture** (its stated purpose) it is fine; as the
`|| ADAPTERS.hashing` implicit default it is a latent hazard.

**≥2 named alternatives (for the fallback behavior).**
- **Fail loud instead of hashing.** Make an unknown `modelId` throw (like the OpenAI-no-key path does)
  rather than silently selecting hashing. Trade-off: a misconfig surfaces immediately vs a hard error
  where a (bad) result was produced before.
- **Fall back to `local` (ONNX), not hashing.** The ONNX model is offline, dependency-light, and
  *semantic*, and is already the default — making it the catch-all keeps dimensions (384d) consistent
  with `FALLBACK_DIMENSIONS` and preserves retrieval quality. Trade-off: requires the ONNX runtime be
  loadable (it is the default anyway).
- **Keep hashing only behind an explicit env flag** (already supported) and remove it from the
  implicit dispatch default. Trade-off: tests/CI that want determinism opt in explicitly; production
  never reaches it by accident.

**Switch cost: low.** Changing `|| ADAPTERS.hashing` to `|| throw` or `|| ADAPTERS.local`, and tagging
hashing-derived vectors with their `model` (the schema already stores `model`,
`vector-client.mjs:120,200`) so mixed-space rows can be detected/segregated, are small, local edits in
two files.

**Strategic verdict: keep-but-adjust.** Keep the pluggable stack and ONNX-default — both aligned. But
**remove hashing from the implicit last-resort default**: make unknown-model resolution fail loud or
fall to `local` (384d, semantic), and keep hashing strictly behind its explicit env flag for tests.
The dimension/space-mismatch + silent-degradation combination is the hazard, not the existence of a
hashing adapter. See P2 change (priority table).

---

## Priority-ranked table of strategic changes

| # | Change | Tool | Verdict | Severity | Switch cost | Why it ranks here |
|---|---|---|---|---|---|---|
| 1 | Remove hashing from the **implicit** embedding default (fail-loud or fall to `local`); tag vectors by model/space | embeddings | keep-but-adjust | **High** (silent retrieval corruption; dimension mismatch 256d vs 384d) | low | Silent, invisible quality loss + insert-time dimension errors; cheap to fix; contradicts the file's own doctrine |
| 2 | Retire the home-grown beads concurrency layer (`commitHash`-as-version CAS + file lock); rely on `bd dolt` + `--dolt-auto-commit=batch` + a serialized writer | beads/Dolt | keep-but-adjust | **High** (non-transactional CAS gives false safety; reimplements Dolt's job) | low-med | Real correctness gap (racy read-then-write across two processes) and dead-weight code; bd/Dolt already own this |
| 3 | Replace the bespoke docling sidecar with the official **docling-mcp v2.0** (evaluate remote mode to drop the ~500 MB local-model + uv-venv liability) | docling | keep-but-adjust | Med (maintenance + footprint, not correctness) | low-med | Duplicates upstream's maintained server with no remaining advantage; the maintainer explicitly asked |
| 4 | Finish ADR-0031: make project-scope sync honor catalog `category`; re-classify **sequential-thinking** core→optional | external MCP | keep-but-adjust | Med (prompt economy; mis-classification) | low | ADR-0031 already named this follow-up; small, test-gated |
| 5 | Consolidation review: could **sqlite-vec** collapse LanceDB + sqlite into one engine for solo mode? Retire the dead Postgres-vector topology comment | LanceDB | keep (review) | Low (coherence, not mis-fit) | med | LanceDB is aligned; the issue is N storage engines + a stub Postgres, a synthesis-doc decision |
| — | Scope OpenCode MCP `enabled:false` writes project-locally (per doc 20) | OpenCode | keep-but-adjust | Low | low | Already tracked in `20-opencode-ecosystem.md`; not re-opened here |
| — | No change | Ollama | keep | — | high (don't) | Textbook-aligned; only viable `/v1` lever |

---

## Top-3 strategic changes — full template

### Change 1 — Remove hashing from the implicit embedding default

- **Current.** `embedText`/`embedBatch`/`getEmbeddingModelInfo` resolve the adapter as
  `ADAPTERS[modelId] || ADAPTERS.hashing`
  (`/Users/geralddagher/Developer/Projects/construct/lib/storage/embeddings-engine.mjs:72,85,97`). Any
  `modelId` not in the map silently selects the 256d, no-semantics SHA256 bag-of-words adapter
  (`embeddings-legacy.mjs:17-18, 30-47`). LanceDB tables are created with a fixed
  `FixedSizeList(dim)` from the *active* engine and `FALLBACK_DIMENSIONS=384`
  (`vector-client.mjs:9, 88-97, 118`); the default `local` model is 384d, so a silent fall-through to
  256d hashing is dimensionally incompatible and semantically incomparable.
- **Proposed.** Make unknown-model resolution either **throw** (mirroring the existing OpenAI-no-key
  policy at `embeddings-engine.mjs:57-61`) or fall back to **`local`** (384d, offline, semantic, and
  already the default). Keep `hashing` reachable **only** via explicit `CONSTRUCT_EMBEDDING_MODEL=hashing`.
  Persist + check the `model`/dimension on each vector (schema already stores `model`,
  `vector-client.mjs:120,200`) so a space mismatch is detected, not silently merged.
- **Pros.** Eliminates silent retrieval degradation and a class of insert-time dimension errors;
  makes embedding behavior consistent with the file's stated anti-silent-fallback doctrine; near-zero
  code.
- **Cons.** A misconfigured model id now errors where it previously "worked" (badly); tests relying on
  the implicit hashing default must set the env var explicitly.
- **Reasoning.** An embedding stack exists to produce *semantically comparable* vectors; a
  no-semantics hasher in a *different dimension* as the implicit catch-all defeats both properties
  invisibly. The same repo already chose "fail loud over silent fallback" for OpenAI — the non-OpenAI
  path should match.
- **Evidence.** `embeddings-engine.mjs:13-21,40-62,72,85,97`; `embeddings-legacy.mjs:17-18,30-47`;
  `vector-client.mjs:9,88-97,118,120,200`;
  [LanceDB schema/embedded design](https://lancedb.com/documentation/overview/index.html).
- **Counter-argument.** Hashing guarantees the pipeline *never hard-fails* on an embedding step in a
  degraded/offline box with no ONNX runtime — some result beats an exception in a CLI a user is
  watching. Falling to `local` reintroduces the ONNX-load dependency the hasher was meant to sidestep.
- **Falsified-if.** Telemetry/inspection shows the implicit `|| ADAPTERS.hashing` path is **never**
  reached in practice (every `modelId` always resolves to a real adapter) **and** no `.cx/lancedb`
  table is ever created at 256d — i.e. the hazard is unreachable dead code, in which case deleting the
  branch entirely (not just re-pointing it) is the right move and the "hazard" framing is moot.

### Change 2 — Retire the home-grown beads concurrency layer; lean on Dolt

- **Current.** Writes go through `optimisticWrite`, which reads a "version" from `bd show --json`
  (`commitHash || version || Date.now()`) and compares it before shelling out to a *separate* `bd
  update` process; on failure it falls back to a file lock over `.beads/embeddeddolt/.lock-meta.json`
  (`/Users/geralddagher/Developer/Projects/construct/lib/beads-optimistic.mjs:40-56,68-128,184-231`;
  `/Users/geralddagher/Developer/Projects/construct/lib/beads-client.mjs:185-248`;
  `/Users/geralddagher/Developer/Projects/construct/lib/beads-lock.mjs:1-16`).
- **Proposed.** Remove (or reduce to a thin advisory) the optimistic-version CAS and the file lock.
  Configure bd's native `dolt.auto-commit` (e.g. `batch`, flushed on signal — from `bd --help`) and
  serialize writes through a single in-process queue (as `vector-client.mjs` already does for LanceDB),
  trusting Dolt's cell-level merge for cross-process/cross-agent contention.
- **Pros.** Deletes a non-transactional read-then-write that gives *false* safety; removes ~2 files of
  bespoke locking; aligns with bd's intended model (CLI + bd's own Dolt sync) and with upstream's
  "CLI + hooks recommended over MCP" stance.
- **Cons.** Concedes control of conflict resolution to bd/Dolt's behavior, which Construct then must
  trust and track across bd releases; a bd regression in `dolt.auto-commit` would surface as data
  races Construct no longer guards.
- **Reasoning.** `getBeadVersion` → `bd update` spans two OS processes with no shared transaction; the
  version can change between the read and the write, so the CAS narrows but does not close the race —
  it is the *appearance* of optimistic locking. Dolt is a versioned SQL DB built to resolve exactly
  this at the storage layer; doing it again, worse, in Node is the anti-pattern.
- **Evidence.** `beads-optimistic.mjs:40-56,82-106`; `bd --help` (`dolt`, `--dolt-auto-commit`,
  `branch`, `compact`); [beads ARCHITECTURE.md — Dolt cell-level merge/branching](https://github.com/steveyegge/beads/blob/main/docs/ARCHITECTURE.md);
  [beads-mcp README — "CLI + hooks recommended over MCP"](https://github.com/steveyegge/beads/blob/main/integrations/beads-mcp/README.md).
- **Counter-argument.** The empirical contention stats (`getContentionStats`,
  `beads-optimistic.mjs:255-307`) may show the current layer *is* preventing real conflicts in
  multi-agent runs; if measured conflict rate is non-trivial and bd's auto-commit alone leaves a
  window, the wrapper is earning its keep and removal would regress.
- **Falsified-if.** With the lock layer disabled and `dolt.auto-commit=batch` + a single serialized
  writer, a multi-agent stress test (N concurrent `bd update`/`claim`) shows **lost or corrupted
  writes** that the optimistic/file-lock layer demonstrably prevented — proving the home-grown control
  is load-bearing, not redundant.

### Change 3 — Replace the bespoke docling sidecar with official docling-mcp v2.0

- **Current.** Construct hand-rolls a long-lived Python sidecar (JSON-RPC over stdio), provisions a uv
  venv + `docling==2.45.0` + ML deps on first use, enables the picture-image pipeline, and
  externalizes embedded images — duplicating the warm-server, caching, and image-extraction that
  docling-mcp v2.0 ships
  (`/Users/geralddagher/Developer/Projects/construct/lib/document-extract/docling-sidecar.py:14-66`;
  `/Users/geralddagher/Developer/Projects/construct/lib/document-extract/docling-client.mjs:1-91`;
  `/Users/geralddagher/Developer/Projects/construct/lib/runtime/uv-bootstrap.mjs:24-28,119-157`;
  `/Users/geralddagher/Developer/Projects/construct/lib/document-ingest.mjs:65-82`).
- **Proposed.** Make the ingest **adapter** consume official `docling-mcp` (stdio transport) instead
  of the custom sidecar, and evaluate its **remote mode** (Docling Serve) to drop the ~500 MB
  local-model + uv-venv provisioning liability where a network conversion endpoint is acceptable;
  retain the bounded-timeout + legacy-extractor fallback already in `document-ingest.mjs:182-207`.
- **Pros.** Stops maintaining provisioning/framing/caching/image-extraction that upstream maintains;
  inherits docling-mcp's hybrid remote/local + caching; the LF-AI-hosted server is versioned and
  tracked; directly answers the maintainer's "should we take a different approach?" with the upstream-
  sanctioned one.
- **Cons.** docling-mcp's *local* mode still downloads models (so footprint only improves in *remote*
  mode, which adds a network dependency and a Docling-Serve endpoint to run/trust); adopting an MCP
  framing reintroduces the protocol overhead the sidecar comment deliberately avoided
  (`docling-sidecar.py:14-20`) for the in-process parser case.
- **Reasoning.** The sidecar's original justification — "MCP adds overhead unsuitable for a parser
  sidecar" — was sound for a hand-rolled in-process transport, but docling-mcp v2.0 now offers stdio
  framing *and* a remote mode whose footprint win (no local models) the sidecar cannot match.
  Construct is currently carrying provisioning risk (uv install, multi-minute first-run, version
  drift) for a capability upstream now packages.
- **Evidence.** [docling-mcp README — v2.0 hybrid remote/local, ~50 MB remote vs ~500 MB local, stdio/
  sse/streamable-http, caching](https://github.com/docling-project/docling-mcp/blob/main/README.md);
  [docling MCP usage docs](https://docling-project.github.io/docling/usage/mcp/);
  `docling-sidecar.py:14-66`; `uv-bootstrap.mjs:24-28,119-157`; `document-ingest.mjs:182-207`.
- **Counter-argument.** The sidecar is *tactically correct and working* (audit premise); ingest is not
  hot-path-frequent, so the warm-process + uv cost is amortized and rarely felt. Swapping to docling-mcp
  trades known, owned, offline code for a dependency on an external server (remote mode) or the *same*
  model download (local mode) plus MCP overhead — net-negative unless remote mode is actually adopted,
  which changes Construct's offline-first posture.
- **Falsified-if.** A spike shows docling-mcp (local stdio) is materially slower or less reliable than
  the sidecar at equal fidelity, **and** remote mode is rejected on offline-posture grounds — i.e.
  neither docling-mcp mode improves footprint or maintenance without regressing latency/offline use.
  Then the bespoke sidecar is the right call and only its version pin needs ongoing care.

---

## 8-line summary (per-tool verdicts)

1. **docling** — *keep-but-adjust*: real docling API used well, but the bespoke uv-venv sidecar now duplicates official **docling-mcp v2.0** (which adds a footprint-saving remote mode); the maintainer's "different approach?" answer is yes — adopt docling-mcp.
2. **beads/bd + Dolt** — *keep-but-adjust*: CLI-wrapping is upstream-recommended for shell hosts (better than beads-mcp here), and `bd dolt push` genuinely leverages Dolt; but the `commitHash`-as-version CAS is a racy, non-transactional reimplementation of concurrency control Dolt already owns — retire it.
3. **LanceDB** — *keep*: embedded/in-process is exactly its intended use and it is the **only** live vector store (team-mode pgvector is a stub, so the "duplicative with Postgres" premise does not hold today); revisit only as a storage-consolidation question (sqlite-vec could merge LanceDB+sqlite for solo).
4. **Ollama** — *keep*: Modelfile + `ollama create` context variants are textbook-aligned and the only lever that works against OpenCode's `/v1` `num_ctx` drop — strongest fit in the audit.
5. **OpenCode** — *keep*: non-destructive deep-merge + a documented `Hooks` runtime plugin is the endorsed path; only the (doc-20) MCP-disable *scope* needs narrowing, not the mechanism.
6. **External MCP servers** — *keep-but-adjust*: context7 earns always-on; github/memory/playwright correctly opt-in; **sequential-thinking is mis-classified as core** — demote it and finish ADR-0031's "honor catalog category at project scope" follow-up.
7. **Embeddings stack** — *keep-but-adjust*: pluggable ONNX-default is aligned, but the **256d no-semantics hashing adapter as the implicit last-resort default is a latent hazard** (silent quality loss + 256d/384d dimension mismatch vs LanceDB) — make it fail-loud / fall to `local` and keep hashing explicit-only.
8. **Net**: zero *replace* verdicts; Ollama/LanceDB/OpenCode are *keep*; docling/beads/external-MCP/embeddings are *keep-but-adjust* — the top-3 fixes (embedding fallback, beads CAS, docling-mcp) are the load-bearing strategic changes for P2.
