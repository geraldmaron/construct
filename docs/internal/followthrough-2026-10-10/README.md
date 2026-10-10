# Fresh delivery and review recovery — 2026-10-10

This local follow-through starts at the published alpha.27 main revision `24b126021cc61b346d8b873eb40fa31635d2db15` on `dev/fresh-delivery-reliability`. It does not change that release, its evidence, npm tags, or existing user projects. Package version remains alpha.27 for this unreleased development candidate; only the local candidate hash identifies tested bytes.

Completed bounded work and retained failures: [RESULTS.md](RESULTS.md), [evidence manifest](evidence/manifest.json). The acceptance below was registered before the native cohort; the result record does not revise its denominator.

## Bounded slice

Make native semantic-review availability and recovery explicit at start, claim, submit, and status. Preserve the actual artifact, observed failures, permission tiers and completion predicate. An unavailable reviewer, failed invocation, rejected content, pending cancellation, expired lease and passing exact generation must lead to different truthful instructions. This is a prerequisite for reliable delivery, not a claim that the broader fresh-user experience is fixed.

Prior native evidence is retained under `docs/internal/implementation-2026-10-09/evidence/alpha27-release/`: Codex initial work timed out at 360018 ms before any artifact (gather succeeded; synthesize leased). Cursor saved a brief but attempted an unsupported Cursor review command twice and never completed its run; independent assessment also found reasoning errors. These failures are distinct. Unsupported review guidance alone does not explain the Codex latency or incorrect arithmetic.

## Contracts and corrections

- Kernel: read-only review projection and receipt integrity. Status reads never launch models, change leases, or promote trust. Exact artifact/source generation and native observation remain necessary for completion.
- Broker: expose the projection on interactive and headless work packets and public start/status responses. A bound profile is not evidence of current authentication or command permission.
- Host adapter: unchanged execution authority. Only the currently implemented pinned Codex profile can execute native review. No fallback to another host, security change, credential expansion or background runtime.
- Recovery: final-step inputs inherited from earlier steps are immutable. A verifier cannot change an earlier assessment through a final submission or write a file in an observe tier. Existing cancellation and held-output acknowledgment stop that attempt; a new scoped outcome can reuse the preserved draft and observations. Completed external effects must never be replayed just to repair an assessment. Automatic safe rework remains a requirement.
- Receipt failure: null invocation/problems, wrong attempt/host, incomplete judgment shape or containment errors are failures. Actual adapter receipts include derived negative judgment messages; those remain content rejections when invocation and shape are valid. Neither is a pass.
- Unsupported oversized drafts retain both the unavailable-reviewer and packet-size limitation.

## Acceptance registered before native trials

1. Deterministic regressions distinguish unavailable, not prepared, needs review, dispatched, rejected, review failed, stale, passed, cancelling and stopped. The draft remains unverified until the exact observed review passes.
2. A project-write → observe workflow proves inherited bad output cannot be overwritten. Cancellation acknowledgment preserves the draft and permits a distinct bounded replacement run; delivery reservation recovery is exercised independently.
3. Malformed, wrong-generation and producer-reported observations do not throw or acquire authority. Negative adapter-shaped receipts surface public findings; mixed invocation/containment failures do not invite content repair.
4. Required lint, types, tests and packaged smoke pass; static conformance records all supported hosts and untested cells separately.
5. One bounded paired installed-package cohort (Codex and Cursor; ordinary Q&A, requested brief, and fresh-process source correction) uses synthetic local policy, a connected MCP fixture and loopback read-only API configured before init. No skill names or Construct hints in user prompts; prior evidence and fixture projects are read-only.
6. Each native phase retains the original 360000 ms bound. Record package hash, public tool trace, actual file hash, reads, run/step/trust state and exit/timeout. A missing artifact or unfinished lifecycle fails completion. Correctness and uncertainty are independently assessed from actual artifacts and source history; report errors separately from missing reviewer access. No reruns to manufacture a pass.

## Remaining prioritized work

The original [intake](../intake-2026-10-09/README.md), [acceptance backlog](../intake-2026-10-09/BACKLOG.md), and native parent `work-18402da5` remain open. Existing work is reused rather than duplicated.

| Priority / existing work | Concrete next acceptance |
| --- | --- |
| P0 delivery / `work-79b6e69d`, `work-d45349d5` | Ordinary fresh prompt produces the requested file and completes lifecycle within a preregistered bound; wrong/stale artifacts fail, remain recoverable, and can be corrected without replaying effects. Explain the timed-out pre-artifact path, not just final review. |
| P0 host readiness / `work-4f056fec`, `work-26313b45` | Distinguish installed/configured/bound from callable/authenticated/observed. Preserve host policy; fail closed on unavailable execution and expose a useful draft path. Prove profile isolation on the actual host without altering user security configuration. |
| P1 traversal / `work-c0b5e1bd`, `work-5ab0581a` | Follow indirect API/MCP/local references until relevant coverage or an explicit boundary; cycle, pagination, permission denial, schema and unit uncertainty are recorded. Same timestamp/mtime with changed bytes invalidates affected claims; unrelated changes do not trigger needless work. |
| P1 composition / `work-98b4069f`, `work-a8273a89` | An unseen ordinary request selects and composes methods based on evidence/uncertainty, demonstrates their material contribution in the artifact, and distinguishes citation validity from support. Unqualified method/model combinations stay unqualified. |
| P1 scheduling / `work-411556aa` | A saved standing request without clock/executor remains unprovisioned. A bounded sterile executor survives session exit, de-duplicates firings, resumes state, records observed verification/delivery, and reports blocked credentials/approvals without pretending work ran. No production jobs are authorized here. |

Repository-local commit signing was read back as `false` after the user's renewed request; global signing remains `true`. There was no need for another configuration edit. No local memories were changed.
