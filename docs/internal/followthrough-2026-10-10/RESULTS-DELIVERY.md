# Abandoned preparation recovery — 2026-10-10

Candidate C fixes a demonstrated cross-session delivery reservation defect and reduces redundant step guidance. Deterministic and installed-process checks pass. Native consumer results are recorded below, separately from state-machine correctness. This is an unreleased local candidate; the published alpha.27 and previous failed cohorts remain unchanged.

Branch: `dev/fresh-delivery-reliability`. Code commit: `202f1ffe6fc1dc488c7abe581ed9d48b08aa197a`. Package SHA-256: `db4a67bded812638a476f3196c38a4e63587e9267978be7b17cedee955b0a14b`. Earlier local changes are `5283f0d4` (review progress), `393c6e47` (arithmetic), and `154a7886` (retained evidence). [Prior results](RESULTS.md) and [preregistered plan](DELIVERY-PREPARATION.md) remain part of this record.

## What the old traces establish

The previous Codex initial phase created its run after 102,118 ms and claimed gather after 107,297 ms, but made no `submit_work` call within 360,009 ms. Source registration/reporting, a rejected access observation, connected reads, and method-resource reads consumed the visible path. The changed phase created a new run after 46,140 ms, hit the old reservation, then reclaimed the old gather after 81,335 ms. It still submitted no step within 360,007 ms. These public traces establish no handback and concrete orchestration friction; they do not isolate a causal share of model latency or reveal private reasoning. See [timeline](evidence/delivery/baseline-timeline.json).

The old session ended at 01:53:40.604 UTC, before the changed run was created at 01:54:26.840 UTC. `claim_work(newRun)` recovered only that new run's steps, and delivery takeover considered only its own `work-${runId}-delivery`; path overlap still treated the prior unexpired reservation as occupied. The old owner's confirmed exit therefore did not release the newer request. This is a state-machine defect, not an approval or source-access problem.

The old gather packet also combined the whole bound method, later synthesis/challenge obligations, and final-review instructions. The kernel's date wording explicitly suggested end-of-day knowledge. Candidate C changes these instructions; whether they improve native delivery is an empirical question.

## Implemented boundary

| Contract | Implementation and exercised evidence | Remaining limit |
| --- | --- | --- |
| Newer request replaces abandoned preparation | [Managed delivery](../../../src/kernel/broker/managed-delivery.ts): same exact file, checkout and frozen workflow; newer kernel creation order; manual interactive executor; kernel admission and run association; one exact path lease. | No generic takeover, cross-workflow replacement, scheduled-run replacement, or arbitrary file reconciliation. |
| Protect actual holders | Recorded session ended or adapter-observed local process absent is required for reservation and each outstanding step holder; owner/attempt binding must match. Quiet/current/unknown/unregistered holders refuse recovery. | An ended Construct connection is not proof that every host child stopped. Host sandbox and process evidence remain adapter responsibilities. |
| Preserve possible effects | Refuse historical writing/action-capable attempts, execution/delegation/action records, child work, explicit handoffs, terminal runs and existing/unreadable artifacts. | Absence of recorded effects is not proof of no unreported effect. Existing drafts and terminal runs need explicit settlement; generic recovery wording is less specific than it could be. |
| Atomic cancellation and fencing | Recover/expire old steps, cancel old run and work, release old reservation and acquire the new one inside the claim transaction. Refusal rolls back the new lease; `delivery.preparation_superseded` preserves lineage. | Automatic safe semantic rework remains open; completed actions must not be replayed. |
| Actionable refusal | [Broker](../../../src/kernel/broker/tools/claim-work.ts) returns `waitingOn.kind=delivery_recovery`, prior/requested runs, work/path/holder, reasons and checkpoint. Ordinary manual conflicts retain their old contract. | Recovery instructions do not grant authority or change permissions. |
| Current-step handback | [Workflow service](../../../src/kernel/workflow/service.ts) scopes the bound method to current outputs/tier, defers later obligations, and states an evidence/uncertainty stopping boundary. Final-review instructions stay on the final step. | Complete skill text is still in the packet. Wording alone is not a bounded executor or proof that a producer will submit. |
| Temporal provenance | Requested cutoff is distinct from actual observation and provider update time. | Other normalization wording and producer-generated provenance still require consistency checks; a date label cannot establish freshness. |

No permission tier, validator, final review predicate, source authority or deadline was relaxed.

## Checks and independent review

- Required gate: lint and types passed; **1,063 passed, 0 failed, 1 existing skip (1,064 total)**; installed-package smoke passed.
- All-host static conformance: **85 passed, 0 failed, 19 untested**. Untested native behavior remains unqualified.
- Focused delivery/typed-input suite: **41 passed**, independently repeated. Coverage includes ended/dead/current/quiet/unknown holders, another current step owner, historical write capability, handoffs, artifacts, recorded execution, directory/workflow/checkout boundaries, request ordering, atomic refusal, competing callers, stale tokens and expired step leases.
- Independent adversarial review found a case where an already-expired step remained leased while its delivery reservation was live. Unconditional old-step expiry before cancellation fixes it; regression and independent recheck pass. Additional sterile probes covered scheduled origin, stale owner/attempt bindings, rollback and distinct worktrees.
- Actual installed MCP processes were tested with graceful **SIGTERM** and forced **SIGKILL**. A live owner first refused replacement; after confirmed process close, the same new run acquired the path, old run/work were cancelled, old token was refused and no artifact was created. [Replay result](evidence/delivery/process-replay.json).
- Independent evidence check matched all **502 regular archive files** to both installed process-replay copies, including the reviewed modules, and cross-checked transcripts, SQLite state and saved gate logs.

These prove the narrow recovery contract. They do not establish native outcome completion, semantic correctness, host-wide process death or universal portability.

## Native consumer cohort

Exactly one Codex cohort used the frozen C tarball, sources connected before init, ordinary unchanged prompts, existing subscription, synthetic local policy + stdio MCP + scoped loopback API, and the original 360,000 ms bound for each phase. The changed phase preserves provider timestamp and source-file mtime while changing authoritative content and units. The prior A Codex/Cursor failures remain in their original record. No Cursor rerun or broader matrix was run here.

**Zero of two outcome phases completed; both saved no artifact.** Q&A remained correct and left zero managed state. Recovery now works in the ordinary changed-source path, and that phase eventually submitted gather, but the result is still not delivered.

| Phase | Elapsed ms | Completed MCP calls / submissions | Actual result |
| --- | ---: | --- | --- |
| Plain Q&A | 41,009; exit 0 | 2 / 0 | Correct exact-60 hold, with local policy reference; zero runs, steps, work, deliverables, registered sources or snapshots. |
| Initial outcome | 360,012; timeout | 34 / 0 | No file or deliverable; gather unfinished. Six sources and five snapshots held. A report omitted required access fields, was refused, and was corrected. |
| Corrected-source outcome | 360,008; timeout | 27 / 2 | No file or deliverable. New run recovered the ended prior preparation. First gather submission failed reference coverage; second passed. Synthesis was claimed just before timeout. |

The new run `run-837c4cb9` recovered the reservation of `run-e907965a` at **84,889 ms** into the changed phase. The original session had ended at 02:29:03.242 UTC. Its run and four steps were cancelled with preserved history, and the new run acquired the same artifact path. The prior generic conflict did not recur.

The first gather submission occurred at **309,847 ms** and correctly failed because the API origin in README lacked a reference disposition, despite the material endpoint being read. The producer reclaimed the step, accounted for that reference and passed gather at **352,265 ms**. Synthesis was claimed at **359,128 ms**, leaving less than one second of the original budget. This establishes progress and a remaining pre-artifact bottleneck; it does not establish reliable completion or a causal estimate of the guidance change.

Other friction remained: the initial report omitted required principal/access fields; the changed phase tried to cite three `snap-*` IDs that the resolver cannot use, and the answer check refused them. Corrected source reports increased snapshots from five to eight while timestamps/mtime stayed fixed. No resulting decision brief exists to assess arithmetic, falsifiers or provenance correctness.

The one-pass assessment recorded both missing artifacts as failures with frozen packet/rubric digests. **No model reviewer was invoked**, and no successful semantic judgment or final handback is claimed. The raw grader's generic limitation text does not override those explicit missing-artifact records. [Native summary and timeline](evidence/delivery/native-summary.json), [assessment](evidence/delivery/native-assessment.json).


## Next implementation-ready work

Reuse the existing work items and preserve their original acceptance; these are next bounded requirements, not claims of completion.

| Priority / existing item | Concrete change and acceptance |
| --- | --- |
| P0 delivery / `work-bc13f708`, `work-d45349d5` | Replace unbounded pre-artifact orchestration with an explicit step budget and checkpoint/handback protocol. Measure time to first source, claim, submission and artifact. On the same ordinary prompt, a permitted draft must be saved within the original bound, with unknown conversion and denied source represented honestly; no validator/tier bypass and no extended deadline. Test a producer that keeps researching after sufficient evidence, source-report repair, and interruption before/after a writing attempt. A stage timeout must preserve held observations and identify exactly what can resume. |
| P0 source admission / `work-c0b5e1bd`, `work-bc13f708` | Expose a complete machine-readable schema for the report action and its access observation, including required principal/scope/operation/mode/transport/expiry and nested item shapes. Prefer adapter-produced receipts over model transcription. Acceptance: first valid ordinary MCP/API read can be admitted without schema-discovery retries; missing/expired/untrusted fields refuse with precise field paths; a model cannot invent an authenticated identity or raise reported access to observed authority. Preserve denial and partial coverage rather than fabricating source completeness. |
| P1 step composition / `work-2260468a`, `work-98b4069f` | Resolve the remaining contract tension between whole-skill mandatory stages and current-step obligations. Define typed current-stage requirements, carried evidence and deferred work once. Acceptance: gather submits support/unknowns without prematurely doing final closure; synthesis and independent challenge still occur in their authorized stages; methods materially affect a held artifact and are not credited merely from receipts. Compare against the preserved failures using a new preregistered finite cohort only after an implementation change. |
| P1 provenance / `work-5ab0581a`, `work-a8273a89` | Align every intake/period projection with requested cutoff versus observation/provider times. `workflow/intake.ts` still uses “how things stood at its end”; do not imply that the new step guidance removed all such wording. Expose usable generation-specific historical item citations alongside snapshot identities; a returned snapshot ID currently fails citation resolution. Acceptance: a fresh process can cite the prior held item without rewriting it or accidentally citing today's replacement; current-day reads before day end cannot claim end-of-day knowledge; unchanged provider time with changed bytes invalidates affected claims; derived values retain calculation lineage and unrelated changes do not invalidate everything. |
| P1 recovery settlement / `work-bc13f708` | Give existing-artifact, historical-write, explicit-handoff, terminal-run and unknown-holder cases distinct actionable recovery paths. Acceptance: terminal run does not suggest an impossible claim; held draft is preserved, current owner remains protected, effects are reconciled before replanning, and an independent review failure can return to authorized producer work without replaying a completed action. Keep Candidate C's narrow automatic preparation replacement separate. |

Native completion, independent semantic correctness, review availability and truthful final handback remain separate release criteria. Static conformance and process recovery cannot substitute for them.

## Evidence and limits

The [manifest](evidence/delivery/manifest.json) identifies frozen package, harnesses, raw local evidence and hashes; copied repository evidence replaces machine-specific absolute roots with `TASK_WORKSPACE`, `CONSTRUCT_REPO` and `USER_HOME`. Raw logs remain unchanged in the task workspace. Review outputs are observations of fallible native models, not independent attestations of backend identity.

No push, merge, tag, deployment, publication, production source/job, credential change or local-memory edit occurred. Repository-local `commit.gpgsign=false` was verified; global signing remains `true`. The broader [intake](../intake-2026-10-09/README.md), V1–V9 validation, source traversal/adapters, genuine skill composition, semantic repair and full unattended-execution matrix remain open. A standing request without a real clock and executor still cannot run after the session exits.
