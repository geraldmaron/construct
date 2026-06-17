# 50 — Proliferation Audit: Prompt / Skill / Hook Token + Value (internal)

Date: 2026-06-10 · Branch: research/capability-registry · Commit: `a027a9f` · Bead: construct-u27k
Scope: internal, read-only. Measures the at-rest token cost and the fire/use frequency of every
artifact class the maintainer suspects has proliferated — persona, specialist roster, hooks, skills,
rules. Every number is reproducible from a command recorded inline.

Method: token estimates use the repo's own heuristic `bytes × 0.25` (`TOKENS_PER_CHAR = 0.25`,
`lib/mcp/tool-budget.mjs:14,27`). All file/line citations are at commit `a027a9f`. Inferences are
labeled `INFERENCE:`. Where a fact is not measurable from available data it is marked `unknown` /
`[unmeasured]` rather than invented.

Comparison bar (from sibling docs `10-open-agents.md`, `40-memory-knowledge.md`): the external
consensus is **keep the always-on surface tiny; load the rest by trigger.** OpenHands ships a tiny
always-on `AGENTS.md` core + keyword-triggered microagents; Cline glob-scopes its rules so only
relevant ones enter context. Construct is scored against that bar throughout.

---

## 1 — Prompt / agent economy: at-rest tokens injected per session per platform

### What actually gets injected

Construct does **not** inject 28 specialist agent files into a session. The injection shape differs
by host capability (`scripts/sync-specialists.mjs:594-634`):

- **Hosts without native subagents (Claude Code, Codex):** one orchestrator persona prompt **plus a
  text roster of all 28 specialists** (so the persona can simulate handoffs in prose). The roster is
  prepended only when `injectAgentRoster && !hasNativeSubagents`
  (`sync-specialists.mjs:622-624`).
- **Hosts with native subagents (OpenCode, VS Code, Cursor):** the orchestrator persona gets a
  **tool-bound micro-prompt** — no roster — and resolves the specialist chain at runtime via the
  `orchestration_policy` MCP tool (`sync-specialists.mjs:625-633`). The capability matrix is
  `platformCapabilities` (`sync-specialists.mjs:594-601`): `opencode/vscode/cursor: hasNativeSubagents
  true`; `claude/codex: false`.

This is already a meaningful economy decision and it is the single most important finding of section 1:
the roster-injection cost is paid only on Claude Code / Codex, and is deliberately *not* paid on the
local-model hosts (OpenCode), per ADR-0002 cited inline at `sync-specialists.mjs:614-621`.

The 28-specialist count is confirmed:
```
node --eval "const r=require('./specialists/registry.json'); console.log(r.specialists.length)"   # → 28
```

### Measured at-rest token table

Claude Code at-rest = the synced agent file (persona + 29-line roster) + the project `CLAUDE.md` that
Claude Code reads at session start. OpenCode at-rest = the single `construct` orchestrator prompt
written into `.opencode/opencode.json` (micro-prompt, no roster).

Reproduce (Claude side):
```
wc -c .claude/agents/construct.md   # 15582 bytes (persona + roster + operating guidance)
wc -c CLAUDE.md                     # 7469 bytes  (project instructions, Claude reads at start)
```
Reproduce (OpenCode side):
```
node --eval 'const c=require("./.opencode/opencode.json"); \
  console.log(Buffer.byteLength(c.agent.construct.prompt,"utf8"))'   # 12362 bytes, no roster
```
Reproduce (roster block isolated, Claude file):
```
node --eval 'const t=require("fs").readFileSync(".claude/agents/construct.md","utf8"); \
  const s=t.indexOf("Available specialist agents:"), e=t.indexOf("You are Construct."); \
  console.log(Buffer.byteLength(t.slice(s,e),"utf8"))'   # 3914 bytes → 29 roster entries
```

| Platform | Injected at rest | Bytes | Tokens (×0.25) | Roster injected? |
|---|---|---|---|---|
| **Claude Code** | `agents/construct.md` (persona + roster + op-guidance) | 15,582 | **3,896** | yes (29 lines, ~979 tok) |
| **Claude Code** | + project `CLAUDE.md` | 7,469 | **1,867** | n/a |
| **Claude Code total** | persona + roster + CLAUDE.md | 23,051 | **≈5,763** | — |
| **OpenCode** | `construct` orchestrator micro-prompt only | 12,362 | **3,091** | **no** (runtime-resolved) |
| **Codex / VS Code / Cursor** | [unmeasured this pass] — see note | — | — | codex yes / vscode,cursor no |

Notes:
- The persona source `personas/construct.md` is 7,279 bytes (`wc -c personas/construct.md`); the synced
  Claude agent is larger (15,582) because sync appends the 29-line roster, the role footer, shared
  guidance (13 items, 3,146 bytes — `node --eval` over `registry.sharedGuidance`), and platform
  guidance.
- The roster itself is **~979 tokens** that ride in **every** Claude Code session whether or not any
  specialist is dispatched. That is the concrete "prompt proliferation" cost the maintainer suspected,
  and it is bounded and host-scoped — not a 28-file blowup.
- Codex/VS Code/Cursor are not separately measured here because no synced config for them exists in
  this checkout; their injection shape is known from the capability matrix (codex gets the roster,
  vscode/cursor do not) but the byte count is `[unmeasured]`.

INFERENCE: Against the comparison bar, Construct already does the OpenCode-side "tiny always-on
surface" move (micro-prompt + runtime resolution). The gap is Claude Code, where the persona body
(~2.9k tok beyond the roster) + the always-on 29-line roster + a 1.9k-tok project `CLAUDE.md` give a
~5.8k-token at-rest floor before any tool schema or skill loads. That is large relative to OpenHands'
"tiny `AGENTS.md` core" ideal but is one persona, not 28 — the proliferation is in *prompt body size*,
not *agent count*.

---

## 2 — Hooks: registration census, budgets, and the value-measurement gap

### Registration census (Claude Code)

Reproduce:
```
node --eval 'const h=require("./platforms/claude/settings.template.json").hooks; \
  let t=0; for(const e of Object.keys(h)){let n=0;for(const g of h[e])n+=(g.hooks||[]).length; \
  console.log(e, n); t+=n;} console.log("TOTAL", t)'
```

| Event | Registrations |
|---|---|
| SessionStart | 1 |
| PreToolUse | 8 |
| PostToolUse | 17 |
| PostToolUseFailure | 4 |
| PreCompact | 1 |
| Stop | 8 |
| UserPromptSubmit | 2 |
| **TOTAL** | **41** |

The methodology's "~53 hook registrations" is a prior estimate; the reproducible count at `a027a9f` is
**41** registrations across **7** lifecycle events (`platforms/claude/settings.template.json`).
PostToolUse alone carries 17 — the heaviest event by far, and the densest proliferation surface.

### Hook scripts and declared budgets

Reproduce:
```
ls lib/hooks/*.mjs | wc -l                      # 38 scripts
grep -l "@unwired" lib/hooks/*.mjs | wc -l       # 2 unwired
grep -h "@p95ms" lib/hooks/*.mjs | wc -l         # budget declarations
```

- **38** hook scripts on disk; **2** are `@unwired` (present but not registered in settings):
  `rule-verifier.mjs` and `proactive-activation.mjs`. So **36** scripts back the 41 registrations
  (some, e.g. `pre-compact.mjs` and `mcp-health-check.mjs`, are wired to >1 event).
- Nearly every wired hook declares an `@p95ms` latency budget in its file header; the test
  `tests/perf/hook-budgets.test.mjs:42-56` **fails the build** if a wired, `@lifecycle`-carrying hook
  lacks `@p95ms`. Budgets range from 5 ms (`guard-bash`, `block-no-verify`, `config-protection`) to
  5000 ms (`pre-push-gate`, `dep-audit`) — see the header grep above for the full list.

Selected hook purposes (from file headers / settings `description`):

| Hook | Event | Purpose | @p95ms | Can block? |
|---|---|---|---|---|
| `session-start` | SessionStart | load prior context, git status, env notice | 300 | no |
| `policy-engine PreToolUse` | PreToolUse | bootstrap gate: block mutations until session grounded | 80 | **yes** |
| `orchestration-dispatch-guard` | Pre/PostToolUse | block solo-authoring an orchestrated deliverable | 8 | **yes** |
| `block-no-verify` | PreToolUse | block `git --no-verify` | 5 | **yes** |
| `pre-push-gate` | PreToolUse | run tests+build before push | 5000 | **yes** |
| `guard-bash` | PreToolUse | block rm -rf /, force-push to main, fork bombs | 5 | **yes** |
| `config-protection` | PreToolUse | prevent weakening lint/tsconfig | 5 | **yes** |
| `edit-guard` | PreToolUse | hash-anchored edit verification | 20 | **yes** |
| `comment-lint` | PostToolUse | enforce comment policy, no bypass | 60 | **yes** |
| `scan-secrets` | PostToolUse | block API keys/tokens in files | 30 | **yes** (exit 2) |
| `adaptive-lint` | PostToolUse | auto-run linter (async) | 800 | no |
| `policy-engine Stop` | Stop | block on red CI / open beads / drive criteria | 80 | **yes** |
| (… 25 more registrations: audit-trail, mcp-audit, agent-tracker, registry-sync, dep-audit, doc-coupling, test-watch, post-merge-*, stop-*, model-fallback, context-window-recovery, etc.) | | | | |

Hooks that can hard-block (exit code 2), reproduce
`grep -l "exit(2)\|exitCode = 2" lib/hooks/*.mjs`: **10** scripts —
`block-no-verify, comment-lint, guard-bash, edit-guard, mcp-health-check, orchestration-dispatch-guard,
policy-engine, pre-push-gate, scan-secrets, rule-verifier` (the last is unwired, so 9 *active* blockers).

### KEY FINDING — value is unmeasured; only latency and failure are tracked

I searched every telemetry surface for a per-hook **value** signal — i.e. how often each hook *fired*
and whether it *changed anything* (blocked an action, mutated a file, prevented a bad commit). The
result:

- **`tests/perf/hook-budgets.test.mjs`** measures **latency only**: header-presence of `@p95ms`
  (unit-speed) plus an opt-in benchmark lane that fails when measured p95 exceeds the declared budget ×
  tolerance (`hook-budgets.test.mjs:75-90`). It asserts nothing about whether a hook ever blocked or
  altered an action. It is a *cost* gate, not a *value* gate.
- **`lib/hooks/_lib/log.mjs`** records **failures only** — one JSONL line per swallowed hook error to
  `~/.cx/hook-failures.jsonl` (`_lib/log.mjs:1-20,49-64`). It captures crashes, not decisions.
- **`lib/hook-health.mjs` → `~/.cx/hook-health/*.json`** records **health/availability**:
  `status`, `consecutiveFailures`, `totalChecks`, `totalFailures` per hook (inspected: 5 files,
  e.g. `audit-trail.json` `status:"unhealthy"`). Again — did it run and survive, not did it earn its
  keep.
- No counter, no JSONL, no metric anywhere records **per-hook fire frequency or block/allow/mutate
  outcome**. `grep -rn "recordOutcome\|hookOutcome\|incrementHook\|blocked.*count\|timesBlocked\|
  prevented" lib/hooks/ lib/telemetry/` returns **zero outcome-recording hits** (only prose comments
  containing the word "fires").

**Verdict for section 2: no per-hook value measurement exists — only latency budgets and
failure/health tracking.** This absence is itself the finding. With 41 registrations and 10 potential
hard-blockers, **we cannot tell which hooks earn their keep.** A hook that has blocked a bad push 200
times and a hook that has never fired once look identical in the current telemetry. The system can tell
you a hook is *fast* and *alive*; it cannot tell you it is *useful*.

INFERENCE: This is the inverse of the prompt-economy discipline. Prompts have a hard word cap
(`PROMPT_WORD_CAP`, `sync-specialists.mjs:649-665`) and the gateway cut tool-schema tokens; hooks have
a hard *latency* cap but **no value accounting**, so the hook surface can proliferate indefinitely
without any signal that a given interception point is dead weight. Compared to the external bar (where
gates are few and human-approval-centric — Cline), Construct's 41-registration array is large and
unaudited for value.

---

## 3 — Skills (150) and rules (50): binding audit, usage telemetry, retrievability

### Does `lib/audit-skills.mjs` already measure usage? No — it audits *bindings*.

`lib/audit-skills.mjs` (read in full) reports three things and **none is usage frequency**
(`audit-skills.mjs:37-67`): (a) skills with no agent owner (orphans-by-binding), (b) agents with no
skill bindings, (c) declared skill paths missing on disk. It is a static integrity check between
`registry.specialists[].skills` and the `skills/` tree. It never reads any runtime log.

### Real usage telemetry DOES exist — and it is damning

`lib/telemetry/skill-calls.mjs` logs one JSONL line per skill **load** to `~/.cx/skill-calls.jsonl`
(`skill-calls.mjs:1-67`), with `source ∈ {mcp, prompt-composer, role-preload, validation, other}`. It
is invoked from `lib/role-preload.mjs` and `lib/mcp/tools/skills.mjs`. The log is real and populated
(`wc -l ~/.cx/skill-calls.jsonl` → **6023** events). Reproduce the rollup:
```
node --input-type=module --eval '
import { summarizeSkillCalls, findOrphanSkills } from "./lib/telemetry/skill-calls.mjs";
import fs from "node:fs"; import path from "node:path";
const collect=(d,p="")=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()
  ? collect(path.join(d,e.name), p?p+"/"+e.name:e.name)
  : (e.name.endsWith(".md")&&e.name!=="routing.md" ? [(p?p+"/":"")+e.name.replace(/\.md$/,"")] : []));
const ids=collect("skills");
console.log("on disk", ids.length,
  "| zero-load all-time", findOrphanSkills({since:"9999d",allSkillIds:ids}).length,
  "| zero-load 30d", findOrphanSkills({since:"30d",allSkillIds:ids}).length);
const all=summarizeSkillCalls({});
console.log("distinct skills EVER loaded", Object.keys(all.skills).length, "total events", all.totalEvents);'
```

Results:

- **149 skill ids on disk** (the rollup excludes `routing.md`; raw `find skills -name '*.md' | wc -l` =
  150 including it).
- **140 of 149 skills have ZERO load events all-time** (and 140 of 149 in the last 30 days).
- Only **9 distinct skills** have ever been loaded across **6023** events.
- The top 4 absorb essentially all traffic, and they are all `roles/*` skills loaded by the
  **prompt-composer / role-preload** path (sync-time inlining of role anti-patterns), **not**
  agent-chosen retrieval:
  - `roles/engineer.ai` — 2013
  - `roles/engineer.platform` — 1648
  - `roles/engineer` — 1191
  - `roles/architect.ai-systems` — 1166
- The **agent-chosen MCP retrieval path** (`search_skills` / `get_skill`, `source:"mcp"`) has loaded
  only **6 distinct skills, 1–2 calls each** (`roles/engineer` 2; `roles/researcher`,
  `operating/orchestration-reference`, `roles/architect`, `architecture/api-design`,
  `utility/clean-code` — 1 each). Reproduce with `summarizeSkillCalls({ source:"mcp" })`.

INFERENCE: The 150-skill catalog is, by its own telemetry, **~94% dead weight at rest** — 140 skills [source: ~/.cx/skill-calls.jsonl and reproducible commands in this document]
have never been retrieved on this machine. The skills that *do* load are the role-preload `roles/*`
files, which are inlined at sync/preload time, not pulled lazily by an agent reasoning "I should fetch
this skill." The lazy-retrieval thesis (`search_skills` → `get_skill`) that justifies the large catalog
is, empirically, **almost never exercised**: 6 distinct skills, ever, via the agent path. This is the
strongest single piece of evidence for the maintainer's "too many skills" suspicion.

Caveat (honest): this is **one user's machine** (`~/.cx/skill-calls.jsonl` is cross-project but
single-host — `skill-calls.mjs:22-28`). It is not fleet data. But it is the only retrieval evidence
that exists, and it is unambiguous on this host.

### Rules (50): retrieval frequency is unknowable from available data

Reproduce:
```
find rules -name '*.md' | wc -l                                  # 50
find rules -name '*.md' | sed 's|^rules/||;s|/.*||' | sort | uniq -c | sort -rn
grep -rln "logRuleCall\|rule-calls\|ruleCall" lib/                # (no output)
```

- **50 rule files**, by directory: `common` 23, `web` 7, `typescript` 5, `swift` 5, `python` 5,
  `golang` 5.
- **There is no rule-retrieval telemetry at all.** No `logRuleCall`, no `rule-calls.jsonl`, no
  equivalent of `skill-calls.mjs` for rules. Rules are consumed by direct file reads in
  `lib/role-preload.mjs`, `lib/comment-lint.mjs`, `lib/skills-apply.mjs`, `lib/decisions/*`
  (`grep -rln "rules/" lib/`) and by being *named* inside the persona/CLAUDE.md prose (e.g.
  `rules/common/no-fabrication.md`), but nothing records when a rule's content actually enters a
  model's context or changes a decision.

**Rule retrieval frequency is therefore `[unmeasured]` / unknowable from available data.** Proposed
measurement: add a `logRuleCall` analog to `skill-calls.mjs` fired wherever a rule file is read into
context (`role-preload`, `skills-apply`, decisions registry), tagged with `source` and `projectId`;
then `construct rules orphans --since=30d` becomes answerable exactly as `construct skills orphans`
already is. Until then, the 50 rules are presumed-but-unproven load-bearing.

### Skill catalog by directory (count)

Reproduce: `find skills -name '*.md' | sed 's|^skills/||;s|/.*||' | sort | uniq -c | sort -rn`

| Directory | Skills | | Directory | Skills |
|---|---|---|---|---|
| roles | 53 | | strategy | 5 |
| docs | 17 | | architecture | 5 |
| devops | 13 | | frameworks | 4 |
| development | 10 | | exploration | 4 |
| ai | 8 | | compliance | 4 |
| frontend-design | 7 | | utility | 1 |
| security | 6 | | routing.md | 1 |
| quality-gates | 6 | | | |
| operating | 6 | | **total** | **150** |

`roles/` (53) is the largest bucket and is the *only* bucket with non-trivial load traffic — and that
traffic is sync-time preload, not lazy retrieval.

---

## 4 — Synthesis: verdict table

| Artifact class | Count | At-rest tokens (if injected) | Fire / use frequency | Verdict |
|---|---|---|---|---|
| **Persona** | 1 | Claude ≈3,896 (file) / OpenCode ≈3,091; +CLAUDE.md ≈1,867 | always-on, every session | **keep — but trim body.** Single entry point is justified; the ~2.9k-tok body beyond the roster is the lever. |
| **Specialist roster** | 28 | Claude only: ≈979 tok always-on; **0** on OpenCode/vscode/cursor | always present in Claude prompt; dispatch frequency `[unmeasured]` (`agent-tracker.mjs` records names but no rollup found) | **demote-to-lazy-load (Claude side).** OpenCode already proves runtime resolution works; the always-on 29-line roster on Claude is the prompt-proliferation cost — move it behind `orchestration_policy` like the native-subagent hosts. |
| **Hooks** | 41 regs / 36 wired scripts (38 on disk, 2 unwired) | not injected (run out-of-band) | **value UNMEASURED** — only latency (`@p95ms`) + failure/health tracked; no fire/block/mutate counter exists | **instrument-first, then consolidate.** Cannot delete safely without value data. Add per-hook fire+outcome telemetry; PostToolUse (17 regs) is the consolidation target; delete the 2 unwired scripts. |
| **Skills** | 150 files | not injected at rest (lazy) | **140/149 zero loads all-time; 9 ever loaded; 6 ever via agent MCP path** (`~/.cx/skill-calls.jsonl`, 6023 events) | **consolidate / delete.** The catalog is ~94% dead on this host; the lazy-retrieval thesis is barely exercised. Prune zero-load skills or fold them into the `roles/*` preload that actually fires. |
| **Rules** | 50 files | partially injected by-name in persona prose | **`[unmeasured]`** — no rule-retrieval telemetry exists | **instrument-first.** Build the `logRuleCall` analog before pruning; glob-scope per Cline once data exists. |

Evidence ties:
- Persona/roster token counts → section 1 table + `sync-specialists.mjs:594-634` (host-conditional
  roster).
- Hooks unmeasured-value → section 2: `tests/perf/hook-budgets.test.mjs` (latency only),
  `_lib/log.mjs` (failures only), `lib/hook-health.mjs` (health only), zero outcome-recording grep
  hits.
- Skills 140/149 dead → section 3 `summarizeSkillCalls` / `findOrphanSkills` rollup over
  `~/.cx/skill-calls.jsonl`.
- Rules unmeasured → section 3: `grep -rln "logRuleCall\|rule-calls" lib/` returns nothing.

Comparison-bar scoring (six-dimension rubric, dim 1 + dim 5): Construct **passes the bar on the
OpenCode/native-subagent path** (tiny micro-prompt, runtime resolution — matches OpenHands' tiny-core
ideal) and **fails it on the Claude path** (always-on 29-line roster + ~5.8k at-rest floor) and on the
**knowledge surface** (150 skills with 94% never retrieved is the opposite of "load the rest by [source: ~/.cx/skill-calls.jsonl and reproducible commands in this document]
trigger" working — the rest is on disk but the trigger almost never fires). Hooks are off-bar entirely:
the external tools gate sparingly (Cline = human approval; Goose = allowlist); Construct gates with 41
interception points and no value telemetry to justify any of them.

---

## Proposed changes

### Proposal A — Demote the Claude-side specialist roster to lazy resolution

- **Current** — Claude Code / Codex inject a 29-line, ~979-token specialist roster into *every*
  session prompt (`sync-specialists.mjs:622-624`; roster block measured 3,914 bytes in
  `.claude/agents/construct.md`), while OpenCode/VS Code/Cursor inject no roster and resolve the chain
  at runtime via `orchestration_policy` (`sync-specialists.mjs:625-633`).
- **Proposed** — Treat Claude Code like a native-subagent host for roster purposes: ship the
  micro-prompt that points at `orchestration_policy` and drop the always-on roster, OR replace the
  full 29-line roster with a one-line "call `orchestration_policy` to discover specialists" pointer,
  reclaiming ~900 always-on tokens per Claude session.
- **Pros** — Cuts the always-on Claude floor by ~16% of the agent-file tokens; aligns all hosts on one [source: ~/.cx/skill-calls.jsonl and reproducible commands in this document]
  resolution model; reduces drift between the prose roster and the registry.
- **Cons** — Claude Code lacks native subagents (`platformCapabilities.claude.hasNativeSubagents
  false`), so the persona simulates handoffs in text; without the roster it must make an extra tool
  call before it can name a specialist, adding one round-trip on orchestrated tasks.
- **Reasoning** — OpenHands keeps the always-on tier tiny and loads specialists/knowledge on trigger;
  Construct already does this on three hosts and pays the roster cost only where it chose to. The cost
  is bounded but it is pure always-on weight whose dispatch value is `[unmeasured]`.
- **Evidence** — `scripts/sync-specialists.mjs:594-634`; roster measured at 3,914 bytes / ~979 tok
  (section 1 reproduce block); OpenCode synced prompt 12,362 bytes with no roster
  (`.opencode/opencode.json`).
- **Counter-argument** — The roster is cheap insurance: ~979 tokens is <0.5% of a 200k context, and an [source: ~/.cx/skill-calls.jsonl and reproducible commands in this document]
  always-present roster lets a text-only host dispatch without a blocking tool call, which matters more
  on slow/local models than the token saving.
- **Falsified-if** — `agent-tracker` dispatch telemetry (once rolled up) shows the Claude persona
  dispatches specialists on >50% of sessions AND removing the roster measurably increases [source: ~/.cx/skill-calls.jsonl and reproducible commands in this document]
  failed/misnamed dispatches — then the roster earns its tokens and should stay.

### Proposal B — Instrument hooks for value before touching the count

- **Current** — 41 hook registrations / 36 wired scripts, with `@p95ms` latency budgets enforced by
  `tests/perf/hook-budgets.test.mjs` and failure/health logs (`_lib/log.mjs`,
  `lib/hook-health.mjs`), but **no per-hook fire/block/mutate counter** anywhere.
- **Proposed** — Add a `logHookOutcome({ hook, event, outcome })` analog to `skill-calls.mjs`
  (`outcome ∈ {noop, blocked, mutated, advised}`) written to `~/.cx/hook-outcomes.jsonl`, and a
  `construct hooks usage --since=30d` rollup mirroring `construct skills usage`. Only after a window of
  data, consolidate the PostToolUse block (17 regs) and delete dead interception points.
- **Pros** — Replaces intuition with the same evidence discipline skills already enjoy; makes "which
  hooks earn their keep" answerable; lets consolidation/deletion be evidence-led instead of risky.
- **Cons** — Adds a write to the hook hot path (must stay within the existing `@p95ms` budgets); one
  more JSONL to rotate; the data is single-host until fleet telemetry exists.
- **Reasoning** — Section 2 shows the value gap is structural: prompts/tools have economy gates, hooks
  have only a cost gate. The external bar (Cline/Goose) gates sparingly precisely because every gate
  has a cost; Construct can't make that trade-off without outcome data.
- **Evidence** — `tests/perf/hook-budgets.test.mjs:42-90` (latency only); `lib/hooks/_lib/log.mjs:1-64`
  (failures only); `lib/hook-health.mjs` → `~/.cx/hook-health/*.json` (health only); zero hits for
  outcome-recording grep (`recordOutcome|hookOutcome|incrementHook|blocked.*count|timesBlocked`).
- **Counter-argument** — Safety hooks (`guard-bash`, `scan-secrets`, `block-no-verify`) are justified
  by the catastrophe they prevent, not by fire frequency; a rarely-firing `rm -rf /` blocker is still
  worth keeping, so outcome telemetry could mislead toward deleting valuable-but-quiet guards.
- **Falsified-if** — A 30-day outcome log shows every wired hook fires with a non-noop outcome at a
  rate that already justifies it (no dead hooks) — then the surface is right-sized and only the 2
  unwired scripts should be deleted.

### Proposal C — Prune / fold the skill catalog; the lazy thesis is unproven

- **Current** — 150 skill files; 140/149 have **zero load events all-time** on this host; only 9 ever
  load and 6 ever via the agent MCP path; the live traffic is `roles/*` preload, not lazy retrieval
  (`~/.cx/skill-calls.jsonl`, 6023 events; section 3 rollup).
- **Proposed** — (1) Mark the 140 zero-load skills as pruning candidates via the existing
  `construct skills orphans --since=30d`; (2) move genuinely load-bearing content into the `roles/*`
  preload bundles that actually fire; (3) add OpenHands-style frontmatter `triggers` so the catalog
  that remains auto-injects on keyword match instead of waiting for an agent to call `search_skills`
  (which it almost never does — 6 distinct skills ever).
- **Pros** — Cuts the maintenance surface ~9:1; concentrates effort on the skills that fire; the
  trigger move attacks the root cause (agents don't pull, so make relevant skills push).
- **Cons** — Single-host telemetry risks pruning a skill that's hot on another user's machine; folding
  into preload re-grows the always-on surface if done carelessly; trigger authoring across 150 files is
  real work.
- **Reasoning** — The audit's central thesis ("load the rest by trigger") only pays off if the trigger
  fires; section 3 shows it almost never does, so the large catalog is cost without realized benefit.
- **Evidence** — section 3 rollup over `~/.cx/skill-calls.jsonl`; `lib/telemetry/skill-calls.mjs`
  (`findOrphanSkills`, `hotSkills`); `lib/audit-skills.mjs` (binding-only, no usage); OpenHands
  microagents bar (`10-open-agents.md` Subject 4).
- **Counter-argument** — Skills are *curated, human-authored knowledge* (per `40-memory-knowledge.md`)
  whose value is being available when the rare hard task needs them; low retrieval frequency is
  expected and acceptable for a reference library, and one host's log under-counts true usage.
- **Falsified-if** — Fleet (multi-host) skill telemetry shows the long tail of "zero-load" skills is
  actually retrieved across users at a rate that justifies the catalog — then the fix is better
  triggering, not pruning.

### Proposal D — Add rule-retrieval telemetry (cannot manage what we can't measure)

- **Current** — 50 rule files, zero retrieval telemetry; rules are read directly by `role-preload`,
  `comment-lint`, `skills-apply`, `decisions/*` and named in persona prose, but no log records when a
  rule enters context or changes a decision.
- **Proposed** — Add a `logRuleCall` analog to `skill-calls.mjs` at every rule-read site; expose
  `construct rules usage/orphans/hot`; once data exists, glob-scope rules per Cline so only
  file-pattern-relevant rules load.
- **Pros** — Closes the only knowledge surface with *no* usage visibility; reuses the proven
  skill-telemetry pattern; enables the same evidence-led pruning skills already support.
- **Cons** — Instrumentation across several call sites; rules embedded in prose (named in CLAUDE.md)
  are harder to attribute than file-read rules; single-host caveat again.
- **Reasoning** — Section 3 shows rules are the one class scored `[unmeasured]` in the verdict table;
  every other class has at least latency or load data. Cline's glob-scoping is the target end-state but
  requires usage data to scope correctly.
- **Evidence** — `grep -rln "logRuleCall\|rule-calls" lib/` (no output); `grep -rln "rules/" lib/`
  (read sites); `lib/telemetry/skill-calls.mjs` (the pattern to copy); Cline conditional rules
  (`10-open-agents.md` Subject 2).
- **Counter-argument** — Rules are mostly enforced by *hooks* (comment-lint, no-verify, etc.), not by
  being retrieved into context, so "retrieval frequency" may be the wrong metric — enforcement-hit
  frequency (Proposal B's hook telemetry) might already cover the load-bearing rules.
- **Falsified-if** — The hook-outcome log from Proposal B accounts for every load-bearing rule's effect
  (each enforced rule maps to a firing hook), making a separate rule-retrieval log redundant.

---

## Reproducibility index (commands, commit `a027a9f`)

- Specialist count: `node --eval "console.log(require('./specialists/registry.json').specialists.length)"` → 28
- Claude agent bytes: `wc -c .claude/agents/construct.md` → 15582; `wc -c CLAUDE.md` → 7469
- OpenCode prompt bytes: `node --eval 'console.log(Buffer.byteLength(require("./.opencode/opencode.json").agent.construct.prompt,"utf8"))'` → 12362
- Roster bytes: see section 1 reproduce block → 3914 (29 entries)
- Token heuristic: `grep -n "TOKENS_PER_CHAR" lib/mcp/tool-budget.mjs` → `= 0.25`
- Hook registrations: see section 2 node --eval → 41 across 7 events
- Hook scripts: `ls lib/hooks/*.mjs | wc -l` → 38; `grep -l "@unwired" lib/hooks/*.mjs | wc -l` → 2
- Blocking hooks: `grep -l "exit(2)\|exitCode = 2" lib/hooks/*.mjs | wc -l` → 10
- Skill files: `find skills -name '*.md' | wc -l` → 150
- Skill usage: see section 3 node --input-type=module rollup → 140/149 zero-load; 9 ever loaded; 6023 events
- Rule files: `find rules -name '*.md' | wc -l` → 50; `grep -rln "logRuleCall\|rule-calls" lib/` → (none)
