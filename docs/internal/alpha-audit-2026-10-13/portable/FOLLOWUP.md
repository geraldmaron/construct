# Follow-up validation pass

Candidate: `f323abe7`. Executed October 13, 2026, using existing subscription access. No product code, credentials, global installation or release changed.

## Observed checks

| Command | Result | Observation |
|---|---|---|
| `npm run lint` | pass | Existing lint and generated-interface checks passed. |
| `npm run typecheck` | pass | No type errors. |
| `npm test` | pass | 1,077 passed, one skipped, zero failures. |
| `npm run smoke` | pass | Fresh packaged CLI/MCP retrieval, immutable history, checkpoint and structural delivery loop passed. |
| `npm run conformance` | pass | 97 passed, zero failed, 19 untested across six static host contracts. |
| `node --test tests/kernel/broker/portable-outcomes.test.ts` | pass | Ten passed. Bound receipt `execution:986`. Five expected retrieval passages found, zero extra passages, four milliseconds, zero host calls; fixed expansions are mechanism evidence. |
| `npm run evals:live -- preflight --host=codex --model=gpt-6-astra` | fail | Installed binary/version, subscription auth and absent API environment passed; contamination canary still reported foreign instructions and connector tools. |

## Ordinary native decision diagnostic

Reused `runOnce`, `workflowCatalog`, the existing platform fixture, the shared host invocation and stdio tap from `scripts/evals-live.mjs`. One ordinary prompt asked for a local-source decision brief about moving payment-to-ledger onto an event bus, preserving double-entry, with alternatives, recommendation, strongest objection and missing evidence. It authorized neither code changes nor external contact. No workflow or skill was named in the prompt.

The real host selected `decision-support`, reported portable intent and acceptance, retrieved prior project records with two inferred expansions, and read eleven local files. Retrieval returned three records using 1,739 of its 5,000-character item budget. The plan, production and verification steps completed. The first production submission was refused because two obligation references were absent from the method evidence list; the host reclaimed and repaired it without a waiver. The final run `run-037ed11d` succeeded and deliverable `deliverable-4dc63c94` retained structural assurance, with execution and semantic support unverified. No person acceptance was claimed.

The final brief recommended deferring cutover pending delivery/recovery evidence, compared retained HTTP, an outbox/worker and a general bus, and distinguished documented design from incomplete fixture implementation. This session inspected the actual final text against architecture.md, charge.ts, refund.ts, entries.ts and reconcile.ts. Main factual claims matched: capture changes object state; paired postings share amount/currency; balanced checks positivity and distinct accounts; reconciliation groups by account without currency. Proposed durability/deduplication controls were labeled recommendations, not current facts. The final answer check returned structural success while semantic support remained unknown.

Observed duration: 218,334 milliseconds; 13 Construct calls, including one repair; 16 total reported tool uses. The host reported 1,272,279 cumulative input tokens, 1,189,632 cached input tokens and 4,456 output tokens. These are stream-reported usage, not unique context size or a billing calculation. The overhead is a material efficiency concern. No additional paid endpoint was used.

Qualification: successful observed delivery for this one diagnostic, reviewed by the current session. The failed isolation canary prevents clean attribution to Construct alone and does not establish broad portability, independent review, or causal skill contribution. A method/no-method cohort was not run under the failed boundary. Research, visual artifacts, code implementation, interruption and adversarial-source behavior remain covered by mechanism tests or earlier records rather than a new qualified native cohort.

## Continuity and remaining work

Native trial output and tap are retained under `/private/tmp/construct-followup-native`; raw output contains ephemeral fixture leases and is intentionally not committed. The trial supervisor exited normally, and its fixture was cleaned by the existing harness. The current project server still retained older startup bindings; fresh subprocesses measured the committed implementation.

Keep existing isolation and skill-qualification work open. Establish the native instruction/tool boundary, then repeat frozen ordinary outcomes and the same-evidence method comparison. Prior failed cohorts remain failures. This pass strengthens observed delivery evidence without establishing that the alpha is fully qualified.

The project-side review run `run-f6331cde` passed gathering, observed checks and review, but its last bookkeeping submission incorrectly included this file path in `recordedIds`, which accepts only native record IDs. The one-attempt record step stopped for a decision. That input error does not invalidate the separately witnessed test or native diagnostic results; this review run is not complete and is not presented as independent assurance. A retry would use only the actual work ID (or an empty list) and cite this file as evidence.
