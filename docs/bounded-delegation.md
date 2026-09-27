# Bounded local delegation

**Status: guarded implementation, not a verified three-tool release.** Claude,
Codex, and Cursor adapter paths exist and have synthetic subprocess tests.
No adapter is enabled by installation. Live permission, authentication, and
all-direction host interoperability evidence is required before use.

## Ownership and boundaries

The current host remains the lead. `delegate` creates a child of existing,
claimed native work and returns an execution id. A separate worker session
owns that child's claim and path reservations. No lead identity, approval
grant, or claim token enters the worker prompt. Workers receive a bounded
assignment and snapshot, not the conversation or a Construct MCP surface.
Headless Construct surfaces cannot call `delegate`.
The project's `policy.projectWrite: never` also disables delegation.

Attempts live in the existing project database as versioned native work events.
Workflow links, sessions, reservations, review evidence, and activity reuse
the existing tables. Native work remains the only task record.

Workers have read-only tools. An implementation returns a unified patch;
Construct checks its scope and file types before applying it to the isolated
worktree. Reviewers receive the implementation's fixed tree and cannot return
a write proposal. Direct worker edits are quarantined. This does not turn a
worktree into a security sandbox: inherited CLI behavior and actual read/write,
network, tool, and recursive-launch permissions still require live verification.

## Configure explicitly

Personal configuration is `delegation.json` in Construct's resolved user
configuration directory (the same `configDir` used by user defaults). There
is no project-config or environment opt-in. Defaults are two concurrent
workers, two repair cycles, and twenty minutes per attempt. Configuration can
set `maxWorkers`, `maxRepairCycles`, and `maxTimeoutMs` within the parser's bounds.

`executors` may contain `claude`, `codex`, and `cursor`. Each entry requires
an absolute `binary` path, an explicit `model`, an `enabled` boolean, and an
absolute `receipt` path. `validation` is an ordered array of command argument
arrays, never shell strings. Supply the project's actual gate. An empty gate
does not qualify a result for review or integration. These commands are trusted
operator configuration, not worker-selected instructions; they run locally.
Validators get a private HOME, XDG directories, and TMPDIR without worker
login locations. This prevents incidental writes to personal state, but is
not an OS sandbox. Configure only validation commands whose execution is
authorized, and provide isolated ports/databases when the project needs them.
Changing personal delegation configuration takes effect when its MCP server
restarts; receipts and CLI authentication are rechecked at each launch.

A receipt is **operator-recorded evidence**, not a vendor guarantee. It names
`executor`, `model`, `version` (matching the CLI's trimmed version output),
`binarySha256`, `checkedAt`, and `subscriptionOnly: true`. Each enabled role
under `roles.implement` or `roles.review` needs:

- `argsSha256`: hash of the adapter's argument array serialized as JSON,
  using the literal `<checkout>` placeholder for its working directory.
- `permissionBoundary`, `noMcp`, `noRecursiveLaunch`, `processTreeTermination`,
  and `readOnly`, all true only after those controls were exercised live.
- `record`: a reference to the observed test record, including host version,
  binary, model, subscription mode, denied-action probes, and actual outcomes.

Do not create a receipt by copying the synthetic fixtures. Matching receipts
are rechecked at launch, along with subscription authentication. Unrecognized
authentication output, API credentials/provider overrides in the environment,
binary or version drift, and missing evidence disable the adapter. There is
no paid or alternate-executor fallback. Authentication is handled by the
installed CLI and its existing local login; Construct does not read or copy
credential files. Child environments exclude API keys, tokens, lead identity,
and arbitrary runtime injection. Missing usage is recorded as unknown.

## Work sequence

1. Claim the parent native work without reserving paths that a child will own.
   Use `delegate` with `action: start`, `workId`, a stable `requestKey`,
   `executor`, `role: implement`, `instructions`, `acceptance`, and `paths`.
   Name shared interface/schema `couplingKeys` even for disjoint files. An
   optional `runId` links the child to an existing workflow run.
2. Poll `status` by id; use `result` for bounded evidence or `cancel` to stop.
   Reuse the same request key only for an identical transport retry. Retries
   cannot create another worker. A new lead cannot inherit an old identity.
3. The worker proposal is applied in isolation and the configured validation
   runs there. Failed checks or changed artifacts block review.
4. Start `role: review` with `subject` naming the successful implementation,
   the same parent and exact paths, and a different configured executor/model
   when available. Matching executor or model is disclosed as limited
   independence; agreement alone does not establish correctness.
5. Use `triage` on the review id with a disposition and rationale for every
   finding. Accepted findings require repair; deferred blocking findings
   still block. A repair names `repairOf` and inherits its cycle count and
   original integration baseline. Review the repaired snapshot again.
6. Use `integrate` on the reviewed implementation. Integration reacquires
   path reservations and applies patches serially. The configured gate runs
   on the combined checkout. A failure retains the edits as
   `integration_failed`; it does not silently roll back user work or accept it.

Integration is local only. It never creates commits, pushes a branch,
publishes anything, or moves a deliverable to accepted/final. The person-only
trust and sensitive-action boundaries remain in force.

## Snapshot and lifecycle behavior

Snapshots freeze HEAD, the allowed paths, in-scope dirty and untracked work,
and the relevant index state. They do not stash or reset the user's checkout.
The recorded baseline excludes the user's original changes from returned
patches. Out-of-scope dirty files remain untouched. Disjoint patches can be
integrated serially; changes to an assignment's target paths, index, or HEAD
require reconciliation. Combined-result validation is still mandatory.

Host-control files, common credential paths, symlinks, and submodules are not
admitted. Credential-shaped content, oversized snapshots, and explicit ignored
files cause refusal rather than silent inclusion. This is conservative screening,
not a universal secret detector; delegate only source that is appropriate for
the configured local subscription tool. Artifacts are retained under the
project state directory's `delegation` subdirectory with owner-only permissions.
No automatic worktree cleanup removes partial work.

A short-lived watchdog owns each process group. Timeout, cancellation, or
loss of the MCP supervisor's IPC connection terminates that group. A watchdog
exit triggers a second termination attempt from the parent. Windows process
tree controls are not implemented, so Windows execution is blocked.

Recovery never treats an expired lease as proof that a process died. Unknown
or live process identities stay `orphaned`, blocking new dispatch. A restart
can classify an attempt as blocked only after process absence is observed.
Interrupted integration remains quarantined because files may already have
changed. Inspect the recorded artifacts and reconcile processes and checkout
state before retrying; there is no automatic adoption, PID-based blind kill,
or approval transfer. Restored ledger history is evidence, not authorization
to resume an execution.

## Release boundary

Release evidence must cover Claude → Codex/Cursor, Codex → Claude/Cursor,
and Cursor → Claude/Codex for both implementation and review, with actual
subscription sessions in synthetic repositories. It must also cover denied
actions, recursive-launch prevention, missing auth, quota, cancellation,
supervisor loss, and combined-result failures. Fixture CLIs are not this evidence.

Compare representative delegated work with a single-agent baseline using
time to accepted change, human interventions, repair rounds, integration
failures, and available usage. No productivity gain is assumed. Do not enable
or advertise the three-tool release while any adapter remains unverified.
