<!--
tests/e2e/reports/scenario-c-research-corpus.md — Scenario C (Research project) E2E owner-review report.

Generated from a real sterile run on 2026-06-06: research profile + real corpus (3 arXiv PDFs + 5 internal notes) in .cx/inbox/, intake loop, and an evidence brief via cx-researcher -> cx-evaluator (scored 4.8/5).
Tiers 1, 3, 4(intake), 6, 7 executed; catalog-level tiers (2, 5) validated in Scenario A. Evidence: /tmp/c-setup.json, /tmp/c-ingest-nosync.out.
-->

# Scenario C — Research project

> **Status: EXECUTED.** The research-distinctive tiers ran against a real sterile environment: a real primary-source corpus on the `research` profile, the intake loop, and a real evidence brief produced and independently scored by the cx-researcher → cx-evaluator chain. Catalog-level tiers (2 command sweep, 5 doc parity) are identical to Scenario A. No fabricated results.

## Scenario definition

- **Profile:** `research` (switched from `rnd` via `construct profile set research`; structural diff confirmed: roles `+product-lead, operator`, `−architect, engineer, qa, …`).
- **Fixture:** fresh `git init` + a real corpus in `.cx/inbox/` — **3 arXiv PDFs** (Sentence-BERT 1908.10084 · Dense Passage Retrieval 2004.04906 · Lost in the Middle 2307.03172, all downloaded fresh, all <2 MB: 549 KB / 384 KB / 748 KB) + **5 markdown notes** (prior internal thinking on hybrid retrieval, normalization, context ordering, chunking, eval gap).
- **Sterile env:** dedicated tmpdir, isolated `HOME` + `CX_HOME_OVERRIDE`, `CONSTRUCT_DEV_PATH` → repo under test. Root: `/var/folders/.../cx-e2e-c-xRT2lb`.
- **Reproducibility:** PDFs are fetched at run time from canonical arXiv URLs (manifest in `scenario-c.mjs`) rather than committed, keeping the repo clean.

---

## Tier 1 — Install + Init UX (research profile)

`install --scope=user --yes` (47.2s) + `init --yes` (23.7s) + `profile set research` (exit 0), all clean. Install/init UX matches Scenarios A/B (same strong completion signal; same pg-NOTICE noise `h8tx.6`/`h8tx.7`, not re-filed). **Profile switch works:** the `rnd → research` transition printed a clear structural diff of which specialist roles are added/removed — good transparency for a profile change.

**Tier-1 verdict:** Functions **Y** · Documented **Y** · Recommendation **ship** (profile switch) / **iterate** (inherited install noise).

---

## Tier 2 — Command sweep (deferred — validated in Scenario A)

Catalog-level and scenario-independent; see `scenario-a-greenfield-nextjs.md` Tier 2 (107/107 `--help` resolve).

---

## Tier 3 — Quality-bar artifact (real specialist chain, independently scored)

**Artifact:** `.cx/research/0001-retrieval-evidence-brief.md` — synthesizes the corpus on dense-vs-sparse retrieval and context positioning.

**Chain:** `cx-researcher` (authored) → persisted → `cx-evaluator` (independent rubric score). Both are Read-only specialists (consistent mechanism).

**cx-evaluator score: 4.8 / 5 — verdict PASS** ("a senior researcher would act on this"):

| Rubric dimension | Score |
|---|---|
| Sourcing rigor (≥2 primary where claimed; single-source flagged) | 5/5 |
| Observation vs inference separation | 5/5 |
| No fabrication ([unverified] not invented; limitation disclosed) | 5/5 |
| Source-class + Admiralty tagging | 4/5 (minor grade-calibration nit) |
| Decision usefulness (actionable + flip threshold) | 5/5 |
| Internal-note adjudication (5 notes judged honestly) | 5/5 |

**Structural validation:** `lint:comments` clean; 3 PRIMARY + 5 INTERNAL-NOTE tags; OBSERVATION/INFERENCE separated (6/2); Admiralty grades + 10 honest `[unverified]` markers; internal notes adjudicated (N1/N3/N5 CONFIRMED, N2/N4 UNSUPPORTED, none CONTRADICTED).

**Standout — no-fabrication under pressure:** the corpus PDFs were **not text-extractable** (poppler/`pdftoppm` absent; FlateDecode streams — independently confirmed by the evaluator). Rather than invent quotes/page anchors, the researcher **disclosed the limitation**, verified the same papers from canonical arXiv/ACL URLs, and marked table-resident numbers (DPR per-dataset lift, Lost-in-the-Middle gap) `[unverified]`. This is exactly the behavior the no-fabrication rule exists to produce.

**Owner verdict — six dimensions:** Depth high (≥2 primary for the load-bearing claim, single-source honestly flagged); Sourcing exemplary; Decision-forcing yes (build the eval harness FIRST, with a stated flip threshold); No fabrication confirmed and stress-tested; Template fidelity (evidence-brief structure with source register + confidence summary); Specialist signature distinct (researcher's sourced/hedged voice; evaluator's adversarial rubric).

**Tier-3 verdict:** Functions **Y** · Recommendation **ship** (4.8/5, independently graded).

---

## Tier 4 — Loops, skills, specialists, templates + the intake loop

**Intake loop (research profile) — executed, with a reliability finding:**
- After dropping 8 corpus files into `.cx/inbox/`, `intake list` returned **"No pending questions"** — files are not auto-enqueued instantly; the queue is populated by the intake daemon (interval poll) or an explicit `construct ingest ./.cx/inbox --sync`. The plan's "drop to trigger" assumption needs the daemon or an explicit ingest.
- `construct ingest ./.cx/inbox` **hung indefinitely** (killed at >3 min with `--sync`, >40 s without). Root cause: install auto-applied local **Ollama** model defaults (`llama3.2:3b` etc.) that are **not pulled** in the local Ollama (only `qwen3-coder:32k` is present); intake triage's model call blocks on the missing model with no timeout and no progress output. → **bd `construct-h8tx.11`** (P2). The evidence brief was therefore produced by the host specialist reading the corpus directly, which is the real specialist path.

**Specialist chain + skills + templates:** the cx-researcher → cx-evaluator chain ran and produced distinct role output (Tier 3). Skill loading verified in Scenario A (scenario-independent). Template fidelity confirmed in Tier 3.

**Tier-4 verdict:** specialist chain **ship**; intake-ingest **file** (`h8tx.11`).

---

## Tier 5 — Documentation parity (deferred — validated in A)

Catalog-level; see Scenario A Tier 5 (including the internal-command completion leak `h8tx.9`).

---

## Tier 6 — Peer comparison (research-corpus ingestion + evidence-brief output)

- **Dimension:** Research-corpus ingestion + evidence-brief output
- **Peer:** gpt-researcher (`https://github.com/assafelovic/gpt-researcher`, primary source, accessed 2026-06-06 — referenced from the plan's source list)

**What Construct does better:** the evidence brief enforces **per-claim sourcing discipline** (≥2 primary sources where claimed, single-source explicitly flagged), **observation-vs-inference separation**, **source-class + Admiralty tagging**, and **adjudication of in-house hypotheses against the literature** — with an independent cx-evaluator score gating quality. gpt-researcher's strength is breadth of live web aggregation into a readable report; Construct's strength is the audit-grade, decision-forcing structure and the no-fabrication enforcement (it refused to invent the numbers it could not extract).

**What Construct does worse:** gpt-researcher is purpose-built for autonomous multi-source web research and would have *fetched and read* the source PDFs' full text via its own extraction pipeline; Construct's local ingest stalled (`h8tx.11`) and PDF extraction needs poppler, so the corpus had to be read around. For raw ingestion throughput on a pile of PDFs, Construct currently loses.

**Smallest UX change, highest payoff:** fix `h8tx.11` (verify pulled Ollama models at install + bound the provider call) and ensure PDF text extraction has a working backend — that unblocks the intake loop that this scenario is built around.

**Tier-6 verdict:** Construct wins on evidence-brief *rigor*; loses on corpus *ingestion* reliability until `h8tx.11` is fixed.

---

## Tier 7 — Invocable by other applications (parity confirmed)

CLI-JSON parity holds (project-independent); full matrix incl. `intake classify --json` in Scenario A. Note: `intake classify --json` requires an artifact (`--text|--file|<stdin>`); bare invocation exits 1 with null — it should return a typed error envelope (refines `h8tx.8`). SDK/MCP/HTTP+SSE deferred to the shared cross-scenario step.

---

## Owner-review verdict grid (executed tiers)

| Subject | Functions | Documented | Discoverable | Noise | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Tier 1 — profile switch + init | Y | Y | Y | low | ship |
| Tier 3 — evidence brief (4.8/5) | Y | Y | Y | low | ship |
| Tier 4 — intake ingest (ollama hang) | N | Y | Y | high | file |
| Tier 6 — peer (vs gpt-researcher) | Y | Y | Y | low | iterate |
| Tier 7 — CLI-JSON parity | Y | Y | Y | low | ship |

## bd issue index (Scenario C)

| ID | P | Finding |
|---|---|---|
| `construct-h8tx.11` | P2 | Intake ingest hangs on unpulled local Ollama model (no timeout, no progress) — **the scenario-C headline** |
| `construct-h8tx.8` | P2 | `intake classify --json` returns exit 1/null instead of a typed error envelope (carryover; refined: needs artifact input) |

Carryover noise (filed in A): `h8tx.6`, `h8tx.7`. Environmental (not a Construct defect): PDF text extraction needs `poppler`, absent here.

## Highest-leverage Scenario-C finding

**The evidence brief is genuinely excellent (4.8/5, no-fabrication stress-tested), but the intake-ingest pipeline that should feed it hangs (`h8tx.11`).** The research scenario's quality ceiling is high; its reliability floor is the ingest hang. Fixing `h8tx.11` (verify pulled models at install + bound the provider call) is the highest-leverage research-scenario change.
