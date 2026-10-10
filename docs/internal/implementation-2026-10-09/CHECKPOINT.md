# Implementation checkpoint

This is a checkpoint; the parent implementation outcome remains open.

## Decisions and changes

Keep the host-owned model/sandbox and Construct-owned durable kernel. Verify host integration separately from kernel contracts. Skill installation alone does not enforce admission. No new model runtime or always-on daemon was added.

Local commits:

- `6febaa30`: detect observed source corrections independently of provider timestamps and local size/mtime; stream large file hashes; avoid directory loops and false deletions from capped/incomplete inventories.
- `d798abcc`: a unique typed deliverable leaf such as `prd` resolves to `document/prd`; ambiguous leaves do not guess. Current locks and eval filenames do not falsely qualify a skill without passing execution evidence.

The full gate after both changes passed: lint, typecheck, 812 tests passed with one skip, and packaged smoke. Static conformance passed 91 checks with seven live cells untested. [Gate logs](evidence/gates/final-tests.log).

## Clean SSO trial

The clean project was installed with npm from a packed artifact, and native host inspection exposed all nineteen Construct tools and all three synthetic workspace tools before the trial. The ordinary prompt was “Write a PRD for adding single sign-on to LatticeDesk. Save it as sso-prd.md.” The rubric was outside the consumer project and was not supplied to the model.

The [score](evidence/sso-before-routing-fix/score.json) is **fail**. The consumer exercised Construct lifecycle, but `prd` became `other`, which selected the generic workflow. It made twelve Construct calls, zero workspace-source calls, and zero skill-show calls. The state contains a succeeded run, a challenged deliverable, zero resolved skills and zero source snapshots. Its work claim used a step identifier instead of a work item and failed, but drafting continued. The final PRD chose SAML and deferred OIDC without reading the connected current identity proposal, prospect requirements, corrected session behavior, inaccessible contract, accessibility guidance or operations material.

This is the central remaining risk: structural evidence checks can pass without enough discovery or sound substantive support. Correct lifecycle use is necessary, not sufficient. The routing defect is fixed in the second commit; it has not yet been re-evaluated with a fresh live consumer.

The [public transcript](evidence/sso-before-routing-fix/consumer-public.jsonl) excludes model reasoning and redacts lease tokens. The [artifact](evidence/sso-before-routing-fix/sso-prd.md) is retained for evaluation, not endorsed as a complete PRD. Preliminary attempts with omitted MCP configuration and a dereferenced executable symlink are harness failures and are excluded from product scoring.

## Next work and limits

Repack current HEAD, install a new project through npm rather than copying node_modules, preflight the tool inventory, and run the same withheld-rubric SSO consumer. Then fix the observed discovery/coverage and verification failures, repeat Harbor corrections, incident/change-impact and post-session scheduling. Capability observations, execution-based skill qualification/composition, verification receipts and a real executor-bound scheduling contract remain unfinished. Do not mark the implementation parent complete.

The source-invalidation work item is complete. Skill qualification work remains open: the label and specialist routing are corrected, but executed qualification records and composition are not implemented. The managed implementation run remains in its do step. All synthetic consumer processes have exited and their owned process groups were terminated; no timer or scheduled job was installed. No push, merge, publish or deployment occurred.
