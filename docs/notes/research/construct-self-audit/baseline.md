---
intake: none
---

# Construct Self-Audit — Phase 0 Baseline

Captured: 2026-06-29 · Supervisor: Opus · Branch: `audit/best-practice-alignment` (cut from `main`)

This file records the repo state at the start of the best-practice alignment / self-hosting
certification program. It is evidence, not analysis. Confidence labels: **confirmed** (observed
directly here), **unverified** (claimed by tooling but not independently checked).

## Branch & working tree

- Branch cut: `audit/best-practice-alignment` from `main` (origin/main 0 ahead / 0 behind at cut).
- Working tree was **dirty at cut** — pre-existing, in-progress work carried forward onto the
  audit branch (not authored by this program, not to be overwritten). Recorded for isolation:

  | State | Path |
  |---|---|
  | M | CHANGELOG.md |
  | M | README.md |
  | M | bin/construct |
  | M | docs/guides/reference/cli/models-and-integrations.md |
  | M | docs/guides/reference/mcp-tools.md |
  | M | docs/guides/start/connect-your-editor.mdx |
  | M | lib/cli-commands.mjs |
  | M | lib/hooks/session-start.mjs |
  | M | lib/mcp/server.mjs |
  | M | registry/agent-manifest.json |
  | M | tests/AUDIT.md |
  | M | tests/capabilities/corpus-inventory.json |
  | M | tests/capabilities/mcp.broker.connection/mcp.test.mjs |
  | M | tests/functional/host-mcp-emulation.functional.test.mjs |
  | M | tests/functional/mcp-core-tools.functional.test.mjs |
  | M | tests/functional/opencode-tool-gateway.functional.test.mjs |
  | M | tests/functional/session-start-output-mode.functional.test.mjs |
  | ?? | lib/orchestration/readiness.mjs |
  | ?? | tests/functional/orchestration-readiness.functional.test.mjs |
  | ?? | tests/orchestration-readiness.test.mjs |

  These map to in-progress beads **construct-b4za** (orchestration readiness preflight) and
  **construct-5wkl** (provider-backed orchestration reliability). The audit treats them as
  read-only context; no audit edit may touch these files without an explicit Opus file-lock
  reassignment.

## Beads snapshot

- **18 open**, **4 in-progress**, **0 blocked**. No pre-existing best-practice/self-hosting epic.
- In-progress (relevant to this program):
  - `construct-amfg` P1 — Artifact generation: PDF layout & list fidelity
  - `construct-b4za` P1 — GH-323: orchestration readiness preflight
  - `construct-m4gw.13` P1 — OpenCode: force workflow-backed research routing
  - `construct-zhii` P1 — Restore green test & release state after oracle cleanup
- Open & relevant: `construct-5wkl` (orchestration evidence grounding), `construct-r7bp`
  (OpenRouter `:free` catalog refresh), `construct-2q2m` (host-side tool-miss capture),
  `construct-kurs`/`construct-myz0` (config-protection violations on eslint.config.mjs).

## `construct doctor` — **50 passed, 5 warnings, 0 failed** (confirmed)

Warnings worth routing into the audit:

1. **Contract violations: 63 in last 24h** → `.cx/contract-violations.jsonl`. Directly relevant
   to Agent G (orchestration truth) and the "contract integrity is highest priority" mandate.
2. **Observation cap: 96 obs dropped in last 7d** (`construct memory consolidate`) → Agent I.
3. **Reconciliation drift: `.cursor` adapter dir present for an uninstalled host**
   (`construct sync --reconcile=adapter-prune`) → Agent C (host parity): a host artifact existing
   without the host being installed is exactly the file-parity-vs-capability-parity confusion.
4. **Capability registry: 26 entries, 1 warning** → Agents B/E.
5. **Skill structure: 152 skills, 70 authoring warnings** → Agent J / docs.

Healthy signals (confirmed): cross-surface adapter parity reports
`claude ok · opencode 1/1 · codex 1/1 · copilot 1/1 · vscode 4/0 mcps · cursor not installed`;
capability registry loads (26 entries); Docling 2.45.0 ready; LanceDB reachable; 39 hooks resolve.

## `construct status --json` (confirmed)

- version 1.3.2 · deployment mode **solo** · lastSync 2026-06-25.
- `system.overall`: "0/0 core runtime surfaces reachable" (healthy by policy — solo mode treats
  these as non-impacting). Telemetry local-JSONL healthy; Memory (cm) reachable; OpenCode reachable.

## `construct sync --dry-run` (confirmed)

- `No changes — all outputs are already up to date.` Generated platform files are not drifted from
  source at baseline. (Tier models derived from `openrouter/qwen/qwen3-coder:free`.)

## `construct docs:verify` (confirmed)

- `All documentation checks passed!`

## `npm test` (`node scripts/run-tests.mjs`) — **green** (confirmed)

- `tests 3544 · suites 407 · pass 3536 · fail 0 · cancelled 0 · skipped 8 · todo 0`,
  duration ~83.3s, exit code 0. This is the confirmed green baseline the audit branch starts from;
  any test added by this program must keep this at 0 failures.

## Path verification for audit dispatch (confirmed)

All files and directories referenced in the Phase 2 agent assignments (A–J) were checked and
**exist**. No agent is being dispatched against a non-existent path.

## Phase 0 gate

Read-only baseline complete. No production code modified. Safe to proceed to Phase 1 (epic
creation) and Phase 2 (parallel read-only audit).
