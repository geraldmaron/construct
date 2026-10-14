VERDICT: Accepted with controls

# Current documentation audit

Engineering verification record, October 14, 2026. Shared-context self-review.
This is a correction of the current public guidance, not native effectiveness
qualification or person acceptance. Reviewable change: [PR](https://github.com/geraldmaron/construct/pull/24).

## Baseline and scope

Started from released alpha.28 on main, commit
`0b94218709cdf15c2179ad9d62e3428f135e67ef`. Reused the
[portable follow-up](../alpha-audit-2026-10-13/portable/FOLLOWUP.md), release
records, generators, command registry and existing help/example tests. Searched
repository documentation scripts and installed methods before extending the
existing index lint; no second documentation engine or dependency was added.

The public inventory covers root README, glossary and security guidance,
top-level GitHub docs, generated CLI/tool/config/catalog/state references,
skill overview and resource cross-links, CLI help, package metadata, GitHub About
and current release surfaces. Dated records and prior releases remain history.
The person identified GitHub docs as the docsite. The Pages API returned no
deployment; no separate docsite was invented. The personal-site project blurb
was observed outside this scope and remains a separate upkeep item.

## Claims and observed sources

| Claim corrected or bounded | Code or evidence checked |
|---|---|
| State format and supported upgrades | `src/kernel/state/format.ts`, migration guidance and existing migration tests |
| General carrier versus explicit implementation path; matching precedence | `src/kernel/workflow/intake.ts`, `src/kernel/broker/tools.ts`, workflow manifests |
| Exact native qualification rather than filenames/lock | `src/kernel/registry/qualification.ts`, qualification evidence checks |
| Claim returns bound skill text by default | `src/kernel/broker/tools.ts` claim parser and generated schema |
| Local text ranking, budgets, optional supplied vectors, no inference fallback | `src/kernel/context/retrieval.ts` |
| Immutable generation citations and revoked access | `src/kernel/source/manifest.ts`, `src/kernel/source/resolver.ts` |
| Standing trigger creation is available from chat; clock is separate | `src/kernel/broker/tools.ts` start-outcome branch and scheduling tests |
| Verification needs command, exit status and execution reference | `src/cli/run.ts`, command observation and workflow verification tests |
| Doctor reports index observations rather than efficacy | `src/cli/doctor.ts` |
| Node requirement, scripts and packaging | `package.json`, `bin/construct.mjs`, packaged smoke |
| Finite native observations and unresolved effectiveness | prior portable follow-up and release verification records, preserved as dated evidence |
| CLI names, flags and generated references | command registry, generated-page check, help tests and scratch-project examples |

README organization follows inspected uv and ripgrep repository READMEs:
purpose, installation, usage, capabilities, limits, deeper documentation,
development and license. It does not borrow their readiness claims.

The final sweep found stale implementation-carrier language in a workflow
manifest, generated catalog and host reply. Corrected source metadata with a
workflow patch version and regenerated the registry/catalog. Matching behavior
and executable review restrictions were not changed. Existing runs retain their
frozen workflow version. New host-visible wording is statically checked, not
newly qualified by ordinary native trials.

## Validation and visible outcome

Executed the complete project gate:

```bash
npm run lint && npm run typecheck && npm test && npm run smoke && npm run conformance
```

The initial final pass exited successfully: tests reported 1,082 passed,
zero failed, one skipped out of 1,083. The skipped live-record case explicitly
has no qualifying live record. Packaged smoke installed and exercised the
package in an isolated consumer. Conformance reported 97 passed, zero failed,
19 untested static/native-boundary cells. These are not native parity passes.
After correcting the remaining host-visible metadata, this same gate passed
again with the same test and conformance counts.

Focused command:

```bash
node --test tests/scripts/lint-docs-index.test.ts tests/cli/help-and-flags.test.ts tests/docs/examples.test.ts
```

The focused pass reported 13 passed, zero failed. README command examples were
then included in the existing scratch harness and its focused test passed.
Local-link lint checked 133 links across 20 indexed documentation files and
the public root/skill resources. Missing paths, stale anchors, duplicate
headings, code examples, historical boundaries and reference-definition links
have regression coverage. The parser supports the corpus's Markdown forms;
external URL liveness and every possible Markdown syntax are not claimed.

GitHub branch rendering was inspected through the actual browser: documentation
directory/index, source guide, generated broker reference and README. Followed
index → source guide → `context_search` anchor → Project README. Observed the
updated text, matching anchor and working return navigation. Main stays on its
prior documentation until this PR merges. GitHub About is consistent with the
experimental project-bound scope. No package was published by this audit.

## Challenge

Steelman: code-derived references plus short guides give users a usable route
from installation to an appropriate outcome without implying that wiring proves
effectiveness. Existing generators and observed command tests make drift
detectable with low recurring cost.

1. Strongest failure mode: a fresh user sees healthy wiring and assumes all
   host outcomes or vector generation are operational. README and guides now
   explicitly distinguish static wiring, supplied vectors, delivery, independent
   review and qualification. Native gaps remain visible.
2. Best alternative: generate all prose from schemas. This avoids one class of
   drift but cannot explain authority, readiness or method effectiveness.
   Accepted with the existing generated references and tested human guides.
3. Load-bearing claims: the table above grounds the current contracts. Prior
   native measurements retain their original record and finite scope. No fresh
   native effectiveness claim is made.
4. Assumption inversion: if a guide, heading or CLI changes later, existing
   command/generation checks and the extended link lint detect covered drift.
   Semantic promises still require review; a regex parser cannot establish them.
5. Who bears the cost: users pay in failed setup and wasted context if guidance
   overstates readiness. Limits are placed beside installation/capabilities;
   current failures are not buried as historical successes.
6. Hostile expert: static conformance and receipts do not prove useful reasoning
   or causal skill benefit. The documentation states that explicitly. A complete
   external-link/doctrine freshness audit and native matrix were not run here.

Finding [serious]: treating this pass as broad qualification would mislead
users. Evidence is the untested native cells, missing live record and prior
isolation limitations. Control: retain explicit experimental and finite-scope
language; do not promote this audit to readiness evidence.

Finding [minor]: the local-link parser does not implement all Markdown grammar.
A future unhandled syntax can evade checks. Control: state its scope, retain
browser inspection and add regression cases when new syntax is introduced.

Verification record
- Steelman stated: answered, see Challenge: "code-derived references plus short guides".
- All six run: answered, findings from qualification inference and parser scope.
- Findings concrete: answered, no fatal findings; serious qualification-inference and minor parser-scope findings above.
- VERDICT: accepted with controls.
- Self-review: answered, shared-context, disclosed; no independent review claimed.
- No improvement drift: answered, breakage only in the challenge.
- implementation-verification: project inspected, existing tools extended, full gate and actual GitHub rendering observed; native efficacy remains unqualified.
- commit-and-pr: full staged correction diff read, one correction scope, no secrets found, task branch used, invariant subject/body and verification PR supplied; repository completion instructions authorize the working-branch commit/push. Merge/publication not performed.

## Final metadata gate

The full command above exited successfully after the host reply, workflow
metadata, registry index and catalog corrections. Output was retained locally
as `construct-docs-metadata-gate.log`; no new native qualification was attempted.
