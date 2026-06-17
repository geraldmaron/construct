# 40 — Memory & Knowledge: Construct vs mem0, Letta/MemGPT

Area: skill/knowledge architecture (rubric dim 4), with prompt-economy (dim 1) and
tool-surface (dim 2) spillover. Bead: construct-gd99.
Date: 2026-06-09 · Branch: research/capability-registry.

Method: external claims cite primary sources (vendor docs, the mem0 arXiv paper, vendor
repos) by URL. Construct claims cite repo paths with line numbers, reproduced from the
commands recorded inline below. Inferences are labeled `INFERENCE:`.

---

## Reference systems (primary-source baseline)

### mem0 — extraction → consolidation → retrieval, LLM-in-the-loop

mem0 runs a **two-phase, LLM-powered pipeline**. Phase 1 (extraction) ingests three
context streams — a rolling conversation summary `S`, the `m` most recent messages, and
the current message pair — and an LLM extracts a set of salient candidate facts `Ω`. Phase
2 (update) retrieves, *for each candidate fact*, the top-`s` semantically similar existing
memories via vector embeddings, then presents candidate + neighbours to an LLM through a
function-calling interface that selects one of four operations: **ADD** (no semantically
equivalent memory exists), **UPDATE** (augment an existing memory), **DELETE** (remove a
memory contradicted by new info), or **NOOP** (no change needed)
([arxiv.org/html/2504.19413v1](https://arxiv.org/html/2504.19413v1)). This A.U.D.N. cycle is
what gives mem0 its "decide what's worth keeping, dedupe, reconcile contradictions"
behavior; it is explicitly LLM-judged, not heuristic
([memo.d.foundation/breakdown/mem0](https://memo.d.foundation/breakdown/mem0)).

mem0 scopes memory by `user_id` (long-term cross-session personalization) and `run_id`
(short-lived session context that resets when complete), with layered retrieval that ranks
user memories first, then session notes, then raw history
([docs.mem0.ai/core-concepts/memory-types](https://docs.mem0.ai/core-concepts/memory-types)).
Retrieval is **hybrid**: semantic vector similarity + BM25 keyword matching + entity-linking
boosts, "scored in parallel and fused," plus time-aware ranking
([github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)). The graph variant `Mem0^g`
stores a directed labeled graph of entities/relationships extracted by an LLM, with dual
entity-centric + semantic-triplet retrieval
([arxiv.org/html/2504.19413v1](https://arxiv.org/html/2504.19413v1)).

Reported results vs baselines on the LOCOMO benchmark: mem0 66.88% / `Mem0^g` 68.44%
LLM-as-judge accuracy (full-context ceiling 72.90%, best RAG ~61%); p95 latency 1.44s /
2.59s vs full-context 17.12s (~92%/85% reduction); ~7k / ~14k tokens per conversation vs
full-context ~26k ([arxiv.org/html/2504.19413v1](https://arxiv.org/html/2504.19413v1)). The
load-bearing takeaway: an LLM-judged extract+reconcile pipeline buys an order-of-magnitude
token/latency reduction at near-full-context accuracy.

### Letta / MemGPT — memory blocks + sleep-time consolidation

Letta models the context window as an OS-style hierarchy: **in-context core memory blocks**
(labeled, size-bounded units like `human` / `persona` / `knowledge`, pinned into the system
prompt, individually persisted in the DB with a `block_id`) and **out-of-context archival /
recall storage** ([letta.com/blog/memory-blocks](https://www.letta.com/blog/memory-blocks);
[docs.letta.com/guides/agents/memory](https://docs.letta.com/guides/agents/memory)). The
agent **self-edits** memory by calling memory tools during its normal reasoning loop —
deciding what to write to core vs archival
([letta.com/blog/agent-memory](https://www.letta.com/blog/agent-memory)).

**Sleep-time compute** is a second, background agent that runs with no user input and
reorganizes memory: it edits both the primary agent's in-context blocks and the archival
store, transforming "raw context" into "learned context" ahead of time. The primary agent
deliberately *lacks* memory-editing tools to avoid in-conversation latency; the sleep agent
operates "anytime" so the primary can read updated memory without blocking
([letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute)).
Letta reports this shifts compute off the latency-critical path without sacrificing quality
on AIME/GSM-class tasks ([letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute)).

### Coding-agent contrast (knowledge persistence)

- **Cline Memory Bank** — a hierarchy of Markdown files (`projectbrief.md`,
  `activeContext.md`, `systemPatterns.md`, `progress.md`, …) that is the agent's *only*
  cross-session store, **read in full at the start of every task** — no embeddings, no
  retrieval, mandatory always-on injection
  ([docs.cline.bot/features/memory-bank](https://docs.cline.bot/features/memory-bank)).
- **OpenHands microagents/skills** — Markdown files with frontmatter triggers, loaded
  **on-demand only when the user message matches keyword triggers**, plus repo-specific
  instructions in `.openhands/microagents/`
  ([github.com/OpenHands/OpenHands/blob/main/skills/README.md](https://github.com/OpenHands/OpenHands/blob/main/skills/README.md)).

INFERENCE: Construct's on-disk skills/rules sit between these two — keyword/hybrid-retrieved
like OpenHands microagents rather than always-on like Cline's Memory Bank.

---

## What Construct does today (cited to repo)

Reproduce: `grep -n` over `lib/storage/`, `lib/reflect/`, `lib/engine/`,
`lib/observation-store.mjs` at commit `a027a9f`.

- **Embedding engine, swappable** — `lib/storage/embeddings-engine.mjs:128-131`: `local`
  = Xenova/all-MiniLM-L6-v2 384d (default), `openai` = text-embedding-3-small 1536d,
  `ollama` = nomic-embed-text 768d, `hashing` = `hashing-bow-v1` 256d described in-repo as
  "Legacy deterministic hash — fast but no semantic understanding" and "fallback / test
  fixture only." The SHA256 bag-of-words fallback is `lib/storage/embeddings-legacy.mjs:17-26`.
  The adapter resolver falls back to `hashing` when an unknown model id is requested
  (`embeddings-engine.mjs:72,85,97`).
- **Vector store** — LanceDB via `lib/storage/vector-client.mjs`; writes use
  `table.mergeInsert('id')` keyed on observation id (`vector-client.mjs:204,281`), i.e.
  upsert-by-id, not append-only duplicates.
- **Session extractor is heuristic, explicitly NOT LLM** — `lib/reflect/extractor.mjs:5`
  ("structured summary suitable for `addObservation()` at session end. No LLM"). It derives a
  summary from session stats (tool-call count, files touched, duration, final assistant
  line) — `extractor.mjs:40-55,161-177`. It writes whenever there was any turn activity
  (`extractor.mjs:30-33`); there is no salience/worth-keeping judgment.
- **Sleep-time consolidation exists** — `lib/engine/consolidate.mjs:1-21` is literally
  titled "sleep-time consolidation for the observation store." It greedy-clusters
  observations by **cosine similarity** (default threshold `0.95`, `consolidate.mjs:35,82-97`),
  merges each cluster to one insight (representative + hit count + member ids + last-seen),
  archives cold/low-confidence observations (`archiveAfterDays: 60`, `archiveBelowConfidence:
  0.5`), and is idempotent/cron-safe. Cluster summarisation via an LM is *optional* — "when
  no summariser is provided, the representative observation's own summary is kept verbatim"
  (`consolidate.mjs:7-10`). Exposed as `construct memory consolidate` (`bin/construct:4206-4218`).
- **Storage-cap remediation points at consolidate** — `lib/observation-store.mjs:114` and
  `bin/construct:971,987` nudge the operator to run `construct memory consolidate` when the
  observation count/size cap is hit.
- **Skills/rules retrieval is hybrid** — 150 skill `.md` + 50 rule `.md`
  (`find skills -name '*.md' | wc -l` → 150; rules → 50), retrieved via the MCP
  `search_skills` tool (`lib/mcp/server.mjs`, `lib/specialists/schema.mjs`) — BM25 + vector
  hybrid per the audit brief.
- **Three persistence mechanisms confirmed** — LanceDB observations (`lib/observation-store.mjs`,
  `lib/storage/vector-client.mjs`), beads memories (`bd remember`, referenced in
  `rules/common/beads-hygiene.md` and CLAUDE.md), and on-disk skills/rules + a separate
  memory MCP server (audit brief; `lib/mcp/server.mjs`).

---

## Verdict against the three key questions

**Q1 — over/under/appropriately built; extraction & consolidation?**
Construct is **under-built on the *decision* layer, appropriately built on the *mechanics*
layer.** It is not naive append-and-embed: it upserts by id (no dup rows), and it *does*
have a sleep-time consolidation pass (cosine clustering + cold archive) that is structurally
the same idea as Letta's sleep-time compute and mem0's update phase. The gap is *what drives
the decision*: mem0's extraction and ADD/UPDATE/DELETE/NOOP are **LLM-judged per fact**
([arxiv.org/html/2504.19413v1](https://arxiv.org/html/2504.19413v1)); Construct's extractor
is deterministic stats with "No LLM" (`lib/reflect/extractor.mjs:5`) and its consolidation is
a fixed `0.95` cosine threshold with the LM summariser optional and *off by default*
(`lib/engine/consolidate.mjs:7-10,35`). So Construct never *decides what is worth keeping*
(it keeps everything with turn activity) and only dedupes *near-identical* text (0.95 is very
tight — paraphrases at 0.85–0.94 survive as separate observations). It has no UPDATE
(supersede a stale fact) or DELETE (retire a contradicted fact) semantics at all.
**Worth closing?** Partially. The biggest cheap win is an *intake* salience filter (don't
embed every stats-summary) and a *lower, contradiction-aware* consolidation that can mark a
prior observation superseded — both achievable with the LM summariser hook that already
exists. Full mem0-style per-fact LLM tool-calling on every Stop is likely *over-build* for a
coding-agent whose richest knowledge is already the curated skills/rules corpus, and it would
add an LLM call to the latency-critical Stop hook — exactly the cost Letta's sleep-time design
exists to avoid.

**Q2 — three overlapping mechanisms: coherent or fragmented?**
**Fragmented, but along defensible seams.** mem0 and Letta each expose **one** memory
substrate with internal tiers (mem0: conversation/session/user/org under one API; Letta:
core blocks + archival under one agent)
([docs.mem0.ai/core-concepts/memory-types](https://docs.mem0.ai/core-concepts/memory-types);
[letta.com/blog/memory-blocks](https://www.letta.com/blog/memory-blocks)). Construct has
three *stores* with three *write paths* and at least two *retrieval paths* (vector
observation search vs `search_skills` vs `bd` queries), which is the classic "where does this
fact live and who reads it back" fragmentation. The defensible part: the three map to
genuinely different lifetimes/ownerships — skills/rules are **curated, human-authored,
versioned** knowledge (Cline/OpenHands-style); observations are **auto-captured, decaying**
session traces (mem0/Letta-archival-style); beads are **task-scoped facts** with their own
issue lifecycle. The incoherence is the absence of a single retrieval front door: a caller
asking "what do we know about X" must hit three subsystems with three relevance models. mem0
avoids this by fusing all layers in one ranked query; Letta avoids it by compiling one
context window from the DB. **Recommendation: keep three stores, unify retrieval** behind one
ranked endpoint.

**Q3 — retrieval adequacy; hashing fallback risk.**
Hybrid BM25+vector is **the right architecture** — it matches mem0's own fusion of semantic +
keyword + entity signals ([github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)) and is
exactly what the audit's own vector-search-best-practices note endorses
(`docs/research/vector-search-best-practices.md`). The real risk is the **256-dim hashing
fallback**: it is the default adapter when an unknown model id is requested
(`embeddings-engine.mjs:72,85,97`) and is self-described as having "no semantic
understanding" (`embeddings-engine.mjs:131`). Bag-of-words hashing collapses to lexical
overlap — it cannot match "auth bug" to "login failure." In a hybrid index the BM25 leg still
fires, but the vector leg becomes **lexical noise scored as if it were semantic**, which is
worse than disabling it: it can *outrank* a true semantic match from a different store, and
the degradation is **silent** (same API, same scores, no warning at query time). This is a
genuine correctness hazard, distinct from the prior-art tools, none of which ship a
semantic-free vector path. **Recommendation: when the engine is `hashing`, mark vectors
non-semantic and let retrieval fall back to BM25-only rather than fusing meaningless cosine
scores; warn once at index/query time.**

---

## Rubric score — skill/knowledge architecture (dim 4)

| Sub-dimension | Construct | mem0 | Letta |
|---|---|---|---|
| Decide what to remember (salience) | ✗ keeps all turn-activity sessions | ✓ LLM extraction | ✓ agent self-edit |
| Dedup / reconcile (UPDATE/DELETE) | ~ 0.95 cosine merge only, no supersede/delete | ✓ A.U.D.N. | ✓ self-edit + sleep |
| Background consolidation | ✓ cosine cluster + cold archive (LM optional, off) | ✓ update phase | ✓ sleep-time compute |
| Scoping (user/session/agent) | ~ observation tags, no first-class scopes | ✓ user/run/org | ✓ blocks + multi-agent share |
| Retrieval quality | ~ hybrid BM25+vector, but hashing-fallback hazard | ✓ fused multi-signal + time-aware | ✓ DB-compiled context |
| One coherent substrate | ✗ three stores, split retrieval | ✓ one API, tiered | ✓ one agent, tiered |

**Score: 2.5 / 5.** Mechanics are present and the on-disk skills/rules corpus is a genuine
strength the memory-tool baselines lack; the gaps are the decision layer, scoping as a
first-class concept, retrieval unification, and the hashing-fallback hazard.

---

## Proposed changes

### Proposal A — BM25-only fallback when embeddings are non-semantic

- **Current**: unknown/`hashing` engine yields 256d bag-of-words vectors that are fused into
  the hybrid score as if semantic (`embeddings-engine.mjs:72,131`; hybrid retrieval in
  `search_skills`).
- **Proposed**: tag the index/engine with a `semantic: false` flag for `hashing`; in hybrid
  retrieval, drop the vector leg and serve BM25-only when that flag is set, and emit a single
  warning at index/query time.
- **Pros**: removes a silent correctness hazard; BM25-only is honest and still useful for
  lexical recall; zero new dependencies.
- **Cons**: makes the degraded mode visibly weaker (some will read that as regression); adds a
  branch to the hot retrieval path.
- **Reasoning**: none of mem0/Letta ship a semantic-free vector path; fusing meaningless
  cosine scores can outrank true matches and the failure is invisible today.
- **Evidence**: `lib/storage/embeddings-engine.mjs:72,85,97,131`;
  `lib/storage/embeddings-legacy.mjs:17-26`;
  [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) (fusion is the only documented
  retrieval mode).
- **Counter-argument**: hashing is "fallback / test fixture only" — if it never runs in real
  installs the hazard is theoretical. **Falsified-if**: telemetry shows no production install
  ever resolves the `hashing` adapter (then the fix is a no-op and only the warning matters).

### Proposal B — intake salience filter + supersede-aware consolidation

- **Current**: extractor writes a stats summary for every active session ("No LLM",
  `lib/reflect/extractor.mjs:5,30`); consolidation merges only ≥0.95-cosine duplicates and
  has no UPDATE/DELETE (`lib/engine/consolidate.mjs:35,82-97`).
- **Proposed**: (1) a cheap intake gate that skips writing low-information sessions
  (e.g. no files touched and no decision/insight tag); (2) lower the consolidation threshold
  band and add a "supersede" outcome that marks an older observation stale when a newer one
  covers it — wiring the *already-present* optional LM summariser hook to make the
  keep/supersede call on borderline clusters.
- **Pros**: closes the mem0 "decide what's worth keeping + reconcile" gap with the
  infrastructure that already exists; keeps the LLM off the latency-critical Stop hook by
  doing it in the sleep-time pass (Letta's exact design choice).
- **Cons**: supersede logic risks dropping still-relevant context if the LM mis-judges;
  tuning the threshold band is empirical work.
- **Reasoning**: Construct already has the sleep-time consolidation skeleton and an LM
  summariser plugin point — the missing piece is the *decision*, not the *mechanism*.
- **Evidence**: `lib/engine/consolidate.mjs:7-10,35`; `lib/reflect/extractor.mjs:5,30`;
  [arxiv.org/html/2504.19413v1](https://arxiv.org/html/2504.19413v1) (A.U.D.N.);
  [letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute)
  (keep heavy memory edits off the user-latency path).
- **Counter-argument**: a coding agent's durable knowledge already lives in curated
  skills/rules + beads; auto-observations may be low-value enough that the right move is to
  *shrink* the observation store, not enrich its pipeline. **Falsified-if**: a retrieval
  ablation shows observation hits rarely change agent output vs skills/rules+beads alone —
  then invest in Proposal C and demote observations, don't build B.

### Proposal C — one ranked retrieval front door over the three stores

- **Current**: three stores, ≥2 retrieval paths (observation vector search, `search_skills`
  hybrid, `bd` queries) with no unified ranking.
- **Proposed**: a single `recall(query, scope)` endpoint that fans out to observations,
  skills/rules, and beads and returns one fused, source-tagged ranked list (BM25+vector per
  store, normalized and merged) — mirroring mem0's parallel-score-and-fuse and Letta's
  single compiled context, without merging the underlying *stores*.
- **Pros**: removes the "which store has this fact" fragmentation; callers get one relevance
  model; keeps the defensible lifetime/ownership separation of the three stores.
- **Cons**: cross-store score normalization is fiddly (BM25 unbounded vs cosine [0,1] — the
  repo already handles this for skills); adds an aggregation layer to maintain.
- **Reasoning**: both reference tools expose exactly one retrieval surface; Construct's
  fragmentation is in retrieval, not storage, so unify retrieval and leave storage alone.
- **Evidence**: `lib/mcp/server.mjs`, `lib/specialists/schema.mjs` (`search_skills`);
  `lib/observation-store.mjs`; CLAUDE.md (beads `bd remember`);
  [docs.mem0.ai/core-concepts/memory-types](https://docs.mem0.ai/core-concepts/memory-types)
  (layered fused retrieval); [letta.com/blog/memory-blocks](https://www.letta.com/blog/memory-blocks).
- **Counter-argument**: three explicit tools may be *clearer* to an agent than one fused
  endpoint whose ranking it can't reason about; merging retrieval could hurt tool-selection
  legibility (rubric dim 2). **Falsified-if**: agents pick the right store >90% of the time [source: Evidence section of this document]
  with the three separate tools and a fused endpoint measurably *lowers* answer quality.
