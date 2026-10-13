# Alpha effectiveness: engineering audit record

This is a working engineering record, not release qualification. The recommendation is to finish reliable source-to-artifact delivery before adding a retrieval service or expanding the host/model evaluation matrix. The local foundation works; the alpha is not fully baked.

The subsequent [portable implementation record](portable/IMPLEMENTATION.md) describes changes after this baseline audit and their qualification limits.

## Scope and continuity

The request is interpreted as: validate that a fresh installation can acquire relevant evidence, apply a suitable method, persist useful context and work, and deliver a correct result through the current host, without buying services or requiring an external tracker, vector database or second runtime. Fix reproduced local defects and distinguish tested mechanisms from model effectiveness.

Continued from the recent chats “Audit Construct outcome orchestration” and “Review Construct fix generality,” the existing native ledger, [delivery results](../followthrough-2026-10-10/RESULTS-DELIVERY.md), and [earlier results](../followthrough-2026-10-10/RESULTS.md). The starting checkout was clean at `f369a934`, on `dev/fresh-delivery-reliability`. Its package label is still alpha.27, but its local fixes are newer than the published release. Those are different candidates.

The latest saved native cohort produced no artifact in either requested-outcome phase. Recovery improved; managed completion remained zero of two. Earlier successful deterministic checks do not overturn that result. This session did not repeat those model trials or spend on another service.

## Findings

| Question | Observed mechanism | Assessment |
| --- | --- | --- |
| Does install/init stand it up? | `initialize.ts` creates project files and SQLite; `init.ts` proposes context from project files, locks the registry, installs the operational skill and writes selected host wiring. The packaged smoke runs the resulting launcher. | Yes for local state and protocol setup. Host trust, authentication and successful native execution remain distinct. |
| Does it create vectors? | No embedding, vector-store or FTS implementation was found in `src`, the manifest or README. `context-page.ts` uses literal matching with revision-bound pagination. The BM25 router exists in skill evaluation code; live `classify_request` takes the host's explicit reading. | No. An embedding service would not fix the demonstrated source-admission or delivery failures. Keep deterministic lookup; test paraphrase recall before choosing any additional index. |
| Does it help with context? | Persistent statements, entities, source observations, runs and activity are available through targeted queries. History tests cover older matches, continuation and reopening state. | Yes for recorded context. It is not automatic ingestion of all documents or chats. The live project reported no registered sources and registry skew at bootstrap; that is not evidence about a fresh install. |
| Does the worklog work? | Native SQLite work items have rationale, parent/dependency structure, claims, path reservations, handoffs and completion. The expanded packaged test claims and completes admitted work. | Yes. Unrooted ideas remain proposed; a work item is not proof that its outcome succeeded. |
| Are sources used by skills? | Workflow packets bind a skill and carry inputs; validators check references, passages, figures, source revisions and other declared obligations. `methods.ts` deliberately records application as reported, not independently proven. | The connection exists. Correct synthesis and actual method benefit remain unqualified by the saved native cohort. Numeric occurrence and citation validity do not establish semantic entailment. |
| Is the design host-neutral? | Kernel state and shared MCP contracts are separate from host wiring. Static conformance covers six hosts. | Broadly at the core. Native semantic review is currently pinned to one Codex executable/profile; other hosts can hold drafts but cannot complete that same review path. That is a material portability limit. |

Additional constraints observed in code: source reference traversal accounts for references already held; it is not a general API/MCP fetcher. Evidence resolution uses the current manifest, so snapshot identifiers returned in history are not automatically usable historical item citations. History paging scans and hashes matching rows; measure growing-history latency before selecting an index. Large workflow/broker modules increase change coupling, but an unrelated refactor would not improve the demonstrated user outcome.

## Implemented correction

Reproduction: the public `sources` schema exposed `observation` as an opaque object. Supplying a read observation without `expiresAt` raised `observation needs transport api/mcp/local and an explicit expiry instant`, with no field. The prior native traces show the same admission repair loop. The missing machine-readable contract is established; its share of total model latency is unknown.

Hypothesis: required nested fields are enforced but not discoverable from the schema. The disconfirming observation would be a complete `observation.properties` and `observation.required` in `tools/list`. Inspection showed neither. Restoring the original broker implementation makes the new regressions fail; restoring the correction makes them pass.

Changed the existing shared broker definition rather than creating another adapter or validator framework. It now exposes observation/request fields and report-item shapes; errors identify nested missing/invalid access fields and missing item references. Unknown principal/expiry can be omitted by omitting the optional observation, rather than invented. Valid reports without observations remain supported. Reporting a principal never produces witnessed authentication or a grant. The schema remains within the existing host-size budget; generated reference documentation follows the same definition.

The strongest failure mode is confusing a well-shaped report with authenticated source access. The alternative is more prompt prose without a typed contract. Decision: accept the schema correction with existing provenance checks and negative controls; reject treating it as proof of source authenticity or overall delivery reliability. Expiry syntax is checked at both the broker boundary and the existing source parser; keep those checks aligned when the source contract changes.

Reuse search covered existing broker definitions and input helpers, source access parsing, generated reference documentation, sterile fixtures, packaged smoke, installed skill instructions and the sibling `ai-workflow-config` repository. The existing tools and harness were sufficient. No dependency, schema migration, permission expansion or new runtime was added.

## Efficient validation method

1. Freeze a candidate by commit and package digest. Distinguish published bytes from the working candidate. Keep previous failures in the record.
2. Use the existing sterile regression suite for state, permissions, leases, provenance and negative controls. Use the packaged smoke for real installation and public CLI/MCP behavior. These require no model calls.
3. Maintain a small scenario set: plain question creates no managed state; a source-backed request produces an artifact; changed bytes with unchanged timestamps reject stale claims; restart restores context and work without replaying effects; denied access and unavailable review leave an honest useful result; source injection cannot change authority. Inspect the actual artifact and terminal state, not exit code alone.
4. After a relevant implementation change, run a bounded ordinary-prompt trial through an already available host. Register expected facts, unknowns, forbidden claims and a stopping time before execution. Track time to source, submission and artifact, tool calls, repair calls, artifact correctness and lifecycle separately. Reuse the existing consumer fixture and baseline. A changed prompt or fixture is a new cohort, not replacement evidence.
5. To test skill value, compare the same task/evidence with and without the method in separate fresh sessions when available. Judge the artifact against the frozen rubric. A method receipt or loaded skill is not evidence of benefit. Broaden host/model coverage only for a changed adapter or demonstrated failure class; report untested cells explicitly.

No repeated full live matrix is warranted for this schema correction. Conversely, deterministic replay cannot establish that an ordinary model now finishes faster. That next native observation remains necessary before claiming delivery improvement.

## Remaining critical path

- Bound evidence gathering and require an authorized partial artifact/checkpoint instead of consuming the whole session before writing. Preserve source denials and unknowns rather than bypassing validation.
- Separate delivery status from review assurance. A useful draft must be deliverable on any host; independent semantic review should be an explicit capability and assurance level. Do not rename an unreviewed draft as validated. Define and test this transition before changing the current completion predicate.
- Provide immutable, generation-specific historical item citations and adapter-produced read receipts where available; retain host-reported provenance elsewhere.
- Prove method contribution and correct reasoning on actual artifacts after the mechanical flow works. Keep the current native completion failures visible until a new bounded cohort establishes otherwise.

These reuse existing delivery, source-continuity and method-composition ledger work. This correction does not close their broader acceptance criteria. No release, push, publication, schedule or credential change was attempted.

## Verification record

Intended outcome: a host can discover the source report contract before its first submission, report actual evidence successfully, and repair malformed access metadata from a precise field error without acquiring authority.

Surface: packaged CLI and stdio MCP, using temporary projects and synthetic source passages. The smoke includes changed source content under an unchanged provider timestamp, rejection of stale quotations, retained generations, work claim/completion and an unverified draft that cannot be promoted.

Check commands and observed counts are recorded in `checks.json`. The initial sandbox test failure was `/bin/ps` denied; initial packaging was blocked writing npm's cache. Both are environment restrictions, not grounds to weaken the tests. Reruns used the necessary process/cache access. A schema-size regression in the first patch was corrected without increasing the budget.

- Project inspected: findings above distinguish “local state and protocol setup” from execution and effectiveness; public broker schema/error fields are the changed interface, with no stored shape change.
- Reuse checked: the correction uses “existing tools and harness”; searches are named above.
- Validation path run: see `checks.json` for the full project gate and static conformance; skipped and untested cases remain explicit.
- Outcome observed: “packaged CLI and stdio MCP” exercised the intended source-report behavior; no native latency or model-efficacy improvement claimed.
- Surface inspected: public tool schemas, responses and command output; no graphical UI changed.
- Diff reviewed: code, tests, smoke and generated reference reviewed for scope, compatibility and provenance; no new authority or services.
- Residual risk: native completion, historical citation support, generic connector capture and cross-host review remain open as described above.
- Root-cause debugging: schema omission reproduced; cause tested by inspecting `tools/list`; original implementation fails the new regressions; corrected implementation passes. Prior timing failures have multiple causes and are not attributed solely to this omission.

This source record follows the repository's internal engineering-note format. It is not a styled or exported report; no visual polish is claimed.
