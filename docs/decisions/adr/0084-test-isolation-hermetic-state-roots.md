# ADR-0084: Test-isolation standard — hermetic state roots for every real-state-file class

- **Date**: 2026-07-16
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.9` (ADR-I, the test-isolation standard the 2026-07 continuous-work audit flagged); blocks `construct-4uxq0.14.1` (P0: extend the sterility fingerprint and re-run the suite hermetically)

## Problem

`tests/helpers/sterile-host-env.mjs` is Construct's guard against a host-config test writing into a developer's real machine state. Its leak-detection fingerprint (`countAuditTrailTestLeaks`, `snapshotRealConfigs`/`diffRealConfigs`) currently counts only test-tagged records in one file: `audit-trail.jsonl`. Every other durable file that `doctorRoot()` resolves a path under — approval queues, Oracle state, embed-daemon runtime state, telemetry logs, cost ledgers, hook scratch state — is invisible to the guard. A test that fails to isolate `HOME`/XDG correctly can write into any of those files on the real machine and the guard will report zero leaks, because it was never asked to look.

## Context

`doctorRoot()` (`lib/config/xdg.mjs:55`) is the single resolution point nearly a hundred production call sites use to locate machine-scoped state:

```js
export function doctorRoot(homeDir = os.homedir(), env = process.env) {
  const override = env.CONSTRUCT_DOCTOR_ROOT;
  if (typeof override === 'string' && override.trim()) return override;
  return stateDir(homeDir, env);
}
```

Read in full: called with zero arguments, it resolves `homeDir` from `os.homedir()` and `env` from `process.env`. It honors exactly two override mechanisms — `CONSTRUCT_DOCTOR_ROOT` and (via `stateDir`) `XDG_STATE_HOME` — and falls back to the real OS home directory otherwise. It does not read `CX_HOME_OVERRIDE` anywhere in its body or in `stateDir`/`resolveBase`. This confirms the bead's root-cause claim precisely.

That matters because `CX_HOME_OVERRIDE` is a real, established test-isolation convention elsewhere in this codebase — just not one `doctorRoot()` participates in. `lib/paths.mjs`'s `homeDir()` reads `process.env.CX_HOME_OVERRIDE || os.homedir() || ...`, and `lib/state-root.mjs` (the ADR-0066 axis for `~/.construct/projects/<key>/` and `~/.construct/runtime/`) is built on that helper, so `CX_HOME_OVERRIDE` relocates it correctly for tests. `tests/helpers/sterile-env.mjs`'s `sterileSpawnEnv()` and dozens of commits (`7c2c1c6b Sterilize host-config leaks in 10 test files via per-test CX_HOME_OVERRIDE`, `00be5e79 fix(test-hygiene): pin CX_HOME_OVERRIDE across 40 CLI-spawning tests`, `f23dcd8a ci(test): hermetic construct state root via job-level CX_HOME_OVERRIDE`) treat pinning `CX_HOME_OVERRIDE` as the standard way to sandbox a run. None of that reaches `doctorRoot()`'s axis (`~/.local/state/construct/`, formerly `~/.cx`), which only listens on `CONSTRUCT_DOCTOR_ROOT`/`XDG_STATE_HOME`. `tests/helpers/doctor-root.mjs` documents the fix that was actually shipped for this gap, but scoped to one call site: it pins `CONSTRUCT_DOCTOR_ROOT` process-wide per test file specifically because `lib/audit-trail.mjs` resolves its path per call (so a post-import pin still works); the module's own header notes this pinning strategy depends on that per-call resolution. A number of the other ~90 `doctorRoot()` call sites bind the result once at module load time (e.g. `lib/hook-health.mjs:21`, `lib/contracts/violation-log.mjs:34`, `lib/hooks/audit-trail.mjs:44`, `lib/hooks/context-watch.mjs:39`, `lib/hooks/audit-reads.mjs:42`, `lib/hooks/_lib/log.mjs:27`, `lib/roles/gateway.mjs:62`, `lib/doctor/audit.mjs:20`, `lib/cost-ledger.mjs:30`, `lib/audit-trail.mjs:51`, `lib/sandbox.mjs:27`, `lib/model-pricing.mjs:23`) — for those, a `CONSTRUCT_DOCTOR_ROOT` pin only works if it lands before the module is first imported anywhere in the process, which is fragile under real-world import ordering across a suite.

The 2026-07 continuous-work audit's truth matrix independently reached the same conclusion (`docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md`, row 42): "`sterile-host-env.mjs`'s leak guard only fingerprints `audit-trail.jsonl`, never `approvals/queue.jsonl` — same defect class fixed for one sibling path, not extended to the other," and states as its own evidence: "Confirmed real approvals-queue contamination happened and root cause (0-arg `doctorRoot()` bypassing `CX_HOME_OVERRIDE` on the XDG axis) is architecturally identified though no single smoking-gun test file was found." The audit's own oracle-miss-report (row 42) independently flags this as the cheapest, highest-value fix in its findings, since the guard mechanism already exists and needs only wider coverage. **I could not independently verify the historical contamination incident itself** beyond this audit document — no corroborating commit, CHANGELOG entry, or standalone note names a specific date, PR, or cleanup for `~/.local/state/construct/approvals/queue.jsonl`; the audit itself says no smoking-gun test file was found. That specific historical claim is `[unverified]` by me; the *mechanism* that would make such contamination possible is independently confirmed by reading `doctorRoot()`.

A grep of every production `doctorRoot()` caller (`lib/**/*.mjs`, excluding tests) surfaces the real-state-file classes actually at risk:

| Class | Representative files/paths | Representative call sites |
|---|---|---|
| Audit trail | `audit-trail.jsonl` | `lib/audit-trail.mjs`, `lib/hooks/audit-trail.mjs` — already fingerprinted |
| Approval queues | `approvals/queue.jsonl`, `approval-pending.jsonl`, `role-pending.jsonl`, `destructive-approvals.json` | `lib/embed/approval-queue.mjs:271`, `lib/roles/approval-surface.mjs:19`, `lib/doctor/watchers/bd-watch.mjs:29`, `lib/mcp/destructive-approval.mjs:20` |
| Oracle state | `doctor-log.jsonl`, `runtime/oracle/*` | `lib/oracle/read-model.mjs:146,223`, `lib/oracle/index.mjs:21`, `lib/oracle/cli.mjs:29`, `lib/oracle/execute.mjs:23,45` |
| Embed-daemon runtime state | `sync.lock`, `runtime/embed-daemon.json`, `runtime/embed-daemon.log`, `runtime/<svc>.log`, `intake/*`, `cache/embeddings` | `lib/embed/daemon.mjs:133-134,669`, `lib/embed/supervision.mjs:243`, `lib/embed/inbox.mjs:55,59,66`, `lib/embed/intake-metrics.mjs:130`, `lib/embed/semantic.mjs:27` |
| Doctor watcher state | `events.jsonl`, `cost-watcher-state.json`, `bd-watch-seen.json` | `lib/doctor/report.mjs:70-71`, `lib/doctor/watchers/cost.mjs:29-30,37`, `lib/doctor/watchers/bd-watch.mjs:28,32` |
| Telemetry logs | `intent-verifications.jsonl`, `rule-calls.jsonl`, `skill-outcomes.jsonl`, `skill-calls.jsonl`, `skill-outcomes-summary.json`, `pricing-cache.json` | `lib/telemetry/*.mjs` |
| Cost/model tracking | `session-cost.jsonl`, `model-pricing.json`, models cache/overrides | `lib/cost.mjs:86,101`, `lib/cost-ledger.mjs:30`, `lib/model-pricing.mjs:23`, `lib/models/catalog.mjs:43`, `lib/models/provider-poll.mjs:44`, `lib/models/execution-capability-profile.mjs:85` |
| Hook runtime scratch state | `warn-flags.txt`, `files-changed-count.txt`, `pending-typecheck.txt`, `ts-result.txt`, `provider-cooldowns.json`, `doc-coupling.json`, `context-recovery.json`, `file-hashes.json`, `last-agent.json`, `ci-status-cache.json`, `readme-age-state.json`, `bootstrap-state.json`, `bash-logs/`, `.cx/context.{md,json}` | `lib/hooks/*.mjs` (widest class by file count) |
| Session/status reporting | `session-efficiency.json`, `session-telemetry.json` | `lib/status.mjs:58,108`, `lib/efficiency.mjs:16` |
| Performance reviews | `performance-reviews/*` | `lib/hooks/session-optimize.mjs:30`, `lib/performance/generate.mjs:31-32`, `lib/mcp/tools/project.mjs:69` |
| Sandboxes | `sandboxes/*` | `lib/sandbox.mjs:27` |
| Contract violations | violation log | `lib/contracts/violation-log.mjs:34` |
| Orchestration readiness | `orchestration-readiness.jsonl` | `lib/orchestration/readiness.mjs:310` |
| Scheduler logs | `scheduler/logs/*` | `lib/scheduler/solo.mjs:87,89,125-126` |
| Setup/misc one-off logs | `setup-*.log`, `distill-prompt.txt` | `lib/setup.mjs:656`, `lib/distill.mjs:351` |

This is the accurate class list for the Decision below, built by reading the grep output rather than the bead's (correct but partial) two named examples.

## Decision

1. **Extend `sterile-host-env.mjs`'s fingerprint to cover every real-state-file class in the table above**, generalizing `countAuditTrailTestLeaks`'s existing pattern (count `"source":"test"`-tagged JSONL records for append-only logs; content/entry-set hashing for the rest, matching the volatility-aware approach already used for `~/.claude.json` and `ollama list`) rather than inventing a new mechanism per class.
2. **Do not require every `doctorRoot()` call site to pass an explicit override.** That would be structurally sounder (bypass becomes impossible rather than detected after the fact) but is out of scope here: it touches on the order of 90 production call sites, several of which bind the result once at module load time and would need an import-order audit alongside the signature change. It is deferred as a candidate hardening step, not rejected outright — see Rejected alternatives.
3. **`construct-4uxq0.14.1` (P0, blocked on this ADR) implements the extension**: widen the fingerprint/guard to the full class list, re-run the full suite with `HOME`/XDG pinned, and confirm zero real-root mtime changes.

## Rationale

The guard mechanism `sterile-host-env.mjs` already ships (fingerprint-before, fingerprint-after, fail loud on drift) is class-agnostic — it does not care what kind of file it is fingerprinting, only that a stable "unchanged" signal exists per class (already solved for volatile logs via the test-tagged-record count, and for volatile system files via the MCP-surface/model-set trims). Extending it to the classes discovered by the grep is additive and low-risk: it changes test-only code, adds no new production surface, and directly matches the failure mode that produced the (audit-claimed) approvals-queue contamination — a class of file the guard was never asked to watch, not a flaw in the watching mechanism itself. Requiring explicit `doctorRoot()` overrides everywhere would close the hole at its root (bypass becomes impossible, not just detected) but is a materially larger and riskier change for a P0 that the audit explicitly wants closed cheaply; the module-load-time binding at several call sites means that refactor cannot be a mechanical find-and-replace.

## Rejected alternatives

- **Status quo (audit-trail-only fingerprint).** Rejected: this is the defect being fixed. It already let one real-state-file class (approvals queue, per the audit's claim) go unguarded, and the class table above shows at least a dozen more are in the same blind spot today.
- **Require every `doctorRoot()` call site to pass an explicit override (structural bypass-proofing).** Rejected for this ADR, not rejected permanently: correct in principle — a call site that cannot omit the override cannot leak — but touches ~90 production files across hooks, telemetry, Oracle, embed, and doctor watchers, several of which resolve the path once at module load time and would need care to avoid breaking real (non-test) default behavior. Revisit alongside the state-root consolidation work the audit already flagged as a separate, lower-reversibility decision (ADR-K in the audit's numbering) rather than folding it into this P0.
- **Unify `doctorRoot()` onto the `CX_HOME_OVERRIDE` axis `lib/state-root.mjs`/`lib/paths.mjs` already use.** Rejected for this ADR: would merge two home-resolution axes (`~/.construct/` via `CX_HOME_OVERRIDE`, and `~/.local/state/construct/` via `CONSTRUCT_DOCTOR_ROOT`/`XDG_STATE_HOME`) that the codebase currently treats as independent by design (the `xdg.mjs` header notes the XDG axis is a deliberate clean break from the legacy `~/.cx` path). That is a larger architectural move than a test-isolation fix warrants, and the audit's own target architecture flags the broader state-root question as a separate, low-reversibility decision.

## Consequences

- Positive: closes the P0 gap the 2026-07 audit's oracle-miss-report calls the cheapest, highest-value fix available (guard mechanism exists, only needs wider class coverage). Unblocks `construct-4uxq0.14.1` to do the actual extension and re-run the full suite with `HOME`/XDG pinned, confirming zero real-root mtime drift across every class in the table above — the AC that bead already specifies.
- Negative / cost: the fix is enumerative, not structural — a future `doctorRoot()` call site added without also being added to the fingerprint's class list is still an unguarded leak vector. Closing that residual gap (e.g., a lint/CI check tying new `doctorRoot()` call sites to the known-class list, or eventually the explicit-override refactor rejected above) is not scoped to this ADR.
- Follow-up: `construct-4uxq0.14.1` implements the extension and the full-suite hermetic re-run; a lint rule for "new `doctorRoot()` call site not covered by the fingerprint" is a reasonable next bead but is not filed by this ADR.

## Reversibility

High: this changes only test-helper code (`tests/helpers/sterile-host-env.mjs` and its class list), adds no new production surface, and changes no runtime behavior. Reverting means shrinking the fingerprint's class list back down — no data migration, no user-facing change.

## References

- `tests/helpers/sterile-host-env.mjs` (the guard being extended; read in full for this ADR)
- `tests/helpers/doctor-root.mjs:1-14` (the audit-trail-only fix this generalizes)
- `lib/config/xdg.mjs:55` (`doctorRoot()` — root-cause function, read and confirmed against the bead's claim)
- `lib/state-root.mjs`, `lib/paths.mjs` (the `CX_HOME_OVERRIDE` axis `doctorRoot()` does not participate in)
- `tests/helpers/sterile-env.mjs` (`sterileSpawnEnv()` — the sibling read-hermeticity helper, confirms `CX_HOME_OVERRIDE` as the established test-isolation convention)
- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md`, row 42
- `docs/notes/research/2026-07-continuous-work-audit/oracle-miss-report.md`, row 42 and invariant-registry seed item 2
- `docs/notes/research/2026-07-continuous-work-audit/FINAL-REPORT.md` §5 (P0 gap/risk register), §10 (decision log, ADR-I)
- `construct-4uxq0.14.1` (blocked P0 implementation bead)
