# Command remediation verification

Historical local-verification record for candidate `8af839c1`. It is preserved as
the input to the subsequent failed native review, not a current readiness verdict.
The native reviewer found an uncovered provenance defect and missing explicit
reason-relation collision coverage, qualifying the coverage claim below. Later
corrections and current observations are in [remaining validation](REMAINING-VALIDATION.md)
and [the subagent review](SUBAGENT-REVIEW.md). The old "pending input recovery"
status below was superseded by a corrected retry and failed native generation;
that generation remains unaccepted.

Status: implemented and locally verified in `codex/source-activation-cli`,
2026-10-14. Adversarial verdict: accepted with controls for the thirteen demonstrated
command-audit defects. Five agents implemented disjoint slices; two then reviewed
other agents' changes without editing them. No release, merge or real host
configuration was performed. The original other-device incident/version remains
unknown; these fixes close reproduced mechanisms.

## Finding closure and dependency anchors

| Finding | Root correction | Regression and dependency evidence |
|---|---|---|
| F1 Concurrent additions | Read current declarations inside the same write transaction as reconciliation and file replacement | [source handler](../../../src/cli/source.ts#L160), [init](../../../src/cli/init.ts); [source lifecycle](../../../tests/cli/source-lifecycle.test.ts): add/add and init/add controlled schedules |
| F2 Missing holder inspector | Distinguish inspected-empty from unavailable/invalid inspection; reset and migration refuse without explicit force | [holders](../../../src/cli/holders.ts), [reset](../../../src/cli/reset.ts#L65), [migrate](../../../src/cli/migrate.ts#L105); [state safety](../../../tests/cli/state-safety.test.ts), [migration](../../../tests/cli/migrate.test.ts) |
| F3 Read-only creation | Use shared read-only opener, retaining missing-state and project identity checks | [skill impact](../../../src/cli/skill.ts#L74), state-safety byte/identity controls |
| F4 Completion bypass | Shared terminal transition requires admission, finished blockers, current premises and unblocked state | [completion](../../../src/kernel/work/service.ts#L999); [completion/restore](../../../tests/kernel/work/completion-restore.test.ts), [actual launcher](../../../tests/kernel/work/cli-recovery.test.ts); CLI, broker and managed-delivery callers retain separate ownership/delivery gates |
| F5 Parent restore order | Insert identities before relationships, atomically validate cycles/collisions, restore sanitized history and bounded reason graph | [restore](../../../src/kernel/work/service.ts#L1091), completion/restore tests; dependencies, successors, serves lineage and skipped live items covered |
| F6 Multiple retired declarations | Remove selected stranded entry independently; preserve retired identity, report remaining retired declarations or unrelated reconciliation failure | [retirement](../../../src/cli/source.ts#L210), source lifecycle tests |
| F7 Kind mismatch | Reject kind changes for every existing declared identity before mutation | [declaration](../../../src/kernel/source/service.ts#L172), [service tests](../../../tests/kernel/source/service.test.ts); failed batch rolls back |
| F8 Duplicate claims | Compare latest persisted item evidence and trust metadata; preserve changed revisions, unchanged neighbours and first witnessed reads | [recordRead](../../../src/kernel/source/service.ts#L223), source service tests; read-access observations continue |
| F9 JSON validation error | Collect invalid user/project files before eager binding/config resolution | [config](../../../src/cli/config.ts#L52), [validation tests](../../../tests/cli/config-validation.test.ts) |
| F10 Ignored operands | Enforce maximum arity from existing registry before dispatch | [parser](../../../src/cli/commands.ts#L140), [argument tests](../../../tests/cli/argument-contracts.test.ts); entire registry, optional hook operand and help covered |
| F11 Stale bootstrap connection | Supported catalog stays fixed; recognized calls retry safe binding after repair | [lazy handler](../../../src/hosts/mcp/server.ts#L423), [serve](../../../src/cli/serve.ts#L112), [stdio lifecycle](../../../tests/cli/serve-lifecycle.test.ts); init/migrate/malformed/foreign/newer fixture repair and all six supported host adapters |
| F12 Overbroad healthy headline | Doctor states installation scope and marks live connection/execution unverified in human and JSON output | [doctor](../../../src/cli/doctor.ts#L307), stdio lifecycle and [packaged smoke](../../../scripts/smoke-packaged-install.sh) |
| F13 Shrinking discovery | Incompatible binding reports a tool error without catalog mutation; unknown tools do not bind | Lazy handler, [MCP tests](../../../tests/hosts/mcp/server.test.ts), [serve concurrency](../../../tests/concurrency/serve-binding.test.ts): stable discovery, refused writes, unchanged schema/meta/work |

The existing SQLite transaction/savepoint, file replacement, parser registry,
project locator, graph endpoint validation and state opener were reused where
sound. Rejected patterns were stale reads before locking, inspection failure
represented as empty state, creating opens for inspection, insertion order standing
in for relationship order, and discovery changing with transient disk readiness.
No dependency, schema migration, second runtime or duplicate binder was added.

The shared source-entity lookup/insert now runs transactionally for all callers,
including source relations. Refresh performs reader I/O outside the lock, then
rechecks active/read permission before recording access/snapshot/claims in one
transaction. The asynchronous retire/revoke regression proves late data cannot be
admitted. Snapshot export adds an optional compatible graph field containing work
identities and their reason entities/relations; it imports no sources, claims,
grants, sessions or live leases. Legacy graphless serves snapshots report missing
reason links rather than fabricating them.

## Adversarial challenge

Steelman: the single state store, identity guards, fenced claims and host-owned
execution remain useful controls; changing their public behavior requires checking
shared callers rather than patching a single command's output.

1. Strongest failure: serialized source writes still span file rename and SQLite
   commit. Actual SIGKILL probes for add and retire show `init` repairs either
   observed crash direction. Cross-resource ACID is not asserted.
2. Best alternative: a second setup subsystem, full-state export or duplicate
   runtime would widen trust and compatibility scope. Extend the existing
   reconciliation, bounded work snapshot and lazy binding instead; preserve
   identity checks, provenance and explicit force.
3. Claims audit: the original scenarios were replayed through the actual launcher;
   recovery used real stdio. The full package install loop passed. Static host
   conformance is separately labeled and does not prove native GUI readiness.
4. Inversion: held locks, missing inspector, stale file snapshot, child-before-
   parent, incompatible state, changed project ID/root, late permission revocation
   and malformed operands were exercised. Peer review caught first-witnessed-claim
   suppression and two dependency merge defects; corrections have regressions.
5. Cost: a source configurator, a person relying on recovery and other connected
   sessions bear wrong-state effects. Safeguards refuse uncertain destructive
   operations; no unmeasured production frequency, latency or cost is stated.
6. Hostile expert: test relation identity collisions, skipped live rows and
   evidence whose bytes are unchanged but trust/provenance differ. The final
   regressions cover those cases; native model contribution is outside this pass.

Source negative control used isolated unchanged HEAD with current regressions and
failed eight relevant tests (19 passed). State-safety regressions failed three
before the correction; CLI contracts failed three with a valid control passing;
ledger's unchanged code failed admission and parent-restore cases. Lifecycle's
before-fix stdio probe observed the original bootstrap trap. These are agent-
observed controls and reviewed local records, not independent native reviewer
receipts. They establish the original mechanisms; later crash/trust/merge controls
were added on the corrected code and are not mislabeled pre-fix executions.

## Verification

Check: complete required project gate.
Command: `npm run lint && npm run typecheck && npm test && npm run smoke`
Result: pass.
Observed: 1,125 tests passed, zero failed, one skipped; packaged install smoke passed.
The skipped test is the live-release-record validation: no live record has been
made yet, and it remains excluded from the pass count. Earlier attempts caught an outdated concurrency assertion, a test type
correction during integration, and smoke's old healthy headline assertion. Those
attempts are failures, not passes; final output is summarized in [VALIDATION.json](VALIDATION.json).

Check: static supported-host conformance.
Command: `npm run conformance -- --out=/private/tmp/construct-remediation-conformance.json`
Result: pass.
Observed: 97 passed, zero failed, 19 untested native boundaries.

Check: original audit inputs with corrected expectations.
Command: `node docs/internal/command-remediation/verify-surfaces.mjs`
Result: pass.
Observed: ten original CLI scenarios plus sequential control passed; [SURFACES.jsonl](SURFACES.jsonl) retains actual outputs.
[verify-surfaces.mjs](verify-surfaces.mjs) reuses the existing sterile harness and
shared observer; destructive operations touch only scratch fixtures.

Outcome: acknowledged source additions persist, retired declarations recover,
inspection and ledger recovery respect state contracts, and disk repair yields
usable same-connection tools with truthful installation diagnostics.
Surface: actual CLI launcher, real stdin/stdout protocol and packaged installation.
Data: sterile project/HOME fixtures with declared directories, live DB holders,
work relationships, malformed files, format/identity refusals and host-specific wiring.
Observed: concurrency retains both active sources, unchanged reads keep claim counts,
invalid completion/refused reset preserve state, hierarchy restore succeeds, and
all supported stdio adapters recover without catalog change.
Verdict: proven for these local and packaged paths; native desktop/model execution
not proven.

## Limits and handoff

OS holder inspection is observational and cannot fence a later process open.
File/DB durability is separate and requires the tested reconciliation recovery.
Old graphless exports cannot contain lost reason lineage; relink reported omissions.
A missing reason-provenance source refuses restore atomically, rather than inventing it.
Manifest provenance remains conservative for a same-digest reported-to-witnessed
transition; first witnessed claims are now admitted, historical snapshots are not
silently reclassified. Desktop GUI and live model/connector readiness remain untested.

The managed broker binds the main checkout, so it does not certify the separate
worktree artifact identity. Its observed verification adapter ran the actual
worktree surface script successfully, with no artifact subjects. The final managed
submission then rejected an execution reference used as a general evidence citation;
that workflow remains pending input recovery. This is a session input failure,
not a passing independent semantic review. Local full-gate and peer-review evidence
remain valid; the existing independent-review follow-up retains this limit.

No changes were published or merged. Use the working branch for review. Next local
verification command: `npm run lint && npm run typecheck && npm test && npm run smoke`.
The earlier command-audit directory remains local historical evidence; its static
matrices are not refreshed or represented as current runtime coverage.

Verification record
- Project inspected: answered, see Finding closure ("CLI, broker and managed-delivery callers").
- Reuse checked: answered, see dependency discussion ("existing SQLite transaction/savepoint").
- Validation path run: answered, see Verification ("complete required project gate").
- Outcome observed: answered, see Outcome ("actual CLI launcher, real stdin/stdout protocol").
- Surface inspected: answered, actual human/JSON diagnostics and packaged output inspected; native desktop not proven.
- Diff reviewed: answered, complete staged product/test/doc slices reviewed before local commits.
- Residual risk: listed under Limits and handoff, with explicit recovery or missing native observation.
- root-cause-debugging: reproduced mechanisms and pre-fix controls retained; original device diagnosis unknown.
- adversarial-review: all six challenged; independent peer findings corrected; accepted with stated controls.
- commit-and-pr: coherent reviewed local slices, no real secrets or attribution trailers; no PR, push, merge or release.
