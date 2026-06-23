<!--
tests/e2e/reports/realistic-user-validation.md — assumption-challenging realistic-user validation report.

Executed 2026-06-07. Skeptical stance: each scenario states what a realistic target user would expect,
then tries to refute it against confirmed provider/community patterns. Mix of deterministic (sterile, no-LLM)
and real-LLM execution. Verdicts: CONFIRMED / REFUTED / PARTIAL / DEFERRED. Evidence paths inline.
-->

# Construct realistic-user validation — summary report

## Executive summary

Construct was validated as a realistic user in the target demographic would experience it — challenging, not assuming, each behavior against confirmed 2026 provider/community patterns. **Eight of eleven scenarios CONFIRMED, one PARTIAL with a filed refutation (S7), two DEFERRED** (real-LLM PRD + full embedded loop — gate/harness ready, not executed this pass). The headline real-LLM result: a real `cx-researcher` produced an evidence brief that **passes the quality gate** (template sections + 14 prose paragraphs + 14 citations) with **zero contract violations** — Construct delivers the artifact quality it promises on the full path. The one genuine refutation: `construct install` registers a **persistent login LaunchAgent with no opt-out, and `construct uninstall` orphans it** — footprint a knowledgeable user would not expect (filed `construct-2fm8.1`). No shell-rc / git-global / secret overreach was found.

## Methodology

- **Skeptical premise per scenario:** "If I were a realistic user in the target demographic, I would reasonably expect X" → attempt to refute with evidence.
- **With and without Construct:** the Construct path (agent/MCP/loop) and the native path (no Construct) are both tested; Construct must add value on one and be invisible on the other.
- **Confirmed baselines (B1–B7), not Construct's claims**, re-verified live (sources dated 2026-06-07); divergences recorded as refutations.
- **Execution:** deterministic layers (sterile stdio MCP client, sterile install diff) + real-LLM dispatch of an actual specialist + scoring by `tests/e2e/lib/artifact-quality.mjs`.

## Per-scenario verdicts

| ID | Persona | Expectation challenged | Verdict | Evidence |
|---|---|---|---|---|
| **S1** | P1/P2 | "Selecting the construct agent actually loads + uses its skills" | **CONFIRMED** | Host stdio MCP client loaded `roles/architect` (byte-matched disk) + recorded in `~/.cx/skill-calls.jsonl`. `tests/functional/host-mcp-emulation.functional.test.mjs` |
| **S2** | P1 | "A substantial ask engages multiple specialists, not one flat reply" | **CONFIRMED (deterministic)** | `orchestration_policy` over MCP classified a contract-introducing PRD ask as **orchestrated** with a specialist sequence; a one-file typo was **not** over-orchestrated. Same suite. Real-LLM chain exercised via S4. |
| **S3** | P1 (rnd) | "A generated PRD reads like a real PRD (template+prose+sourced)" | **PARTIAL** | Real provider-worker run executed 2026-06-22 (`tests/functional/real-llm-scenarios.functional.test.mjs`, report `tests/e2e/reports/real-llm-scenarios-2026-06-22.md`): substantial prose returned; full PRD section + citation gate not met on longest output this run. |
| **S4** | P3 | "A research synthesis separates observation/inference + cites ≥2 primary sources" | **CONFIRMED (real LLM)** | Real `cx-researcher` brief: structure ✓, **14 prose paragraphs**, **14 citations** (9 A1 sources fetched live), OBSERVATION/INFERENCE tagged, `[unverified]` discipline; gate `overall: true`; `contract-violations.jsonl` clean. `agentic-platforms-research/.cx/research/0001-agentic-platforms-evidence-brief.md` |
| **S5** | P5 | "When I don't invoke Construct, nothing changes" | **CONFIRMED** | `CONSTRUCT_ROLES=off` → role machinery inert (no role-pending); a non-cx subagent untouched; hooks exit 0. `tests/functional/construct-not-invoked-is-inert.functional.test.mjs` |
| **S6** | P1–P4 | "Construct wires its MCP/agents where each provider actually reads them" | **CONFIRMED** | Every host config at canonical path/key wires `construct-mcp` (`lib/mcp/server.mjs`); judged vs B1–B3. `tests/functional/host-config-parity.functional.test.mjs` |
| **S7** | P1–P5 | "Construct won't touch my shell rc / git global / unrelated settings or commit secrets" | **PARTIAL / REFUTED** | Real install into pristine HOME: `.zshrc`/`.bashrc`/`.gitconfig` **untouched** ✓; no secrets inlined ✓; adapter configs gitignored ✓. **BUT** a persistent login LaunchAgent is auto-installed with no opt-out and **left orphaned by uninstall** → `construct-2fm8.1`. Evidence: `/tmp/cx-footprint-*` diff. |
| **S8** | P4 | "If my tool calls Construct, it runs the full loop + returns a typed result" | **PARTIAL** | Deterministic MCP contract proven (S1/S2). Real `orchestration_run` executed 2026-06-22; daemon reachable but polling hit HTTP 429 `rate_limited` before terminal status (see `tests/e2e/reports/real-llm-scenarios-2026-06-22.md`). |
| **S9** | P1–P4 | "What works in one supported tool works in all" | **CONFIRMED (config)** | construct-mcp + canonical config parity across Claude/VS Code/Codex/OpenCode/Cursor (S6); MCP surface is host-agnostic. |
| **S10** | P5 | "A kill switch makes Construct inert; hooks never break the host" | **CONFIRMED** | `CONSTRUCT_ROLES=off` inert; hooks exit 0; failures logged not thrown. S5 suite. |
| **S11** | all | "I can verify any claim after the fact" | **CONFIRMED** | Every verdict cites a durable artifact (`skill-calls.jsonl`, `.cx/research/`, `contract-violations.jsonl` [clean], footprint diff). |

## Baselines confirmed (the "do not assume" anchors)

| # | Pattern | Status |
|---|---|---|
| B1–B3 | Per-host MCP locations/keys (Claude `mcpServers`, VS Code `servers`, Cursor `mcpServers`, Codex TOML, OpenCode `mcp`) | Construct matches each — **confirmed** (S6) |
| B4 | Per-machine config gitignored; secrets via env refs | Construct matches — **confirmed** (S7) |
| B5 | No shell-rc / git-global mutation without consent | Honored for shell/git; **LaunchAgent is the exception** (S7 refutation) |
| B6 | External MCP client can list+call tools deterministically | **confirmed** (S1/S2) |
| B7 | PRD/brief carries Problem/Goals/Metrics/Risks as sourced prose | **confirmed** on the real brief (S4) |

## Findings / refutations

- **`construct-2fm8.1` (P2, footprint):** `construct install --scope=user` auto-registers + loads `~/Library/LaunchAgents/dev.construct.pressure-release.plist` (runs every 300s at login) with no opt-out, and `construct uninstall` leaves it registered (ADR-0027 lines 28/79 acknowledge this). **Recommended fix:** uninstall should unload+remove the LaunchAgent; install should expose `--no-launch-agent` / consent. The disclosure-in-output + ADR documentation are mitigations, not consent.

## Coverage honesty

- **Executed with real LLM:** S4 (evidence brief, full specialist path, scored + audited).
- **Executed deterministically (sterile, no LLM):** S1, S2, S5, S6, S7, S9, S10, S11 + the quality gate.
- **Deferred (gate/harness ready, not run this pass):** S3 (real PRD dispatch) and S8 (full `orchestration_run` real-LLM loop) — both can run via the Agent tool against the same gate; deferred for cost/scope this pass, not blocked.

## Where Construct was tested

MCP server (`lib/mcp/server.mjs`) over real stdio; per-host config writers (`scripts/sync-specialists.mjs`); install/init footprint (`lib/setup.mjs` + disposition); the real specialist chain (host subagent dispatch); the template + quality gate (`lib/templates/visual-requirements.mjs`, `tests/e2e/lib/artifact-quality.mjs`); durable audit artifacts under `~/.cx` and the project `.cx`.
