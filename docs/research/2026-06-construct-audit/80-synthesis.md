---
intake: none
---

# Synthesis — Cross-Cutting Verdicts

Date: 2026-06-10 · Feeds P2 (ADRs + beads). Every claim below traces to a sibling doc in this
directory (10–70) or a spot-verified repo path. This doc integrates; the sibling docs carry the
full Current/Proposed/Pros/Cons/Reasoning/Evidence/Counter/Falsified-if entries.

## The five things the evidence actually says

### 1. The test infrastructure is sound. Do NOT nuke it. (`70-test-infra-verdict.md`)

18 shipped-and-fixed bugs mined from git log + CHANGELOG + beads, classified by the layer that
should have caught each [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]:

- **67% (12/18)** were catchable by an **existing** layer — the test was simply missing or wrong. [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
- **22% (4/18)** needed the **host-emulation** layer that is already ~60% built (`host-mcp-emulation.functional.test.mjs`, `tests/e2e/local-model-ab.mjs`, `ollama-record-proxy`, epic construct-2fm8). [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
- **11% (2/18)** genuinely need a live model/binary (live-e2e). [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]

Strongest single fact: the same fire-and-forget async-write bug shipped **twice, six months apart,
in two files** — and that exact class is the functional suite's own canonical example in
`tests/functional/README.md:50`. The suite re-shipped a bug its own docs name. That is a
**coverage-discipline** failure, not a foundation failure. The suite is integration-weighted (65% of
files spawn a real binary or import a real `lib/` module; only 22% touch mocks) and the mocks that
exist are faithful failure injectors. [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]

**Verdict: EXTEND.** This *confirms* the keep+extend prior, so per the plan's gate we do NOT return
to the user before touching test code — but every test change is additive (no rebuild). The real
fix the maintainer is feeling for is the **missing live-host-session layer**, which is already
partially framed and just needs finishing.

### 2. Skills are 94% dead weight via the documented path; hooks are unmeasured. (`50-proliferation-audit.md`)

- **150 skill files.** Telemetry (`~/.cx/skill-calls.jsonl`, 6,023 events, spot-verified) shows the
  loaded skills are almost entirely `roles/*` pulled by `prompt-composer`; the development/devops/
  security skill corpus is **almost never retrieved** via the agent `get_skill`/`search_skills` path
  (only ~6 ever loaded that way). The lazy-trigger thesis is barely exercised.
- **Hooks: ~41 registrations / 36 wired scripts, 10 can hard-block.** There is **no per-hook value
  measurement** — only `@p95ms` latency budgets and failure/health logs. Nothing records
  fire/block/mutate counts, so we cannot say which hooks earn their keep. The absence is the finding.
- **Claude gets an always-on 28-specialist roster (~979 tok)** that OpenCode/Cursor/VS Code do not
  (they route via runtime `orchestration_policy`). Asymmetric and not justified by capability.
- **Rules: 50 files, zero retrieval telemetry** — frequency unknowable.

External bar (OpenHands microagents, Cline glob-scoped rules, smolagents minimalism, `10-open-agents.md`):
keep the always-on surface tiny, load the rest by trigger. Construct passes on OpenCode, fails on
Claude (roster) and on skills (mostly never retrieved).

**Verdict: INSTRUMENT-FIRST, then consolidate.** Add fire/value telemetry to hooks and rules before
deleting anything; delete/merge skills the telemetry already condemns; demote the Claude roster to
lazy-load to match the other hosts.

### 3. OpenCode integration works WITH the grain; the one real defect is trim SCOPE. (`20-opencode-ecosystem.md`)

Step-0 implementation gate is **resolved** (all maintainer-confirmed against sst/opencode source):

- Config = **deep-merge** (remeda `mergeDeep`), precedence remote → global → project → `.opencode/`
  → inline → managed; nested `mcp`/`agent`/`permission` merge key-by-key, arrays replace.
- `mcp.<id>.enabled` is boolean, **default-enabled**; a **project** config can disable a
  **globally**-enabled server. → project-scoped trim is viable and leaves other projects' cloud
  usage intact.
- Per-agent tool scoping removes **schemas** only via blanket `"*": false` + allowlist (#2752);
  scoped denies/"ask" keep the schema.
- **No per-session/model tool filtering exists** (`chat.params` has no `tools` field); config-time
  disabling is the **endorsed** pattern, not a hack.
- `num_ctx` is **not deliverable over `/v1`**; only Modelfile `PARAMETER num_ctx` works. Confirmed.

So the gateway, the MCP-disable, and the Modelfile variants are all aligned with OpenCode's design.
The **one defect**: Construct disables 5 heavy servers **machine-wide** when Ollama models merely
*exist* on the box (`ollamaHasModels` heuristic), so a cloud-model session loses context7/github.
The fix is **project-scope + intent-driven**, not a redesign. Note the `~12k-token` cost of those
servers is Construct's own unmeasured estimate — flagged `[unverified]`, should be measured.

### 4. Model-tier auto-detection is silently DEAD. (spot-verified, bead construct-uhdb)

`scripts/sync-specialists.mjs:430-432` reads `cfg.model` off `readOpenCodeConfig()`'s `{file,config}`
wrapper (correct form is `.config.model`, as `lib/mcp-manager.mjs:216` does). `primaryFromOpenCode`
is therefore always null → tier auto-detection never fires for OpenCode-selected models. This is a
**prerequisite** for any intent-driven trim or capability-honesty `auto` mode — fix it first.

### 5. Third-party fit: 3 keep, 4 keep-but-adjust, 0 replace. (`60-third-party-strategic-eval.md`)

| Tool | Verdict | The adjustment |
|---|---|---|
| docling | keep-but-adjust | Official **docling-mcp v2.0** now exists with a remote mode that deletes our ~500MB local-model + uv-venv sidecar liability. The maintainer's "different approach?" has a concrete answer: adopt docling-mcp. |
| beads/bd + Dolt | keep-but-adjust | CLI-wrap is upstream-endorsed and `bd dolt push` does leverage Dolt versioning, but our `commitHash`-as-version optimistic CAS is a **racy reimplementation** of concurrency Dolt already owns — retire it. |
| LanceDB | **keep** | Embedded use is intended; team-mode pgvector is a **stub** (`lib/storage/backend.mjs:5`, spot-verified), so LanceDB is the only live vector store — not duplicative. |
| Ollama | **keep** | Modelfile variants are textbook and the only lever vs `/v1` num_ctx drop. Best fit in the stack. |
| OpenCode | **keep** | Non-destructive merge + plugin is endorsed; only the trim scope (item 3) needs narrowing. |
| external MCP | keep-but-adjust | `sequential-thinking` is mis-classified `core` — demote to opt-in; context7 earns always-on. |
| embeddings | keep-but-adjust | The **256-dim hashing fallback as implicit default** is a latent hazard: silent quality loss + 256-vs-384 dimension mismatch against LanceDB's fixed schema, contradicting the file's own anti-silent-fallback doctrine. Make it fail-loud or fall to `local`. |

### 6. Borrowed patterns from respected agents. (`10-open-agents.md`, `30-specs-standards.md`, `40-memory-knowledge.md`)

- **Cline "Use Compact Prompt" + per-model-family tool variants** — direct precedent for serving
  COLLAPSED/local models a smaller surface by declared model strategy.
- **Goose Lead/Worker model split** (`GOOSE_LEAD_MODEL`/`GOOSE_MODEL`) — cleanest shipped precedent
  for local/cloud divergence as a declared mode (informs WS4 / ADR-0034).
- **OpenHands microagents** — trigger-scoped knowledge is the reference design for the skills problem
  in item 2.
- **aider edit-format-by-capability + leaderboard** — external analog of Construct's coherence probe;
  validates probe-gated behavior.
- **MCP spec / cross-lab tool guidance** — the `construct_call` dispatcher is tolerated (not an
  anti-pattern) but it's enum-deferral, not Anthropic-style consolidation, and the enum only binds if
  the local host grammar-constrains decoding (ties to construct-0w45). AGENTS.md: the parallel
  CLAUDE.md body fights the standard's single-file ethos.
- **mem0/Letta** — Construct already has consolidation (`lib/engine/consolidate.mjs`), but lacks a
  salience/extraction decision layer (`lib/reflect/extractor.mjs:5` is explicitly "No LLM", no
  UPDATE/DELETE/supersede). Gap is real but lower-priority than items 1–4.

## What this drives in P2

ADRs:
- **Revise ADR-0032** — fold in the confirmed OpenCode config semantics (project-scope trim is the
  correct lever), the probe-validated floor, and the divergence-allowed clause.
- **New ADR-0033 — platform capability registry** (WS1; kills the inline hard-coding catalogued in
  the architecture map: HOST_KEYS, hasNativeSubagents, hook allowlist, Copilot instructions-only,
  Modelfile-provisioning conditional, the asymmetric Claude roster).
- **New ADR-0034 — local-vs-cloud methodology as a declared mode** (WS4; Goose lead/worker +
  Cline compact-prompt are the precedents). Written either way; record rejection if WS2/WS3 make
  `auto` sufficient.
- **New ADR-0035 — test strategy = EXTEND** (finish the live-host-session layer; add hook/rule value
  telemetry; coverage-discipline gate so README-named bug classes can't re-ship).
- **Amendments** for docling-mcp adoption, beads-CAS retirement, sequential-thinking demotion,
  hashing-fallback fail-loud.

Top-priority implementation tranche (this pass, epic construct-5eta):
1. Fix construct-uhdb (dead tier detection) — prerequisite.
2. WS1 platform capability registry.
3. WS2 project-scoped, intent-driven MCP trim (`decideTrim`).
4. WS3 capability-honesty probe persistence + consumers.
5. WS4 declared model-strategy mode — gated on ADR-0034; ship `auto` only if evidence says the knob
   is ceremony.

Everything else (skills consolidation, hook/rule instrumentation, docling-mcp, beads-CAS retirement,
embedding fail-loud, memory salience layer, AGENTS.md single-file) becomes prioritized backlog beads,
not this-pass work.
