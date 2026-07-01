<!--
tests/audit/REMEDIATION-PLAN.md — synthesis of the 2026-06-30 full-project audit remediation.

Consolidates 14 parallel investigation agents into the audit's requested deliverables:
proof status, execution order, dependency graph, traffic-jam coordinator map, and a
per-family rollup with red-fixture paths, bead sets, and newly discovered defects.
Updated when families are remediated (red fixtures promoted to *.test.mjs) or rescoped.
-->

# Construct Full-Project Audit — Remediation Plan (F01–F14)

Source: `construct_full_project_audit_standalone_2026-06-30.pdf`. Baseline: `audit/best-practice-remediation` off `fix/vscode-mcp-autostart` (HEAD 81270231). This plan is the synthesis of 14 parallel investigation agents that verified each finding family against live code and produced failing red fixtures.

## Proof status (red baseline)

`node --test tests/audit/**/*.red.mjs` → **104 tests · 7 pass · 97 fail**. The 7 passes are intentional preconditions (corpus well-formed, partition holds today, idempotence) so each failure is the contract gap, not a setup artifact. 50 fixtures across 14 families. No source or host-state mutation (`git status` clean except `tests/audit/`).

Promotion contract: each `*.red.mjs` is renamed to `*.test.mjs` when its fix lands, wiring it into `npm test` as a permanent regression guard.

## Execution order (audit's, with blocking rationale)

1. **F01** MCP tool safety — close shell/fs/destructive paths before expanding host reach.
2. **F02** Secrets — stop persistent leaks + fix file-mode/precedence before package/host smokes.
3. **F03** Package/install — prove the npm consumer shape before host-adapter polish.
4. **F04** VS Code/Copilot readiness — verify host state once package/install assets are correct.
5. **F05** Runtime ownership — prevent accidental process kills before broad start/stop guidance.
6. **F06** Docker/deploy — prove the image boots before treating deploy workflows as valid.
7. **F07** CI/CD — pin + prove the release path before public artifacts.
8. **F08** Prompt-injection — build adversarial fixtures around the final tool-safety contract.
9. **F09** Orchestration — bound provider/remote calls + persist terminal errors.
10. **F10–F14** — drift, disposition, doctor gates, artifact visual proof, tool evals as release-quality enforcement.

## Dependency graph (blocking + coordination edges)

- **F12-GATES-001** (gate→red-fixture manifest) is BLOCKED-BY every F01–F11 family — their fixtures must exist and be registered. F12 sequences last.
- **F08-LLMSEC-003 and F04-HOST-005 edit the same line** — `COPILOT_AGENT_TOOLS` (`sync-specialists.mjs:1371`). One coordinated edit, not two.
- **F01 → F14-001/-002/-003**: all edit the `lib/mcp/server.mjs` CallTool handler (`:1546-1597`). F01 lands the timeout/error/destructive envelope first; F14 layers span instrumentation + output schemas on top.
- **F08-LLMSEC-001** changes `web-search.mjs` return shape → coordinate with F01's tool-arg work on `lib/mcp/tools/**`.
- **F06 ⇄ F07**: both edit the `release.yml` docker job (F06 reorders build→scan→push; F07 SHA-pins). Single edit to that job.
- **F03 ⇄ F11**: both touch the init `.gitignore` writer (`init-unified.mjs:890-900`).

## Traffic-jam coordinator map (one writer per file)

| Shared file | Families | Coordination |
|---|---|---|
| `scripts/sync-specialists.mjs` (2363 lines) | F04 (host region ~1371–1536), F08 (grants 1371), F10 (bridge 80–185) | **Coordinator bead.** F04+F08 share line 1371 exactly. |
| `lib/mcp/server.mjs` | F01 (handler), F14 (catalog/schema/span); F08 reads | **Coordinator.** F01 before F14. |
| `lib/mcp/tools/**` | F01, F08, F14 | **Coordinator.** One envelope/result shape. |
| `lib/env-config.mjs`, `lib/providers/secret-resolver.mjs`, `lib/mcp-platform-config.mjs` | F02 (+ `construct-trxz`) | **Coordinator.** Sequence with the secrets epic. |
| `.github/workflows/*.yml` | F06 (release.yml docker), F07 (all) | **Coordinator** on release.yml/ci.yml. |
| `package.json`, `package-lock.json` | F03 | Protected install path. |
| `bin/construct-postinstall.mjs`, `lib/install/stage-project.mjs` | F03 (+ F11 via init gitignore) | Protected hook-class. |
| `schemas/project-config.schema.json` + `lib/config/schema.mjs` | F10 | Generate one from the other. |
| `bin/construct` (cmdDoctor) + `lib/doctor/*` | F12 (+ F04 readiness lane, F05 stop-status branch) | Coordinator. |
| `lib/registry/*` + `docs/guides/reference/**` | F10, F14 | Coordinator on generation ownership. |
| `lib/service-manager.mjs` | F05 | Isolated. |
| `Dockerfile` + `deploy/**` | F06 | Isolated (pending F06 decision). |
| `lib/output-quality.mjs` | F13 | Isolated. |
| `lib/host-disposition.mjs` | F11 | Mostly isolated. |
| `lib/orchestration/**` | F09 (+ `construct-5wkl`) | Sequence with the orchestration epic. |

## Cross-epic overlap with existing beads

- **F02 ⇄ `construct-trxz`** (Secrets & credential handling remediation): SECRETS-002/-001/-003 map to its Epics 4/5/8. The value-free audit event + file-tier parity tests already partly landed there. **Cross-link; do not edit `secret-resolver.mjs` in parallel.**
- **F09 ⇄ `construct-5wkl`** (provider-backed orchestration reliability): ORCH-003 (provider timeout/retry/budgets) is subsumed by its AC#1/#4 → fold. ORCH-001 (inline-vs-executed truthfulness), ORCH-002 (terminal-error persistence), ORCH-004 (remote per-request timeout) are net-new.

## Per-family rollup

Each family: owner · red fixtures (all failing) · bead set · the genuine new defect(s) found beyond the audit.

- **F01 MCP tool safety (P0)** — Security+MCP. 5 fixtures (malicious-ref shell injection, scanfile traversal/symlink/UNC, destructive confirm=true, **delete-traversal**, missing safety envelope). Beads SAFETY-001..005. NEW: `deleteIngestedArtifacts` (`lib/storage/admin.mjs:57-58`) path-traversal deletes outside the ingested root — destructive twin of the scanFile read.
- **F02 Secrets (P0)** — Security+provider. 4 fixtures (generated-config leak, config.env 0644, precedence divergence, audit-tier). Beads SECRETS-001..005. NEW: secret audit wiring is CLI-only; workers/daemons resolve into a null sink. R14 partly stale (only the process.env tier diverges now).
- **F03 Package/install (P0)** — Release+install. 3 fixtures (packed-asset parity, half-stage recovery, postinstall mutation manifest). Beads PACKAGE-001..005. Empirically: missing `registry/`+root `schemas/` ⇒ agent-manifest ENOENT, 17/21 schemas dropped. NEW: `config/tag-vocabulary.json` + `vendor/pandoc-ext/diagram.lua` also unshipped (tagging + publish break on consumer install).
- **F04 VS Code/Copilot readiness (P0)** — Host adapters. 5 fixtures (JSONC-safe merge, Windows path, setting-key case, least-privilege grants, readiness state machine). Beads HOST-001..005. NEW: JSONC silent-skip spans 6+ sites; a user's commented `mcp.json` is reset to `{servers:{}}`, dropping their other servers. A pre-existing test green-locks the bug. **Setting-key casing (`autostart` vs `autoStart`) needs VS Code schema verification — HOST-001 blocker.**
- **F05 Runtime ownership (P0)** — Runtime. 3 fixtures/6 tests (non-owner refusal, stale-port, owned-stop predicate absent). Beads RUNTIME-001..004. NEW: hardcoded fallback ports (5173/5174) mean `construct stop` can SIGTERM a Vite dev server on a machine that never ran Construct.
- **F06 Docker/deploy (P0)** — Deploy. 3 fixtures (entrypoint-existence, healthcheck-implementation, release-gating). Beads DOCKER-001..004. **NEW/severe: the entire dashboard surface (`lib/server/**`, `apps/dashboard/**`) was deleted by ADR-0039 (2026-06-25); the image has been guaranteed to fail at boot since. Dockerfile, ECS Terraform, ALB health check, runbook, PRD-0002 all point at a phantom endpoint.** → architectural decision required.
- **F07 CI/CD (P0)** — Release eng+security. 5 fixtures/10 assertions (action-pin, permissions, policy-gate-blocking, release-tooling-pin, terraform-plan-redaction). Beads CI-001..005. Zero of ~50 `uses:` are SHA-pinned; 6 workflows lack `permissions:`; Terraform plan posts unredacted secrets to PRs. NEW: `docs.yml` can `git push HEAD:main` via unpinned checkout; gitleaks itself unpinned. R25 mis-attributed AWS/github-script actions to release.yml (they're in deploy.yml).
- **F08 Prompt-injection (P0)** — Security+orchestration. 3 fixtures (untrusted-ingest labeling, excessive-agency grants, adversarial corpus). Beads LLMSEC-001..004. Repo-wide grep for any trust/injection-labeling construct returns zero. NEW: attribution stamps authorship not trust (false reassurance); raw external content persists into the observation store and resurfaces via `memory_search` across sessions (durable injection vector).
- **F09 Orchestration (P1)** — Orchestration. 4 fixtures (inline-truthfulness, provider-timeout, error-persistence, remote-per-request-timeout). Beads ORCH-001..004. R17 corrected: runtime is honest; `shapeRun` (`orchestration-run.mjs:19-36`) drops `run.semantics` and reports `completed`. NEW: `getRuns` projection drops warnings/error summary — ORCH-002 must widen it.
- **F10 Registry/schema drift (P1)** — Architecture. 4 fixtures (schema-parity, fail-closed validation, catalog-semantic-drift, bridge-smell). Beads REGISTRY-001..004. NEW: `sandbox.mjs:58` writes a `profile` key the scope loader never reads (latent functional bug); 5 runtime keys absent from JSON Schema; catalog drift is structural self-reference (compares a file to a snapshot of itself).
- **F11 Disposition (P1)** — Install+disposition. 3 fixtures (mis-disposition, contradiction, coverage). Beads DISPOSITION-001..004. Scope correction: only `copilot-instructions.md` is a genuine contradiction; `plan.md`'s local-only status is deliberate (ADR-0027). NEW: `.github/agents/*.agent.md` fully undispositioned; gitignore-coverage has no un-ignore/backward-repair path.
- **F12 Doctor/gates (P1)** — Quality. 3 fixtures (AUDIT.md staleness, gate-fixture inventory, doctor specificity). Beads GATES-001..004. **Meta-gate: GATES-001 depends on all F01–F11 fixtures.** Doctor is a flat `{label,pass,optional}` checklist with no typed states. NEW: coverage gate also advisory; `tests/AUDIT.md` self-contradicts and references a foreign project name "construct-sbh" (provenance smell).
- **F13 Artifact quality (P1)** — Artifact+docs. 3 fixtures/7 tests (required-renderer soft-pass, invisible/overlapping text, missing-local-reference). Beads ARTIFACT-001..004. A pre-existing test codifies the soft-pass as intended (must be flipped). NEW: content-roundtrip *rewards* invisible text (opacity:0 is extractable, so it passes); exported-file internal refs never validated.
- **F14 Tool design (P1)** — MCP+agent UX. 4 fixtures (exposure-parity, output-schema coverage, description-overlap, token-budget/instrumentation). Beads TOOLS-001..004. 75 tools (docs claim 71); 0/75 have output schemas; 7-tool retrieval-overlap cluster. NEW: dead telemetry import (`withGenAiSpan` imported, never wired); `find_tool` mis-instructs agents to `call` flat core tools.

## Definition of done (from the audit)

No model-callable shell/fs/network/destructive tool without a safety envelope · no live secrets in generated config · no destructive action authorized by `confirm=true` alone · npm pack installs clean with scripts enabled · host readiness proven by host-state checks · Docker image boots (or surface is degated) · CI actions pinned + provenance + redaction-tested · inline orchestration never shown as executed reasoning · every P0/P1 gate has a red fixture · every generated/durable file has one disposition.
