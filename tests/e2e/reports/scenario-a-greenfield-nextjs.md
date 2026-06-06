<!--
tests/e2e/reports/scenario-a-greenfield-nextjs.md — Scenario A (Greenfield Next.js) E2E owner-review report.

Generated from a real sterile run on 2026-06-06 (create-next-app + construct install/init + command sweep + cx-architect/cx-reviewer ADR + CLI-JSON probes).
Tiers 1, 2, 3, 7 executed; Tiers 4, 5, 6 partial — status noted per section. Evidence: /tmp/a-full-evidence.json, /tmp/a-tier1.json.
-->

# Scenario A — Greenfield Next.js

> **Status: EXECUTED (partial).** Tiers 1, 2, 3, 7 ran against a real sterile environment. Tiers 4–6 are partially executed; gaps are stated explicitly per section. No fabricated results — every number traces to a captured evidence file.

## Scenario definition

- **Profile:** `rnd` (default)
- **Fixture:** `npx create-next-app@latest` — TypeScript, Tailwind, ESLint, App Router, `src/` dir, npm. Resolved **create-next-app 16.2.7**, **next 16.2.7**, **react / react-dom 19.2.4**.
- **Sterile env:** dedicated tmpdir, isolated `HOME` + `CX_HOME_OVERRIDE`, `CONSTRUCT_DEV_PATH` → repo under test, own `git init`. Root: `/var/folders/.../cx-e2e-a-pGFKS0`.
- **Verified inputs:** 92 public + 15 internal commands (`lib/cli-commands.mjs`); embedded contract **1.1.0**.

---

## Tier 1 — Install + Init UX (owner observation)

**Time-on-clock, fresh tmpdir → first working command:** ~**69.2s** (create-next-app excluded; that added 30.7s).

| Step | Exit | Wall-clock | stdout | stderr |
|---|---|---|---|---|
| `create-next-app` (fixture) | 0 | 30.7s | — | warns only (npm notices) |
| `construct install --scope=user --yes` | 0 | **45.3s** | 8244 ch | **0** |
| `construct init --yes` | 0 | **23.8s** | 2439 ch | **0** |
| `construct status` (first cmd after init) | 0 | 131ms | 1996 ch | 0 |

**What works well (owner lens):**
- **Completion-of-task signal: strong.** Install ends with a 47-pass/2-warn/0-fail health check and a "Setup complete" block; init ends with a `SETUP COMPLETE` + explicit `Created:` file list (15 created, 1 skipped) + numbered `NEXT STEPS`.
- **Next-step clarity: strong.** Both steps end with concrete next commands (`construct doctor`, `construct provider add github`; "Address @construct in your editor").
- **Ordering: good.** Scope → paths → services → providers → health → next steps is a sensible arc.
- **Zero stderr** on both mutating steps; exit 0 throughout.

**Findings (owner lens):**
- **Noise: HIGH on install.** Raw libpq `NOTICE` objects leak to stdout 4× (codes 42710, 42P07×3) — full JS object dumps (`{ severity_local: 'NOTICE', code: '42710', message: 'extension "vector" already exists, skipping', file: 'extension.c', line: '2017', routine: 'CreateExtension' }`). Zero user value. → **bd `construct-h8tx.6`**
- **Redundancy.** "Synced 1 front-door agent to global scope…" and "Completions updated →" each print **twice** in install. → **bd `construct-h8tx.7`**
- **Density spike.** The `cass` version warning spends 4 upstream issue numbers on an optional dependency — high information density for a non-blocking optional.
- **Test-env caveat (not a defect):** doctor showed `construct command on PATH ⚠` / `construct command is this CLI ⚠` — artifacts of the sterile/dev invocation (no global link in sandbox); a real global `--scope=user` install resolves both.

**Tier-1 verdict:** Functions **Y** · Documented **Y** · Noise **high** (install) / **low** (init) · Recommendation **iterate** (suppress pg NOTICEs + dedup sync lines — both small, high-payoff).

---

## Tier 2 — Command sweep (92 public + 15 internal)

Every command in the catalog invoked in the sterile env with the safe-invocation policy (blocking/mutating commands help-probed only).

| Metric | Count |
|---|---|
| Commands enumerated | **107** (92 public + 15 internal) |
| Executed live | 97 |
| Help-only (policy override) | 10 |
| Exit 0 | 72 |
| Exit ≠ 0 | 25 |
| `--help` resolved | **107 / 107** (zero help failures) |

**Exit-≠0 commands** (`distill, ingest, export, infer, search, storage, headhunt, optimize, telemetry-backfill, team, reflect, memory, drop, wireframe, update, validate, hooks:health, deployment, policy, tags, providers, docs:check, telemetry-setup, seed-traces, lint:templates`): the majority are **bare-invocation-needs-subcommand** (e.g. `memory`, `storage`, `team`, `tags` print usage and exit 1) — expected behavior, not defects. The sweep's bare-invocation policy conflates "needs a subcommand" with "failed"; **the sweeper needs a per-command expected-exit refinement** before these become clean verdicts. `docs:check`/`validate`/`lint:templates` exit 1 are likely legitimate (the bare Next.js app has no docs to verify) and need individual triage.

**Side effects during sweep:** `bootstrap` created **38 files**, `hooks:health` created **3** when invoked bare. `bootstrap` mutating the tree on a no-arg sweep invocation is worth gating — candidate for the help-only override list.

**Tier-2 verdict:** plumbing **Y** (all dispatch, all `--help` resolve) · the 25 nonzero need triage before per-command ship/iterate/file verdicts are final. Recommendation **iterate** (refine sweeper expected-exit map; re-run for clean per-command grid).

---

## Tier 3 — Quality-bar artifact (real specialist chain)

**Mechanism finding (material):** `construct ask` is **RAG over the knowledge corpus** (`lib/knowledge/rag.mjs`), not persona dispatch; and no Construct-managed model credential exists in the env. The genuine cx-* specialist chain runs as **host (Claude Code) subagents**. Tier 3 was therefore driven by spawning the **real `cx-architect` and `cx-reviewer` specialists** via the host, against the sterile project — a real LLM artifact through Construct's actual specialist mechanism.

**Artifact:** `docs/adr/0001-routing-layer-architecture.md` — "Server Components as the default rendering and data-loading boundary."

**Chain:** `cx-architect` (authored, 31k tokens) → persisted → `cx-reviewer` (adversarial review, 22k tokens).

**Validation (Construct machinery):**
- `construct lint:comments` → **✓ clean**
- `construct docs verify` → **passes** (warnings are about the Next.js app's own README/AGENTS.md, not the ADR)
- ADR structural requirements `["Problem","Decision","Rejected alternatives","Consequences","Reversibility"]` → **all 5 present**
- `cx-reviewer` verdict → **APPROVED_WITH_WARNINGS**; **all 10 project claims verified true** against the real files (versions, App Router structure, "both components are Server Components", `@/*` alias, empty `next.config.ts`); 3 minor citation-hygiene findings, **no blockers/majors**.

**Owner verdict — six dimensions:**
- **Depth (would a senior IC respect it?):** Yes. Reviewer's own conclusion. Problem states a real, decision-forcing tension (server/client default coupling bundle size + secret containment + data-fetch location, with silent failure modes).
- **Sourcing (Admiralty per claim):** Strong. Vendor docs graded A1; the architect honestly disclosed that anchor *prose* was not live-fetched and marked it `[unverified]` — correct epistemic posture, not overreach.
- **Decision-forcing:** Yes — names what becomes harder (forced `"use client"` placement, serializable-prop constraint) and reversibility asymmetry.
- **No fabrication:** Confirmed — every project fact re-verified by the reviewer against disk; version numbers read from `package.json`, not invented.
- **Template fidelity:** Full — matches `templates/docs/adr.md` section structure.
- **Specialist signature:** Distinguishable — architect wrote trade-off-dense decision prose; reviewer produced an adversarial factual-check matrix.

**Tier-3 verdict:** Functions **Y** · Documented **Y** · Recommendation **ship** (artifact quality); the architect being **Read-only (no Write tool)** is a Tier-4 mechanism finding (below).

---

## Tier 4 — Loops, skills, specialists, templates (partial)

**Executed:**
- **Specialist chain dispatched and observed:** `cx-architect` → `cx-reviewer` ran as real subagents and produced distinct, role-appropriate output. The chain held (reviewer consumed the architect's artifact).
- **Mechanism finding:** `cx-architect`'s toolset is **Read/Grep/Glob/LS only** — it cannot write files; it returned a BLOCKED state with full content for the orchestrator to persist. This matches Construct's "architect proposes, engineer/orchestrator writes" contract, but means the **architect alone cannot land an artifact** — worth documenting as expected, not a bug.
- **Template fidelity** (ADR vs `templates/docs/adr.md`): verified in Tier 3.

**Pending:** explicit `get_skill` load checks (role/topical/utility), role-pending queue + gateway threshold/cooldown probe via a synthesized failing test, observation-store/audit-trail chain-hash assertions.

---

## Tier 5 — Documentation parity (partial)

**Executed:** `--help` resolved for **all 107** commands (Tier 2). Internal-command count (15) reconciled against the catalog.

**Finding — generated reference docs had drifted from the catalog.** AUTO-docs regeneration during the run corrected `docs/reference/cli/*.md`: `construct dashboard` was **missing entirely** from the core reference table, and `construct install` carried the **pre-ADR-0029 description** ("Docker, cm/cass, config, embeddings") instead of the current scoped form. The generated docs now match `lib/cli-commands.mjs`. This is real README/reference-vs-catalog drift — the exact failure mode Tier 5 targets — caught and auto-fixed.

**Pending:** per-command description match (`--help` vs `lib/cli-commands.mjs` vs README cell), completion-output public/internal assertions (bash + zsh subshell), README "Core commands" 1:1 table check.

---

## Tier 6 — Peer comparison (pending)

- **Dimension:** Greenfield init noise + next-step clarity
- **Peer:** `claude-task-master init` (primary: https://github.com/eyaltoledano/claude-task-master, #1180)
- **Status:** pending live primary-source fetch + access-date stamp. Construct's own side is captured (Tier 1): strong completion/next-step signals, but install noise is high (pg NOTICE leak). The comparison verdict will be written against the freshly-fetched peer docs, not baked in.

---

## Tier 7 — Invocable by other applications (partial)

**Executed — CLI-JSON surface:**

| Verb | Exit | Envelope (contractVersion 1.1.0, no secrets) |
|---|---|---|
| `capability describe --json` | 0 | **✓ valid** |
| `models resolve --json` | 0 | **✓ valid** |
| `execution resolve --json` | 0 | **✓ valid** |
| `workflow invoke --json` | 0 | **✓ valid** |
| `intake classify --json` | 1 | **✗ null stdout, no envelope** → bd `construct-h8tx.8` |

**4/5 CLI-JSON contract verbs emit a valid, secret-free, versioned envelope.** `intake classify --json` exits 1 with null on an empty queue instead of an empty-but-valid envelope.

**Pending:** SDK (`@geraldmaron/construct` import), MCP client (5 tools), HTTP+SSE orchestration runtime, `npx construct` host invocation, and the "external process reviews ingested material" use-case probe.

**Tier-7 verdict (CLI-JSON):** Functions **Y** (4/5) · Documented **Y** · Recommendation **iterate** (fix `intake classify --json` envelope).

---

## Owner-review verdict grid (executed tiers)

| Subject | Functions | Documented | Discoverable | Noise | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Tier 1 — install | Y | Y | Y | high | iterate |
| Tier 1 — init | Y | Y | Y | low | ship |
| Tier 2 — sweep (plumbing) | Y | Y | Y | med | iterate |
| Tier 3 — ADR artifact | Y | Y | Y | low | ship |
| Tier 7 — CLI-JSON (4/5) | Y | Y | Y | low | iterate |

## bd issue index (Scenario A)

| ID | P | Finding |
|---|---|---|
| `construct-e9ur` | P1 | **CLOSED** — launcher npx dead-end (fixed by `fb210e2`) |
| `construct-h8tx.6` | P2 | Raw Postgres NOTICE objects leak to install/init stdout |
| `construct-h8tx.7` | P3 | Duplicate "Synced front-door agent" / "Completions updated" lines in install |
| `construct-h8tx.8` | P2 | `intake classify --json` returns exit 1 / null — breaks CLI-JSON envelope contract |

## Highest-leverage Scenario-A change

**Suppress the Postgres `NOTICE` object dumps and dedup the sync/completions lines in install** (`h8tx.6` + `h8tx.7`). Smallest diff, biggest first-impression payoff — install is the first thing every user sees, and the raw libpq object dumps are the single most jarring noise in an otherwise well-structured flow.
