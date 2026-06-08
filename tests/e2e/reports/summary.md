<!--
tests/e2e/reports/summary.md — Cross-scenario synthesis for the Construct E2E owner-review pass.

Generated 2026-06-06 from three executed sterile scenarios (greenfield Next.js, established noisy project, research corpus).
Aggregates per-scenario reports into one owner verdict + bd issue index. See scenario-{a,b,c}-*.md for detail.
-->

# Construct E2E owner-review — cross-scenario synthesis

> Three sterile scenarios, executed end-to-end on 2026-06-06. Every claim traces to a captured evidence file or a scenario report. Real specialist chains (host subagents) produced and independently graded the three quality artifacts.

## Scope executed

- **3 scenarios** (greenfield Next.js · established noisy project · research corpus), each in an isolated tmpdir with its own `HOME` + `CX_HOME_OVERRIDE` and the local build under test.
- **Command sweep:** 107 commands (92 public + 15 internal); **107/107 `--help` resolve** (Scenario A, catalog-level).
- **3 quality-bar artifacts via real specialist chains:** an ADR (`cx-architect`→`cx-reviewer`, APPROVED_WITH_WARNINGS), a PRD (`cx-product-manager`, validated), an evidence brief (`cx-researcher`→`cx-evaluator`, **4.8/5 PASS**).
- **Embedder (Tier 7):** CLI-JSON surface — 4/5 contract verbs emit valid `contractVersion 1.1.0` envelopes. SDK / MCP / HTTP+SSE deferred to a shared step (see Coverage gaps).

## Per-scenario headline

| Scenario | Headline result |
|---|---|
| **A — Greenfield Next.js** | All 7 tiers ran. Install/init exit 0 in ~69s; ADR artifact ships. Defects: internal-command **completion leak** (`h8tx.9`), pg-NOTICE install noise (`h8tx.6`), `intake classify --json` no envelope (`h8tx.8`). |
| **B — Established noisy** | **Non-destructive scaffolding (ADR-0027) passes 6/6** over pre-seeded host noise — marker block injected without clobbering, `.gitignore` appended, foreign files preserved. PRD ships. **No new defects.** Beats SuperClaude/ruflo (both leave preservation undocumented). |
| **C — Research corpus** | Evidence brief **4.8/5 PASS**, no-fabrication stress-tested (refused to invent unreadable-PDF numbers). But the **intake-ingest pipeline hangs** on an unpulled local Ollama model (`h8tx.11`) — the research scenario's reliability floor. |

## Cross-cutting findings

1. **The real specialist mechanism works — and it's host-driven.** `construct ask` is RAG, not persona dispatch; the cx-* specialists run as host (Claude Code) subagents. All three are **Read-only** (architect, PM, researcher) — they propose; the orchestrator persists. The chains produced distinct, role-appropriate, independently-gradable artifacts.
2. **No-fabrication holds under stress.** Across all three artifacts, every load-bearing claim traced to a source; version numbers were read from `package.json`; unverifiable numbers were marked `[unverified]` (the researcher refused to invent figures from unreadable PDFs and disclosed the limitation). This is the single most reassuring result of the pass.
3. **Non-destructive scaffolding is a genuine competitive advantage** (Scenario B) — documented (ADR-0027) and empirically proven, where both compared peers leave file preservation undocumented.
4. **Install-stdout noise is the recurring UX weak point** — the same pg-NOTICE leak + duplicate sync lines appear in every scenario's install. It's the first thing every user sees.
5. **Local-provider reliability is the recurring functional weak point** — install picks Ollama model tags without verifying they're pulled; the model call then hangs with no timeout (`h8tx.11`).

## Highest-leverage improvements

**CLI-facing (user surface):** fix the **internal-command completion leak (`h8tx.9`)** and **suppress the pg-NOTICE install noise (`h8tx.6` + `h8tx.7`)**. The first is a one-line `completions.mjs` filter that restores a documented contract; the second removes the most jarring noise from the first thing every user sees. Together: small diffs, large polish gain.

**Embedder-facing (integration surface):** fix the **intake-ingest hang (`h8tx.11`)** — verify pulled provider models at install and bound the provider call with a timeout + actionable error — and make **`intake classify --json` return a typed envelope (`h8tx.8`)** instead of exit-1/null. The ingest hang is the only *functional* blocker found; everything else is polish or contract hygiene.

## bd issue index

| ID | P | Scenario | Status | Finding |
|---|---|---|---|---|
| `construct-e9ur` | P1 | (pre-existing) | **CLOSED** | Launcher npx dead-end — fixed by `fb210e2` (trySelfRepo + re-stage + drift guards) |
| `construct-h8tx.11` | P2 | C | open | Intake ingest hangs on unpulled local Ollama model (no timeout) |
| `construct-h8tx.9` | P2 | A | open | All 15 internal commands leak into bash + zsh completion |
| `construct-h8tx.6` | P2 | A/B/C | open | Raw Postgres NOTICE objects leak to install/init stdout |
| `construct-h8tx.8` | P2 | A/C | open | `intake classify --json` returns exit 1/null, not a typed envelope |
| `construct-h8tx.7` | P3 | A/B/C | open | Duplicate "Synced/Completions" lines in install |
| `construct-h8tx.10` | P4 | A | open | README install row unescaped pipes break table |

No P0 defects. One P1 (the launcher bug) found and fixed during the pass.

## Coverage gaps (honest)

- **Tier 7 SDK / MCP / HTTP+SSE surfaces** were not driven end-to-end (only CLI-JSON). The probe contracts exist in `embed-probes.mjs`; the host scripts (`sdk-host.mjs`, `mcp-host.mjs`, `http-host.mjs`, `review-host.mjs`) remain to be run.
- **`cx-debugger` gateway probe** (role-pending threshold/cooldown via a synthesized failing test) not run.
- **Tiers 2 & 5 not re-run in B/C** — they are catalog-level and scenario-independent; Scenario A's results stand.
- **PDF text extraction** needs `poppler` (absent here); relevant to the intake pipeline's PDF handling.
- **Sterile ≠ user machine** for OS-level integration (launchd, global PATH); the `construct on PATH` doctor warnings in-sandbox are test-env artifacts.

## Owner verdict

Construct's **distinctive surfaces are strong**: non-destructive scaffolding is a real moat, the specialist artifacts are senior-IC-grade and no-fabrication-clean, and the embedded contract emits stable versioned envelopes. The **weak points are concentrated and fixable**: install noise (cosmetic), a completion-contract leak (one-liner), and one functional reliability bug in local-provider ingest (`h8tx.11`). Ship the two highest-leverage fixes above and the surface materially tightens.
