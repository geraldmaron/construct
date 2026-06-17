# 10 — Open-Source Coding Agents Benchmark

Date: 2026-06-09 · Branch: research/capability-registry · Bead: construct-0oiv
Scope: aider, Cline/Roo Code, Goose, OpenHands, smolagents — primary sources only (GitHub repos + official docs).

This doc benchmarks Construct's methodology against five community-respected open-source coding
agents across the six audit dimensions (prompt economy, tool surface design, local-model strategy,
skill/knowledge architecture, hook/gate philosophy, test strategy). Every load-bearing claim cites a
URL with the specific page inspected. Inferences are labeled `INFERENCE:`.

## Construct baseline (established facts, not re-verified here)

- 1 persona + 28 specialists injected via `specialists/registry.json`.
- 150 skills + 50 rules on disk, retrieved lazily via MCP `get_skill` / `search_skills`.
- `construct-mcp` exposes 7 core tools + a `construct_call` dispatcher (was 71 flat tools; gateway cut
  the tool-definition surface ~10.6k → ~3.4k tokens).
- ~53 Claude Code hook registrations across 7 lifecycle events.
- Local models: Ollama Modelfile context variants + an agentic-coherence probe that marks
  `qwen2.5-coder:7b` COLLAPSED and `qwen3-coder` / `devstral` COHERENT.

Scoring legend per dimension: a short verdict (Strong / Adequate / Weak / N/A for that subject's
emphasis) plus cited evidence. The point is not to rank the tools but to extract transferable design
decisions.

---

## Subject 1 — aider (Aider-AI/aider)

### Prompt economy — Strong (repo-map is a budgeted, ranked context primitive)

aider builds "a concise map of your whole git repository that includes the most important classes and
functions along with their types and call signatures" rather than dumping files. For large repos it
uses "a graph ranking algorithm, computed on a graph where each source file is a node and edges
connect files which have dependencies," prioritizing "the most important identifiers, the ones which
are most often referenced by other portions of the code." The map runs within a configurable budget:
`--map-tokens` defaults to 1k, and aider "adjusts the size of the repo map dynamically based on the
state of the chat… it does expand the repo map significantly at times, especially when no files have
been added to the chat."
Evidence: https://aider.chat/docs/repomap.html

INFERENCE: This is a budgeted, relevance-ranked retrieval layer — directly analogous in intent to
Construct's lazy skill retrieval, but aider's budget is explicit and self-tuning per turn, whereas
Construct's always-on injection (persona + 28 specialists) is not budget-aware at rest.

### Tool surface design — Adequate (edit formats are the "tool surface", matched to model capability)

aider's notion of a tool surface is its edit format. It ships `whole` (full file rewrite — "the LLM
has to return the entire file even if just a few lines are edited"), `diff` (search/replace, "syntax
similar to the git merge conflict resolution markings"), `diff-fenced` (diff inside a fence, created
because the "Gemini family of models… often fail to conform to the fencing approach specified in the
diff format"), and `udiff` ("the widely used unified diff format, but modified and simplified… mainly
used with GPT-4 Turbo family of models, because it reduced their 'lazy coding' tendencies"). aider is
"configured to use the optimal format for most popular, common models," overridable via
`--edit-format`.
Evidence: https://aider.chat/docs/more/edit-formats.html

The key design move: **the interaction format is selected per model, not fixed.** Weaker models get
`whole` (simplest to emit correctly); stronger models get `diff`/`udiff` (cheaper, but require the
model to produce a precise patch).

### Local-model strategy — Strong (this is the single most relevant external precedent)

aider's Ollama page is the sharpest local-model guidance found: "Ollama uses a 2k context window by
default, which is very small for working with aider," and critically "It also **silently** discards
context that exceeds the window. This is especially dangerous because many users don't even realize
that most of their data is being discarded by Ollama." aider's mitigation is automatic: it "expands
Ollama's context window to accommodate each request plus 8k tokens for responses," and documents
manual control via `.aider.model.settings.yml` `num_ctx` (example 65536) and
`OLLAMA_CONTEXT_LENGTH`.
Evidence: https://aider.chat/docs/llms/ollama.html

This validates Construct's Ollama Modelfile context-variant approach: silent truncation is the named
failure mode, and the fix is to set context explicitly rather than trust the default.

### Skill/knowledge architecture — N/A emphasis (no skill catalog; the repo-map IS the knowledge layer)

aider does not ship a declarative skill/rule catalog. Project-specific knowledge lives in
`CONVENTIONS.md` added to the chat, and the codebase itself is the knowledge base via the repo-map.
Evidence: https://aider.chat/docs/repomap.html (repo-map as the structural knowledge primitive); the
docs index shows no skills/microagents subsystem: https://aider.chat/docs/

### Hook/gate philosophy — Adequate (model gating via leaderboard, not lifecycle hooks)

aider's "gate" is empirical, not procedural. The polyglot leaderboard runs "225 challenging Exercism
coding exercises across C++, Go, Java, JavaScript, Python, and Rust" and reports both task pass rate
and "percent correct edit format" per model — formatting compliance "separate from whether the code
logic itself works." This functions as de-facto capability gating: it tells you which models can hold
a given edit format reliably before you trust them with autonomous edits.
Evidence: https://aider.chat/docs/leaderboards/

INFERENCE: aider's leaderboard is the external analog of Construct's agentic-coherence probe — both
answer "can this model be trusted with the harder interaction surface?" — but aider's is a public,
task-grounded benchmark, whereas Construct's probe is a single internal coherence check.

### Test strategy — Strong for model-capability validation

The leaderboard benchmark doubles as aider's regression harness for model/format compatibility: a new
model or format is run against the 225-exercise suite end-to-end.
Evidence: https://aider.chat/docs/leaderboards/

### What Construct should steal
- **A token-budgeted, relevance-ranked context layer** (repo-map style) that the system self-tunes per
  turn, instead of fixed always-on injection.
- **Per-model interaction-format selection**: pick the diff/edit/tool format by probed capability,
  exactly as aider picks `whole` vs `diff` — Construct already has the probe; it should drive surface
  shape, not just a COHERENT/COLLAPSED label.
- The **explicit "silent truncation is the enemy"** framing for the local-model docs.

### What Construct should avoid
- aider's near-total lack of a durable knowledge layer beyond the repo-map would be a regression for
  Construct's multi-specialist, multi-session model. Don't over-rotate to "the codebase is the only
  context."

---

## Subject 2 — Cline / Roo Code (cline/cline, RooCodeInc/Roo-Code)

### Prompt economy — Strong (modular, model-family-variant system prompt + a "compact prompt" mode)

Cline's system prompt is assembled, not static: it lives under `src/core/prompts/system-prompt/` and
is "dynamically constructed as an async function based on the current working directory, browser
support status, and available MCP servers," with tools (LIST_FILES, BROWSER, WEB_FETCH, MCP_USE,
NEW_TASK, PLAN_MODE, TODO, etc.) carrying "specific variants for different model families." Roo Code
mirrors this with `system.ts`, a `sections/` subdirectory of "reusable, specialized components," and a
`tools/` directory, plus `__tests__/`.
Evidence (Cline): https://github.com/cline/cline/tree/main/src/core/prompts/system-prompt and
https://github.com/cline/cline/blob/main/src/core/prompts/system-prompt/tools/execute_command.ts
Evidence (Roo): https://github.com/RooCodeInc/Roo-Code/tree/main/src/core/prompts

Crucially for local models, Cline ships a **"Use Compact Prompt"** toggle (Settings → Features)
explicitly recommended for local inference.
Evidence: https://docs.cline.bot/running-models-locally/ollama

INFERENCE: Cline's compact-prompt + per-model tool variants is the strongest precedent for Construct
serving a *smaller* prompt/tool surface to COLLAPSED-class local models rather than a uniform surface.

### Tool surface design — Adequate (curated built-ins + opt-in MCP, approval-gated)

Cline keeps a curated built-in tool set and treats MCP as additive: "MCP lets Cline use external
tools and data sources through MCP servers," addable via marketplace one-click, `~/.cline/mcp.json`,
or a CLI wizard. The stance is controlled disclosure — "Review tool calls before approval," "Limit
`autoApprove` to safe tools," "Only install servers you trust."
Evidence: https://docs.cline.bot/mcp/mcp-overview

### Local-model strategy — Strong (RAM-tiered guidance + compact prompt + focus-the-context advice)

Cline tiers hardware to model size ("16-32GB | Small/quantized models," "32-64GB | Mid-size coding
models," "64GB+ | Larger models and bigger context windows") and advises "Keep tasks focused (smaller
context = faster responses)," "Start a new task when context gets too large," and "Enable Use Compact
Prompt." It does not loudly warn against small models but encodes the limit through the tiers.
Evidence: https://docs.cline.bot/running-models-locally/ollama

### Skill/knowledge architecture — Strong (`.clinerules/` with conditional, glob-scoped activation)

Cline's `.clinerules/` are "markdown files that provide persistent instructions across all
conversations," combining "all `.md` and `.txt` files inside `.clinerules/` into a unified set of
rules," with per-rule enable/disable toggles. The load-bearing feature: **conditional rules** via YAML
frontmatter glob patterns — "Without conditionals: every rule loads for every request. With
conditionals, rules activate only when your current files match their defined scope," so "your
frontend rules won't compete for attention when you're deep in backend code." It also reads
`AGENTS.md`, `.cursorrules`, `.windsurfrules` for cross-tool compatibility.
Evidence: https://docs.cline.bot/features/cline-rules

INFERENCE: This is glob-scoped lazy injection of rules — directly applicable to Construct's 50 rules,
which today are on-disk but not file-pattern-scoped to the current edit context.

### Hook/gate philosophy — Adequate (human approval as the primary gate, plan/act modes)

Cline's primary gate is per-tool-call human approval plus a PLAN_MODE/ACT split, not a large
lifecycle-hook array.
Evidence: https://docs.cline.bot/mcp/mcp-overview (approval gating); system-prompt PLAN_MODE tool:
https://github.com/cline/cline/tree/main/src/core/prompts/system-prompt

### Test strategy — Adequate (prompt-assembly is unit-tested)

Roo Code ships `__tests__/` alongside the prompt sections, indicating the prompt-assembly logic itself
is under test.
Evidence: https://github.com/RooCodeInc/Roo-Code/tree/main/src/core/prompts

### What Construct should steal
- **A "compact prompt" variant gated on the local-model probe** — the single highest-value, lowest-risk
  borrow. COLLAPSED models get the small surface; COHERENT/cloud get the full one.
- **Glob-scoped conditional rules**: attach Construct's 50 rules to file globs so only relevant rules
  enter context, instead of treating the rule set as uniformly retrievable.

### What Construct should avoid
- Cline's reliance on per-call human approval as the main gate doesn't fit Construct's autonomous /
  multi-specialist posture; keep automated gates, but borrow the *prompt-shrinking* idea, not the
  approval-everything idea.

---

## Subject 3 — Goose (block / aaif-goose)

### Prompt economy — Adequate (lean core; extensions add surface only when enabled)

Goose's prompt/tool surface grows only by enabling extensions, which "are built as MCP servers." It
can connect to 70+ extensions "via the Model Context Protocol open standard," but they are opt-in, so
the at-rest surface stays lean.
Evidence: https://github.com/block/goose ; https://block.github.io/goose/docs/mcp/developer-mcp/

### Tool surface design — Strong (everything is an MCP extension; built-in Developer extension)

Goose unifies its tool model on MCP: built-in extensions (e.g. the Developer extension for "file
editing, shell command execution, and project setup") and external ones are the same shape.
Evidence: https://block.github.io/goose/docs/tutorials/developer-mcp/ ;
https://block.github.io/goose/docs/guides/custom-extensions/

Goose also ships a **Tool Router (preview)** to manage tool surface as it grows.
Evidence: https://block.github.io/goose/docs/guides/tool-router/

### Local-model strategy — Strong (Lead/Worker is THE precedent for local/cloud divergence)

This is the headline finding for Construct. Goose supports "automatic model switching with Lead/Worker
mode, which provides turn-based switching between two models to help balance model capabilities with
cost and speed." The lead model handles "reasoning and planning"; the worker is "faster and cheaper";
Goose escalates back to the lead when "the worker gets stuck." Config: `GOOSE_LEAD_MODEL` (e.g.
`gpt-4o`) + `GOOSE_MODEL` (worker), with tunables `GOOSE_LEAD_TURNS` ("how many turns the lead handles
upfront") and `GOOSE_LEAD_FAILURE_THRESHOLD` ("how many consecutive failures trigger fallback").
Evidence: https://raw.githubusercontent.com/aaif-goose/goose/main/documentation/blog/2025-06-16-multi-model-in-goose/index.md

Separately, Goose's plan mode uses `GOOSE_PLANNER_PROVIDER` / `GOOSE_PLANNER_MODEL` so a strong model
plans and a different model executes.
Evidence: https://block.github.io/goose/docs/guides/multi-model/creating-plans/

Default numeric values for `GOOSE_LEAD_TURNS` / `GOOSE_LEAD_FAILURE_THRESHOLD` / `GOOSE_LEAD_FALLBACK_TURNS`
are `[unverified]` — the multi-model blog names the variables but not defaults; community references
cite examples (`GOOSE_LEAD_TURNS=5`, `GOOSE_LEAD_FAILURE_THRESHOLD=2`, `GOOSE_LEAD_FALLBACK_TURNS=3`)
from a non-primary source (https://github.com/block/goose/issues/4036), so treat as illustrative only.

INFERENCE: Goose proves that a planner/executor (lead/worker) split — strong model for planning turns,
weaker/cheaper or local model for execution — is a shipped, configurable pattern. This is the cleanest
precedent for Construct letting a COHERENT cloud model plan while a COHERENT-but-smaller local model
executes, instead of forcing one model through the whole methodology.

### Skill/knowledge architecture — Strong (recipes package reusable configs)

Goose recipes package a reusable agent configuration — instructions/prompt + extensions + parameters —
into a shareable unit, letting a curated setup be invoked repeatedly.
Evidence: https://block.github.io/goose/docs/guides/recipes/ (recipe structure) ;
https://block.github.io/goose/docs/guides/custom-extensions/

INFERENCE: Recipes are a coarser-grained analog of Construct's persona+specialist+skill bundles; the
transferable idea is *parameterized, named bundles* rather than a flat catalog.

### Hook/gate philosophy — Adequate (allowlist + tool router as the gates)

Goose gates tool access via an extension allowlist and a tool router rather than many lifecycle hooks.
Evidence: https://block.github.io/goose/docs/guides/allowlist/ ;
https://block.github.io/goose/docs/guides/tool-router/

### Test strategy — [unverified] from docs

No primary-source test-harness page was located within this pass; `[unverified]`.

### What Construct should steal
- **Lead/Worker (planner/executor) model split**, config-driven: let a strong model own the first N
  planning turns / hard decisions and a smaller (possibly local) model own execution, with
  failure-triggered escalation back to the lead. Construct's probe already classifies models — this
  gives the classification an action.
- **Recipes**: parameterized, named bundles of persona+tools+instructions as a first-class artifact.

### What Construct should avoid
- Goose's "everything is an MCP extension, 70+ available" can re-introduce exactly the flat-tool
  sprawl Construct just collapsed behind `construct_call`. Adopt lead/worker, not the unbounded
  extension surface.

---

## Subject 4 — OpenHands (All-Hands-AI/OpenHands)

### Prompt economy — Strong (microagents = trigger-scoped, on-demand knowledge)

OpenHands' "skills/microagents" are "specialized prompts that enhance OpenHands with domain-specific
knowledge." They split into permanent context (`AGENTS.md`, always-on repo guidelines) and
keyword-triggered skills "activated by specific user input." The economy argument is explicit:
"On-demand skills help keep the system prompt smaller because the agent sees a summary first and reads
the full content only when needed," and "permanent context is injected universally, whereas triggered
skills remain dormant until activated, optimizing token efficiency." Keyword-triggered skills require
frontmatter (triggers), which is mandatory for that type but optional for general skills.
Evidence: https://docs.openhands.dev/usage/prompting/microagents-overview

INFERENCE: This is the cleanest external statement of the exact thesis Construct's audit is testing:
prefer a small always-on core (AGENTS.md tier) + a large body of trigger-scoped knowledge that loads
only on keyword match — rather than a large always-on surface. OpenHands' summary-first-then-read
pattern maps onto Construct's `search_skills` → `get_skill`, but OpenHands adds *automatic keyword
triggering* that Construct's pull-based MCP retrieval lacks.

### Tool surface design — Adequate (agent + runtime; tools defined per agent class)

Tools are defined per agent class within the evaluation/runtime harness rather than as one global flat
list.
Evidence: https://docs.openhands.dev/openhands/usage/developers/evaluation-harness (configuration
"defining agent class, runtime, iterations, and container images").

### Local-model strategy — [partial]

Not deeply covered in the pages inspected this pass; treat local-model specifics as `[unverified]`
here. OpenHands' strength for this audit is knowledge architecture and evaluation, not local-model
guidance.

### Skill/knowledge architecture — Strong (the reference design for trigger-scoped injection)

Two tiers, by design: `AGENTS.md` permanent context vs keyword-triggered microagents that "activate
only when conditions are met — either user keywords match or the agent decides to invoke them."
Organization and global tiers exist for team/community sharing.
Evidence: https://docs.openhands.dev/usage/prompting/microagents-overview

### Hook/gate philosophy — N/A emphasis; gating expressed as eval gates

OpenHands' notable gate is its evaluation harness, not lifecycle hooks (see Test strategy).

### Test strategy — Strong (a real, multi-benchmark evaluation harness)

OpenHands ships a first-class evaluation harness that "manages the interaction between the agent, the
runtime, and the task," processing instances and scoring via `run_evaluation` with parallelization.
Benchmarks live in `evaluation/benchmarks/` (e.g. `swe_bench`), and new benchmarks are integrated by
starting from the closest existing one.
Evidence: https://docs.openhands.dev/openhands/usage/developers/evaluation-harness ;
https://github.com/All-Hands-AI/OpenHands/blob/main/evaluation/benchmarks/swe_bench/README.md
A search result claims "15 established benchmarks" but the harness page itself does not state a count,
so the exact number is `[unverified]`.

### What Construct should steal
- **Keyword-triggered injection** for the 150 skills: a frontmatter `triggers` field so a skill auto-
  enters context on match, instead of relying solely on the agent choosing to call `search_skills`.
- **A two-tier knowledge model**: a tiny always-on `AGENTS.md`-equivalent core + a large trigger-scoped
  body — the audit's central hypothesis, already shipped here.
- **An end-to-end evaluation harness** (SWE-bench-style) as the regression gate for methodology
  changes, complementing the functional tests Construct already mandates.

### What Construct should avoid
- OpenHands keeps the always-on tier deliberately tiny (AGENTS.md). Construct should not let the
  "always-on" persona+28-specialist surface stay large just because trigger-scoped loading exists below
  it — the two-tier model only pays off if the top tier is genuinely small.

---

## Subject 5 — smolagents (huggingface/smolagents)

### Prompt economy — Strong (radical minimalism — the strongest counter-argument to a big surface)

smolagents is the explicit minimalist counterweight: "the logic for agents fits in ~1,000 lines of
code," with abstractions "deliberately kept minimal, prioritizing transparency and hackability over
heavy frameworks." Its core thesis is code-as-action: "Our CodeAgent writes its actions in code (as
opposed to agents being used to write code)," and code actions are claimed to use "30% fewer steps
(thus 30% fewer LLM calls) and reach higher performance on difficult benchmarks" than JSON tool calls.
Evidence: https://github.com/huggingface/smolagents

The conceptual guide grounds this: code beats JSON on **composability** ("could you nest JSON actions
within each other… the same way you could just define a python function?"), **object management**,
**generality**, and **representation in LLM training data** — and cites *Executable Code Actions Elicit
Better LLM Agents* (https://huggingface.co/papers/2402.01030).
Evidence: https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents

The same guide also argues *against* agency when avoidable: "it's advised to regularize towards not
using any agentic behaviour" when a deterministic workflow suffices.
Evidence: https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents

INFERENCE: smolagents is the sharpest case that a large declarative prompt/tool/skill surface is the
wrong default — a single code-action channel can replace many JSON tool schemas, which is the same
direction Construct already moved (71 flat tools → 7 tools + `construct_call`). It argues Construct
could go further: collapse much of the tool surface into one code-execution channel.

### Tool surface design — Strong (one code channel replaces many tool schemas)

Tools become ordinary Python functions the agent composes in a single code block, instead of N JSON
schemas the model must select among. This is the maximal version of Construct's dispatcher idea.
Evidence: https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents (agency spectrum table,
"Code Agents" row)

### Local-model strategy — [unverified] for explicit local guidance

smolagents runs any model (incl. local via `InferenceClientModel`/transformers), but no dedicated
local-context-window guidance page was found in this pass; `[unverified]`.

### Skill/knowledge architecture — N/A emphasis (knowledge = composable Python, not a catalog)

Reusable capability is a Python function/tool, not a markdown skill catalog.
Evidence: https://github.com/huggingface/smolagents (tools as functions)

### Hook/gate philosophy — Strong (security IS the gate; sandboxed execution)

Because code-as-action grants high agency, smolagents makes execution security the central gate. By
default `CodeAgent` "runs LLM-generated code in your environment… inherently risky." It ships a custom
`LocalPythonExecutor` that walks the AST, disallows imports unless allowlisted, blocks harmful
submodules (e.g. `random._os`), and caps operations to stop infinite loops — but warns "no local
python sandbox can ever be completely secure," recommending remote sandboxes (E2B / Docker / Modal /
Blaxel) for untrusted models, noting "code agents give much higher agency to the LLM on your system…
this goes hand-in-hand with higher risk."
Evidence: https://huggingface.co/docs/smolagents/tutorials/secure_code_execution

### Test strategy — [unverified] from inspected pages

Benchmark claims (30% fewer steps) are cited to the paper; smolagents' own test layout was not [source: Evidence section of this document]
inspected this pass — `[unverified]`.

### What Construct should steal
- The **minimalism prior**: every always-on item must justify its tokens; default to the smallest
  surface and add only on evidence. This is the audit's thesis, stated by smolagents as a design law.
- Consider a **single code-action channel** as the long-horizon evolution of `construct_call` — one
  composable execution surface instead of many tool schemas.
- The **"regularize toward less agency"** principle: don't add agentic machinery where a deterministic
  path works.

### What Construct should avoid
- Full code-as-action raises the security bar sharply; smolagents itself says local sandboxes are never
  fully safe. Construct should NOT adopt unconstrained code execution without a sandbox story — adopt
  the minimalism, gate the execution.

---

## Cross-subject synthesis for Construct

The five subjects converge on one message: **keep the always-on surface tiny and make everything else
load on evidence (probe, glob, or keyword).** Construct already started this with the MCP gateway; the
external precedents say to push it into the prompt, the rules, the skills, and the local-model path.
Below are the highest-value, evidence-backed changes, in the audit template.

### Synthesis 1 — Probe-gated compact surface for local models

- **Current** — One persona + 28 specialists + 7 MCP tools + `construct_call` are injected uniformly;
  the agentic-coherence probe only labels models COHERENT/COLLAPSED, it does not reshape the surface.
- **Proposed** — Serve a "compact" prompt/tool variant to COLLAPSED-class and small local models
  (smaller specialist set, fewer tool schemas), full surface to COHERENT/cloud. Drive the choice off
  the existing probe.
- **Pros** — Directly attacks the OpenCode-collapse problem; lowest-risk borrow (Cline ships exactly
  this toggle); reuses infrastructure Construct already has.
- **Cons** — Two surfaces to maintain and test; risk of behavioral drift between variants.
- **Reasoning** — Cline's "Use Compact Prompt" for local inference + aider's per-model edit-format
  selection both show the interaction surface should scale to model capability, not stay uniform.
- **Evidence** — https://docs.cline.bot/running-models-locally/ollama ;
  https://aider.chat/docs/more/edit-formats.html
- **Counter-argument** — Variant proliferation re-introduces the maintenance cost the gateway just
  removed; a single well-budgeted surface might suffice.
- **Falsified-if** — A COLLAPSED model probes COHERENT on the *full* surface once context is set
  correctly (i.e., the problem is context-window/truncation, not surface size), making the compact
  variant unnecessary.

### Synthesis 2 — Lead/Worker (planner/executor) model split

- **Current** — A single model is expected to carry the whole methodology end-to-end, locally or in
  cloud.
- **Proposed** — Adopt a Goose-style lead/worker split: a strong (cloud) lead owns the first N planning
  turns and hard decisions; a smaller/local worker owns execution; escalate back to lead on repeated
  failure. Make it config-driven and probe-aware.
- **Pros** — Lets local models do what they're good at (execution) without owning planning; turns the
  probe's classification into an action; shipped precedent exists.
- **Cons** — Multi-model orchestration complexity; turn-handoff state to manage; latency of switching.
- **Reasoning** — Goose ships `GOOSE_LEAD_MODEL`/`GOOSE_MODEL` + `GOOSE_LEAD_TURNS` +
  `GOOSE_LEAD_FAILURE_THRESHOLD`, explicitly to "balance model capabilities with cost and speed," with
  failure-triggered escalation.
- **Evidence** — https://raw.githubusercontent.com/aaif-goose/goose/main/documentation/blog/2025-06-16-multi-model-in-goose/index.md ;
  https://block.github.io/goose/docs/guides/multi-model/creating-plans/
- **Counter-argument** — Handoff coordination cost may exceed the benefit if local models can't even
  execute reliably (qwen2.5-coder:7b is COLLAPSED), and the synthesis-1 compact surface might already
  capture most of the gain.
- **Falsified-if** — A COHERENT local model executing under a cloud-produced plan performs no better
  than the same local model planning+executing alone, on a fixed task suite.

### Synthesis 3 — Trigger-scoped knowledge (keyword + glob) over uniform retrieval

- **Current** — 150 skills + 50 rules sit on disk, retrieved pull-only via `search_skills`/`get_skill`;
  nothing auto-activates by file pattern or keyword.
- **Proposed** — Add OpenHands-style frontmatter `triggers` to skills (auto-inject on keyword match)
  and Cline-style glob scoping to the 50 rules (a rule enters context only when current files match its
  globs). Keep a tiny always-on core (AGENTS.md tier).
- **Pros** — Cuts always-on tokens while improving recall (relevant knowledge arrives without the agent
  having to think to fetch it); both patterns are shipped and documented.
- **Cons** — Trigger/glob authoring overhead across 200 artifacts; mis-scoped triggers cause silent
  knowledge gaps.
- **Reasoning** — OpenHands: "On-demand skills help keep the system prompt smaller because the agent
  sees a summary first and reads the full content only when needed." Cline conditional rules: "With
  conditionals, rules activate only when your current files match their defined scope."
- **Evidence** — https://docs.openhands.dev/usage/prompting/microagents-overview ;
  https://docs.cline.bot/features/cline-rules
- **Counter-argument** — Pull-based MCP retrieval already gives lazy loading; auto-triggering risks
  re-inflating context with marginally-relevant matches, recreating the proliferation problem.
- **Falsified-if** — Telemetry shows the agent already retrieves the right skill/rule via `search_skills`
  on >90% of tasks, so auto-triggering adds tokens without improving outcomes. [source: Evidence section of this document]

### Synthesis 4 — A budgeted, relevance-ranked context layer

- **Current** — Always-on injection (persona + 28 specialists) is not token-budget-aware at rest.
- **Proposed** — Borrow aider's repo-map discipline: a per-turn token budget for injected context,
  self-tuned (expand when little is loaded, contract when the chat is full), with relevance ranking
  deciding what makes the cut.
- **Pros** — Caps worst-case at-rest tokens; degrades gracefully on small-context local models; aligns
  with the silent-truncation risk aider documents.
- **Cons** — Ranking/budgeting machinery to build and tune; wrong ranking can starve the model of
  needed context.
- **Reasoning** — aider's repo-map is budgeted (`--map-tokens` 1k default), dynamically resized, and
  PageRank-ranked; the same discipline applied to specialists/skills caps the always-on cost.
- **Evidence** — https://aider.chat/docs/repomap.html ; https://aider.chat/docs/llms/ollama.html
  (silent truncation as the failure mode a budget prevents)
- **Counter-argument** — Construct's injected items (persona, specialists) are higher-value and lower-
  count than a whole repo-map; a flat budget may evict load-bearing context.
- **Falsified-if** — Removing the lowest-ranked injected specialists/skills measurably degrades task
  quality, proving the current surface is already near-minimal.

### Synthesis 5 — Methodology regression gate via an evaluation harness

- **Current** — Functional tests (`tests/functional/`) assert on durable artifacts, but there is no
  task-grounded benchmark that scores whether a methodology change helps or hurts real outcomes.
- **Proposed** — Stand up an OpenHands/aider-style evaluation harness (SWE-bench-class task suite +
  per-model edit-format/coherence scoring) as a gate for methodology and local-model changes.
- **Pros** — Replaces intuition with measured pass-rate deltas; catches regressions the artifact tests
  can't; gives the probe and compact-surface decisions an empirical scoreboard.
- **Cons** — Significant infrastructure and runtime cost; benchmark maintenance; risk of overfitting to
  the suite.
- **Reasoning** — OpenHands ships a `run_evaluation` harness over `evaluation/benchmarks/`; aider's
  leaderboard is its model/format regression suite. Both make capability claims falsifiable.
- **Evidence** — https://docs.openhands.dev/openhands/usage/developers/evaluation-harness ;
  https://aider.chat/docs/leaderboards/
- **Counter-argument** — For a meta-system, a full SWE-bench harness may be disproportionate; the
  existing functional tests plus the coherence probe might cover the real risks at far lower cost.
- **Falsified-if** — Methodology changes that pass the functional suite never regress real task
  outcomes in a sampled run, showing the harness would never have caught anything the cheaper gates
  missed.

---

### Source index (primary)

- aider repo-map: https://aider.chat/docs/repomap.html
- aider edit formats: https://aider.chat/docs/more/edit-formats.html
- aider Ollama/local context: https://aider.chat/docs/llms/ollama.html
- aider leaderboard: https://aider.chat/docs/leaderboards/
- Cline system-prompt dir: https://github.com/cline/cline/tree/main/src/core/prompts/system-prompt
- Cline rules (conditional/glob): https://docs.cline.bot/features/cline-rules
- Cline MCP overview: https://docs.cline.bot/mcp/mcp-overview
- Cline local models / compact prompt: https://docs.cline.bot/running-models-locally/ollama
- Roo Code prompts dir: https://github.com/RooCodeInc/Roo-Code/tree/main/src/core/prompts
- Goose multi-model (lead/worker): https://raw.githubusercontent.com/aaif-goose/goose/main/documentation/blog/2025-06-16-multi-model-in-goose/index.md
- Goose planner/executor: https://block.github.io/goose/docs/guides/multi-model/creating-plans/
- Goose extensions/recipes/tool-router: https://block.github.io/goose/docs/guides/recipes/ ,
  https://block.github.io/goose/docs/tutorials/developer-mcp/ ,
  https://block.github.io/goose/docs/guides/tool-router/ , https://block.github.io/goose/docs/guides/allowlist/
- OpenHands microagents: https://docs.openhands.dev/usage/prompting/microagents-overview
- OpenHands eval harness: https://docs.openhands.dev/openhands/usage/developers/evaluation-harness ,
  https://github.com/All-Hands-AI/OpenHands/blob/main/evaluation/benchmarks/swe_bench/README.md
- smolagents repo + code-as-action: https://github.com/huggingface/smolagents
- smolagents agents concept: https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents
- smolagents secure execution: https://huggingface.co/docs/smolagents/tutorials/secure_code_execution
