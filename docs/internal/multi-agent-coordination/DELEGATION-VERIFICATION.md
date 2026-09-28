# Bounded delegation: guarded implementation verification

Implementation checkpoint recorded September 27, 2026, before release work.

**Status: implementation and synthetic gates pass; live three-tool release is
not verified.** All real executors remain disabled. At this checkpoint, no live
model work, credential changes, commits, pushes, or publication were performed.

## Scope and reuse

Work extends `feat/multi-agent-coordination` in its existing worktree, rather
than recreating coordination on the older `staging` checkout. The foundation
inspected was commit `1fe8626c`.

Project instructions, broker registration, host lifecycle, native work,
claims, path leases, sessions, review storage, redaction, validation scripts,
and their tests were inspected. The change adds the interactive `delegate`
contract and versioned `delegation.state.v1` payloads in existing work events.
It affects host process lifecycle, personal executor configuration, isolated
Git snapshots, local integration, and the operational skill. There is no new
package dependency, task database, or schema migration.

Reuse search covered this repository, the coordination worktree, sibling
`ai-workflow-config` and `agx-research` tooling, and installed tools and skills.
Existing probes did not supply bounded supervision. Native work, sessions,
fenced claims, path reservations, workflow associations, reviews, activity,
and the shared secret signatures are reused. Vendor command construction and
processes stay at the host boundary; the kernel consumes a driver interface.

The outer project's native ledger still uses format 3. Its compatible native
broker was bootstrapped once; the existing work entry's stale plan reference
was corrected to `docs/internal/multi-agent-coordination/PLAN.md` through the
native work API. No store migration or fabricated claim/acceptance was used.
Construct MCP was not exposed to the implementation session.

## Validation path

All commands below ran in the coordination worktree, not the outer checkout.
The final source includes isolated validator HOME/XDG/TMPDIR, rejection of
unexpected MCP initialization in structured output, and exclusion of `.agents`
from worker snapshots.

| Check | Command | Observed result |
| --- | --- | --- |
| Focused regression gate | `npm run typecheck && node --test tests/hosts/delegation/*.test.ts tests/kernel/broker/delegate.test.ts tests/kernel/delegation/service.test.ts tests/concurrency/delegation.test.ts tests/kernel/render/redact.test.ts` | Passed; 37 tests, zero failures. |
| Current runtime gate | `npm run lint && npm run typecheck && npm test && npm run smoke` on Node 25.9.0 | Passed; 486 tests, zero failures; packaged smoke passed. |
| Supported minimum gate | `npm run lint && npm run typecheck && npm test && npm run smoke` on Node 22.18.0 | Passed; 486 tests, zero failures; packaged smoke passed. |
| Final whitespace check | `git diff --check` | Passed. |

Full gates required an approved run outside the filesystem sandbox because
the existing concurrency harness uses `/bin/ps`. Minimum-version validation
used the exact Node binary on PATH, not an `npm exec --call` wrapper: the
earlier wrapper leaked npm execution settings into nested packaged smoke.
The final invocation passed without changing project code for that issue.

The captured gate logs are named `construct-current-gate-final.log`,
`construct-minimum-gate-final.log`, and `construct-delegation-focused.log`
in the session's temporary storage. They are local evidence, not committed
artifacts. `npm run lint` and `git diff --check` also passed after this record
was added.

## Observed surface and limits of proof

The real Construct MCP subprocess was exercised with synthetic repositories,
isolated fixture HOME directories, and fake vendor executables. Each of the
Claude, Codex, and Cursor lead profiles launched both other fixture executors,
polled status, read results, reviewed fixed snapshots, triaged findings, and
integrated two disjoint changes serially. The tests observed the final file
contents and an unchanged commit count. This covers all six directions for
implementation and review at the Construct protocol boundary, not live vendor
interoperability.

The packaged smoke also queried `delegate` and observed three unconfigured,
unverified executors. Headless surfaces omit delegation, project-write denial
does not widen permissions, and malformed personal configuration fails closed
without preventing ordinary broker use.

Focused tests exercise duplicate dispatch, expired/lost claims, conflicting
paths, semantic coupling, concurrency and repair limits, required review
dispositions, combined-validation failure, restart reconciliation, cancellation,
timeouts, malformed output, denied permissions, quota/error output, watchdog
disconnect, and descendant termination. Workspace tests exercise dirty and
untracked user work, worker-only patches, stale targets, fixed reviews,
repairs against the original baseline, prohibited files, symlinks,
out-of-scope proposals, and serial integration. These are fixture assertions;
they do not prove a vendor honors its advertised permission controls.

Only local CLI help and metadata probes were performed against installed
vendors. The Claude authentication probe failed in the sanitized environment;
that is not proof the user's ordinary session is logged out. Codex's status
command completed, but the metadata inspection did not establish its auth
method. Cursor reported authenticated-token metadata; this does not establish
subscription-only billing or denied-action behavior. No credential values
were inspected or copied into fixtures.

## Decision challenge

VERDICT: Needs validation.

This is a self-review, not an independent security audit. The strongest case
for the design is that it reuses Construct's coordination authority and the
installed runtimes, while default-off configuration and bounded attempts limit
unverified exposure. Read-only workers return proposals rather than receiving
unattended editing bypasses.

1. **Strongest failure mode [serious].** A CLI update or inherited setting
   enables an external tool, another agent, or paid usage despite a matching
   wrapper configuration. Operator-recorded receipts are attestations, not
   measured enforcement. Settle this with live denied-action and billing-mode
   probes for each binary/model/role before enabling it.
2. **Best alternative.** Manual coexistence avoids a new supervisor and remains
   available. The narrower Claude-to-Codex integration does not establish the
   requested symmetric ownership contract; importing another coordinator would
   duplicate work and acceptance ownership.
3. **Load-bearing claims.** Native-ledger integration, snapshot preservation,
   bounds, and synthetic supervision have executable evidence. Vendor auth,
   permission enforcement, real cross-host operation, and productivity gains
   do not. Passing fixture tests is not their substitute.
4. **Assumption inversion [serious].** If subscription identity permits paid
   overages, or read-only mode permits recursive tools, this wrapper alone
   cannot enforce the user's intended boundary. Keep the adapter disabled
   until Gerald authorizes and records tests that settle those behaviors.
5. **Who bears the cost.** Gerald bears subscription usage, interruptions,
   retained worktree storage, and adapter maintenance. No measured time or
   usage savings currently offset those costs.
6. **Hostile-expert objection [serious].** A worktree and isolated HOME are not
   an OS security boundary. Trusted validation commands execute project code;
   they need project-specific port/database/output isolation and authorization.
   Live permission tests and a separate security review are still required.

## Remaining release gates

- Exercise Claude to Codex/Cursor, Codex to Claude/Cursor, and Cursor to
  Claude/Codex with actual subscription sessions for implementation and review.
  Gerald must authorize the executors/models; record matching versions,
  denied-action results, and permission/authentication behavior before enabling
  an adapter. Do not manufacture a receipt from fixture data.
- Verify subscription-only operation, paid-overage behavior, inherited settings,
  absence of MCP/recursive launches, quota and permission failures, cancellation,
  timeout, and supervisor loss against installed versions. No automatic fallback
  is permitted. Windows process-tree execution remains blocked.
- Demonstrate the real one-terminal workflow, including two workers, cancellation,
  review, serial integration, and the actual project's combined validation.
  The synthetic MCP demonstration does not close this gate.
- Validate a project's dependency preparation and isolated test resources.
  The snapshot deliberately excludes ignored dependency directories; the
  configured gate must work in that snapshot without mutating the reviewed
  artifact. HOME isolation alone does not constrain project-code execution.
- Compare time to accepted change, interventions, repair rounds, integration
  failures, and available usage against a single-agent baseline. Missing usage
  remains unknown, not zero. No efficiency claim is supported yet.

The final diff was checked against the requested contract, including the
default-off posture, child identity, authority isolation, retries, bounds,
review requirements, and retention of user changes. Generated references and
the operational skill reflect the new surface. Real vendor behavior and
project-specific validation remain the material unresolved risks.

Verification record
- Project inspected:   answered: see Scope and reuse ("broker registration, host lifecycle, native work")
- Reuse checked:       answered: see Scope and reuse ("Native work, sessions, fenced claims, path reservations")
- Validation path run: answered: see Validation path ("486 tests, zero failures; packaged smoke passed")
- Outcome observed:    not proven: actual subscription-backed cross-tool execution and real one-terminal UX; synthetic MCP outcomes are recorded under Observed surface and limits of proof
- Surface inspected:   answered: see Observed surface and limits of proof ("real Construct MCP subprocess was exercised"); live vendor surface not done: required permission/authentication evidence is absent
- Diff reviewed:       answered: see Remaining release gates ("final diff was checked against the requested contract")
- Residual risk:       listed at Remaining release gates, each with what would settle it
- Adversarial review:  Needs validation; self-review identifies vendor enforcement and operator-attestation dependence
