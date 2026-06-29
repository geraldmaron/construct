---
intake: none
---

# Risk Register — Construct Self-Audit (Phase 3 synthesis)

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Date: 2026-06-29

Severity = impact × likelihood if unaddressed. Each risk names the gate that must be satisfied
before the related implementation may start. Gates map to the parallelization classes in
[execution-matrix.md](execution-matrix.md).

## Traffic jams — status and resolutions in force

| # | Traffic jam | Resolution applied this run | Status |
|---|---|---|---|
| 1 | Duplicate / conflicting Beads | Only Opus created Beads; existing 22 beads inspected first; new epic `construct-rr63` + children created with no overlap; agents only *suggested* beads | **held** |
| 2 | Parallel agents editing same files | Wave-1 agents used `Explore` type (no Edit/Write tools) — edits structurally impossible | **held** |
| 3 | Haiku overreaches | Opus reviewed every report; **C1 (Agent J "1 failing") REFUTED** against verified baseline | **held — caught one** |
| 4 | Registry refactor blast radius | No extraction yet; inventory + contracts first, no-behaviour-change tests gate Wave 3 | **gated** |
| 5 | Lifecycle destroys state | No lifecycle change yet; upgrade fixtures gate Wave 2/4; never silent-delete user files | **gated** |
| 6 | Host parity vs file parity | Synthesis mandates capability-based matrix; baseline `.cursor` drift flagged | **gated** |
| 7 | Web search faked | Agent E confirmed no web search + no conflation; stance = typed degradation, never claim it | **gated** |
| 8 | Planning vs execution conflated | Agent G confirmed enforced separation; harden with negative tests, never claim host-native exec | **gated** |
| 9 | Long test runs block work | Opus ran full suite **once** (baseline); agents ran no full suite; waves run scoped-then-full | **held** |
| 10 | Docs/code drift | Registry-generated docs targeted; ADR status drift logged for amendment | **gated** |

## Risk register

| ID | Risk | Sev | Source | Gate before remediation | Mitigation |
|---|---|---|---|---|---|
| R1 | ADR status drift erodes "ADR = source of truth"; false signal about what's shipped | Med | A | none (docs-only) | Housekeeping bead: 0018–0021 → accepted; cite impl+tests |
| R2 | ADR-0043/0039 Oracle surface contradiction → user can't discover `construct oracle` OR it's wrongly hidden | Med | A | **owner decision** | Resolve surface; align `cli-commands.mjs` + ADR |
| R3 | Registry extraction (tools/services/hosts/migration) changes behaviour during refactor | **High** | B | `blocked-by-architecture-gate`: no-behaviour-change tests exist first | Inventory → contract → characterization tests → extract |
| R4 | Host parity reports healthy on file existence while runtime capability is absent | **High** | C | `blocked-by-host-parity-gate`: capability-matrix contract + tests | Registry-driven host-check + degradationReason + discovery tool |
| R5 | MCP tools lack outputSchema/typed errors → hosts/agents can't validate or branch on failure | Med | D | `blocked-by-tool-contract-gate`: schema/error manifest defined | Add outputSchema + errorSchema manifest; backward-compatible |
| R6 | System could imply web search works when host lacks it (silent wrong results) | **High** | E | `blocked-by-tool-contract-gate`: typed-degradation contract + test | Degradation reason + "descriptive routing" docs; no web-search claim |
| R7 | A lifecycle edit silently overwrites/prunes user state (.cx, Beads, docs, config) | **Critical** | F | `blocked-by-migration-gate`: upgrade fixtures + HOME/XDG e2e first | Fixtures, dirty-repo warn, context-drift detect, explicit consent |
| R8 | Orchestration regression reintroduces false-execution claim undetected | **High** | G | `blocked-by-architecture-gate`: negative/inverse tests added | Add inverse tests (inline must NOT set output), HTTP-path + CoT tests |
| R9 | Intake auto-promotes user docs into lanes without approval (silent restructure) | **High** | H | `blocked-by-migration-gate`: approval gate + detection fixtures | `approvalRequired` on promotion; alias-conflict detection |
| R10 | Learning loop is partly decorative: tool-miss & failure signals captured but never used | Med | I | none for read-side; `blocked-by-tool-contract-gate` for capture changes | Add consumer for `tool-name-misses.jsonl`; failure→anti-pattern; e2e loop test |
| R11 | Coverage blind spots: self-hosting (0), upgrade fixtures (0), MCP discovery evals, epic→gate map | Med | J | none (additive tests) | Add scoped suites; epic→test registry; release-gates schema |
| R12 | Agent overreach contaminates synthesis (the C1 class) | Med | meta | standing | Opus adjudicates every agent claim vs verified ground truth before it becomes a bead |
| R13 | Pre-existing dirty-tree work (`construct-b4za`/`-5wkl` files) collides with audit edits | Med | baseline | standing | Those 20 files are off-limits; any audit edit needs explicit Opus file-lock reassignment |

## Gate ledger (must be GREEN before the dependent wave starts)

- **architecture-gate** (R3, R8): characterization / no-behaviour-change tests committed for the
  target surface. Owner: Opus review.
- **migration-gate** (R7, R9): upgrade scenario fixtures + HOME/XDG e2e + dirty-repo behaviour test
  committed and green. Owner: Opus review.
- **host-parity-gate** (R4): capability-matrix contract doc + matrix test committed.
- **tool-contract-gate** (R5, R6, R10): output/error/degradation schema defined + a test asserting
  the typed shape.

## Critical-path note

R7 (silent destruction of user state) is the only **Critical** risk and dominates ordering: no
lifecycle, document-intake, or registry-migration implementation may begin until the migration-gate
fixtures exist. This is consistent with the owner's "non-destructive on install/init/sync/upgrade"
mandate and traffic jam #5.
