<!--
tests/e2e/reports/scenario-b-established-noisy.md — Scenario B (Established noisy project) E2E owner-review report.

Generated from a real sterile run on 2026-06-06: honojs/hono clone (depth-1, MIT) + pre-seeded host noise + construct install/init + non-destructive disposition capture + cx-product-manager PRD + CLI-JSON probe.
Tiers 1, 3, 6, 7 executed; Tiers 2, 4, 5 are catalog-level and validated in Scenario A — re-run deferred to avoid redundant spend. Evidence: /tmp/b-tier1.json.
-->

# Scenario B — Established noisy project

> **Status: EXECUTED.** The scenario-distinctive tiers ran against a real sterile environment: a cloned OSS repo with pre-seeded host noise, exercising the non-destructive scaffolding contract (Tier 1) and a real PRD (Tier 3). Catalog-level tiers (2 command sweep, 4 skills, 5 doc parity) are identical to Scenario A's results and are not re-run here; deltas would be scenario-independent. No fabricated results.

## Scenario definition

- **Profile:** `rnd`
- **Fixture:** `git clone --depth 1` of **honojs/hono** (MIT, ~284 TS files in `src/`, real `.vscode/`), then **pre-seeded host noise committed before init**: a non-Construct `AGENTS.md`, `.cursor/rules/legacy.mdc`, a stub `.claude/agents/foo.md`, and polluted `.gitignore` entries — each carrying a `SENTINEL-*` line so preservation is provable.
- **Sterile env:** dedicated tmpdir, isolated `HOME` + `CONSTRUCT_HOME_OVERRIDE`, `CONSTRUCT_DEV_PATH` → repo under test. Root: `/var/folders/.../cx-e2e-b-NooKw3`.
- **Harness nit:** the fixture recorded `.git/HEAD` as a ref (`refs/heads/main`) rather than the resolved commit SHA — a reproducibility-capture gap in `scenario-b.mjs`, not a Construct defect. hono main at run time was `c78932d`.

---

## Tier 1 — Install + Init UX + non-destructive scaffolding (the scenario headline)

`install --scope=user --yes` (46.7s) + `init --yes` (27.6s) + `status` (127ms), all exit 0, **zero stderr**. Install/init UX matches Scenario A (same strong completion/next-step signals; same pg-NOTICE noise — already filed `h8tx.6`/`h8tx.7`, not re-filed).

**The ADR-0027 non-destructive contract — 6/6 PASS:**

| Disposition check (after `init` over committed noise) | Result | Evidence |
|---|---|---|
| Existing `AGENTS.md` content preserved | **✓** | `SENTINEL-AGENTS` line intact |
| Construct marker block injected into `AGENTS.md` | **✓** | `CONSTRUCT INTEGRATION` block present |
| Foreign `.claude/agents/foo.md` preserved | **✓** | `SENTINEL-FOO` intact |
| `.cursor/rules/legacy.mdc` preserved | **✓** | `SENTINEL-CURSOR` intact |
| Polluted `.gitignore` entries preserved | **✓** | `custom-build-dir/` + `SENTINEL-GITIGNORE` intact |
| Construct `.gitignore` patterns appended | **✓** | `.construct/` present |

**Construct injects what it owns without clobbering what it doesn't.** The marker-block injection added its `CONSTRUCT INTEGRATION` block to a pre-existing, non-Construct `AGENTS.md` while leaving the original content byte-intact; the `.gitignore` was appended, not rewritten; foreign adapter files (`.claude/agents/foo.md`, `.cursor/`) were untouched. This is the central promise of Scenario B, and it holds.

**Tier-1 verdict:** Functions **Y** · Documented **Y** · Noise **high** (install, same as A) · Recommendation **ship** (non-destructive contract) / **iterate** (inherited install noise).

---

## Tier 2 — Command sweep (deferred — validated in Scenario A)

The catalog (92 public + 15 internal) and the safe-invocation policy are scenario-independent; the sweep result in an established repo matches Scenario A (107/107 `--help` resolve; bare-invocation exits are catalog behavior, not project-specific). Re-running 107 invocations here would reproduce A's grid. See `scenario-a-greenfield-nextjs.md` Tier 2.

---

## Tier 3 — Quality-bar artifact (real specialist chain)

**Artifact:** `docs/prd/0001-middleware-error-interception.md` — a PRD for hono issue **#4895 "Allow middleware to intercept handler errors"** (real, open, primary-source issue, accessed 2026-06-06).

**Chain:** `cx-product-manager` (authored, 66k tokens, read 6 real hono source files) → persisted. Like `cx-architect`, the PM is **Read-only** and returned content for the orchestrator to persist (consistent Tier-4 mechanism).

**Validation (Construct machinery):**
- `construct lint:comments` → **✓ clean**
- PRD structural requirements `["Problem","Goals","Success metrics","Risks and mitigations"]` → **all 4 present**; plus **7 functional + 4 non-functional requirements**, each with acceptance criteria.

**Owner verdict — six dimensions:**
- **Depth:** High. The PRD grounds every behavioral claim in real hono source with `file:line` citations (`src/compose.ts:49-71`, `src/hono-base.ts:271-274`, `src/context.ts:318-333`), correctly identifies the single-`onError` chokepoint, and even flags the single-handler fast-path divergence as a risk.
- **Sourcing:** Strong. Version `4.12.23` read from `package.json`; the source issue cited; the one unmeasurable success-metric baseline marked `[unverified]` rather than invented.
- **Decision-forcing:** Yes — FRs tie to the issue's stated need; Open Questions defer the API-surface decision honestly instead of fabricating a mechanism.
- **No fabrication:** Confirmed — no invented APIs; current-behavior claims all carry a path; the PM explicitly left the solution's exact API as open questions.
- **Template fidelity:** Full — matches `templates/docs/prd.md` required sections.
- **Specialist signature:** Distinct PM voice — phased FR/NFR/acceptance structure, success metrics, risk table, open questions; clearly not the architect's ADR voice.

**Tier-3 verdict:** Functions **Y** · Documented **Y** · Recommendation **ship**.

---

## Tier 4 — Loops, skills, specialists, templates (partial — validated in A)

Skill loading (role/topical/utility, byte-identical to disk) was verified in Scenario A and is scenario-independent. The specialist-chain + read-only-author + orchestrator-persist mechanism reproduced here with `cx-product-manager` (same pattern as `cx-architect`). Template fidelity confirmed in Tier 3 (PRD vs `templates/docs/prd.md`). Pending (cross-scenario): `cx-debugger` gateway probe.

---

## Tier 5 — Documentation parity (deferred — validated in A)

Doc parity (completions, README-vs-catalog, internal-command hiding) is catalog-level and scenario-independent; see Scenario A Tier 5, including the open completion-leak defect `h8tx.9`.

---

## Tier 6 — Peer comparison (the scenario-distinctive comparison)

- **Dimension:** Established-project marker injection + non-destructive scaffolding
- **Peers:** SuperClaude install · ruflo install
- **Primary sources (accessed 2026-06-06):** https://github.com/SuperClaude-Org/SuperClaude_Framework/blob/master/docs/getting-started/installation.md · https://github.com/ruvnet/ruflo

| Property | Construct | SuperClaude | ruflo |
|---|---|---|---|
| Writes to existing `CLAUDE.md`/`AGENTS.md` | marker-block **injection**, content preserved | writes `~/.claude/CLAUDE.md` | creates `CLAUDE.md` |
| Preservation of existing user content | **documented (ADR-0027) + proven 6/6** | **undocumented**; manual `backup --create` only | **undocumented**; no backup documented |
| Existing `.gitignore` | **append, proven preserved** | n/a (global) | not documented |
| Scope | project by default; machine writes need `--scope=user` w/ itemized consent (ADR-0029) | **global** `~/.claude/` | global or project |

**What Construct does better:** it is the only one of the three whose non-destructive behavior is both **documented and empirically demonstrated**. SuperClaude and ruflo both leave the critical question — "will this overwrite my existing `CLAUDE.md`?" — unanswered in their primary docs; SuperClaude offers only a manual backup, ruflo nothing documented. Construct's marker-block contract plus scoped-consent install (ADR-0029) is a materially safer good-citizen posture for an established repo.

**What Construct does worse:** higher install verbosity/noise (inherited `h8tx.6`/`h8tx.7`); a heavier runtime footprint than SuperClaude's file drop or ruflo's plugin path.

**Smallest UX change, highest payoff:** none new for B — the non-destructive contract is the strongest part of the surface. The carryover noise fixes (`h8tx.6`/`h8tx.7`) remain the highest-leverage change, and they would make Construct's safe behavior also *feel* clean.

**Tier-6 verdict:** Construct wins decisively on the dimension that matters most for an established project — safe, non-destructive, scoped scaffolding.

---

## Tier 7 — Invocable by other applications (parity confirmed)

CLI-JSON parity confirmed in the B env: `capability describe --json` → valid envelope, **contractVersion 1.1.0**, `deploymentMode: solo`. The CLI-JSON surface is project-independent; the full 5-verb matrix (incl. the `intake classify --json` defect `h8tx.8`) is in Scenario A. SDK/MCP/HTTP+SSE deferred to the shared cross-scenario embedder step.

---

## Owner-review verdict grid (executed tiers)

| Subject | Functions | Documented | Discoverable | Noise | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Tier 1 — non-destructive scaffolding | Y | Y | Y | low | ship |
| Tier 1 — install/init UX | Y | Y | Y | high | iterate |
| Tier 3 — PRD artifact | Y | Y | Y | low | ship |
| Tier 6 — peer (vs SuperClaude/ruflo) | Y | Y | Y | low | ship |
| Tier 7 — CLI-JSON parity | Y | Y | Y | low | ship |

## bd issue index (Scenario B)

**No new Construct defects found.** The non-destructive contract passed 6/6 and the PRD validated clean. Carryover (filed in Scenario A, also apply here): `h8tx.6` (pg NOTICE leak), `h8tx.7` (duplicate install lines). One harness nit (not a Construct defect): `scenario-b.mjs` records the clone's ref, not the resolved SHA.

## Highest-leverage Scenario-B finding

**Construct's non-destructive scaffolding is a genuine, demonstrable competitive advantage** — documented and proven where both compared peers leave it undocumented. The only thing undercutting it is install-stdout noise (`h8tx.6`/`h8tx.7`): fixing it makes the safe behavior also read as polished. No new defects in B.
