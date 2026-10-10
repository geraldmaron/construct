# Alpha.27 experimental release record — 2026-10-10

Current status: the explicitly approved experimental tier has three passing
native controls and a reviewed policy. The full qualified tier still fails
on missing evidence. The initial blockers below explain the deliberate
policy change; they are not relabeled as full qualification. Publication
receipts will be recorded only after the trusted-publisher workflow succeeds.

The user authorized committing and publishing a new alpha. The candidate is
`3.0.0-alpha.27`; the registry was checked with `npm view` and still names
`alpha: 3.0.0-alpha.26`, `latest: 2.1.1`, `next: 1.0.1`. The new version tag
was absent. Nothing has been published, tagged, merged or represented as
release-qualified by this record.

The official route in [release verification](../../release-verification.md)
is checked PR → checked main commit → `v3.0.0-alpha.27` → GitHub Actions
trusted publishing with provenance and `--tag alpha` → published-package
install verification → GitHub prerelease. Existing GitHub authentication
is available. No registry credentials were created or changed.

## Integrity fix and candidate

Commit `0e114045` fixes the independent reviewer's expired-lease completion
finding. Holder, nonce, attempt, expiry and cancellation are checked inside
the submission transaction before draft mutation. Atomic settlement also
rejects expiry. The draft remains preserved; reclamation requires a fresh
review. Boundary, cancellation and recovery controls pass.

The candidate includes the exact-generation semantic gate and the earlier
source, context, method qualification, scheduling and recovery changes.
Release notes are in [CHANGELOG](../../../CHANGELOG.md). They explicitly
retain the fresh-user, reviewer-adapter, composition, production-source and
scheduling limitations and do not claim V1–V9 completion.

## Full qualification: blocked (initial release blocker)

`npm run evals:live -- check --cut` exits 1 because
`skills/evals/intake-live.json` is absent. A real full record is required;
no bypass or fabricated record is permitted.

Actual installed evaluator preflights:

| Required host | Observation | Affected cells |
|---|---|---|
| Claude Code 2.1.250 | `FAIL subscription auth: missing`; native reply `Not logged in · Please run /login` | haiku/sonnet/opus × default/crowded/no-tool-search/fresh-init/injected (15 cells) |
| Codex CLI 0.145.0 | Subscription authentication passes; contamination canary exposes AGENTS.md and unrelated `mcp__codex_apps__…` tools | default/crowded/fresh-init/injected (4 cells) |

The human must authenticate Claude Code using their existing subscription.
The Codex evaluator profile must isolate the intended Construct/stub tool
surface, then pass its canary. Neither failed prerequisite is a valid cell.
Cursor, VS Code, OpenCode and Bob may be disclosed as unmeasured under the
existing canonical rules; Claude Code and Codex may not.

The matrix has 87 ordinary and 8 injected test cases. Across the 19 required
cells, candidate plus two baselines and three repetitions produce 12,033
case runs, plus independent labeling and the required end-to-end case.
The saved warehouse/reviewer trials have a different corpus, conditions and
repetition/baseline structure, so they cannot be converted into that record.
Runtime, lockfile and model-facing changes invalidate stale candidate
identity. Failures remain evidence and never become passing records.

## Retained evidence and next steps

[Evidence](evidence/alpha27-release/) includes both preflight failures, the
lease-fix gate, current native confirmation, Cursor's independently graded
artifacts, and Codex's incomplete-state observation. Older failed trials and
rubrics remain intact in the original intake and semantic-review archive.

After the two prerequisites are repaired: run the documented labels/cells,
freeze their actual evidence, aggregate with `record --scope=full`, and
require `check --cut` on the final candidate. Only then merge/tag/publish
through the official workflow, verify CI/remote commit/npm tags, and test a
clean installation of the published tarball. `latest` must remain 2.1.1.


## Final candidate checks

The bumped `3.0.0-alpha.27` tree passed lint, typecheck, **1,018 tests
with zero failures and one existing skip**, packaged-install smoke, and
static conformance (**85 passed, zero failed, 19 untested**). Logs and the
machine-readable conformance report are retained in the evidence directory.
No production code changed after those checks. The cut check still reports
the absent canonical record; deterministic checks do not replace it.

A bounded diagnostic disabled `apps`, `plugins`, `remote_plugin`,
`tool_suggest` and `skill_mcp_dependency_install` for one read-only Codex
invocation, with no global setting or credential change. Its completed
response listed only `construct`, while still quoting `# AGENTS.md
instructions`. The fixture has no AGENTS.md; the real CODEX_HOME has global
guidance, and `--ignore-user-config` only promises to omit config.toml.
Earlier speculation that this was generated fixture guidance was disproved.
The canary was not changed, and the diagnostic is not a passing canonical
cell. A model-reported tool list establishes neither authoritative inventory
nor denial of out-of-profile access. The intended instruction/tool boundary
must be explicit and verified without weakening user/managed security
policy. No runtime or evaluator source was changed by this investigation.

Executable follow-up is filed under the original intake parent:

- `work-26313b45`: restore isolated Codex canonical preflight, preserve
  policy, isolate foreign guidance/tools as designed, and retain real denial evidence.
- `work-2bb7a97f`: after Claude subscription login and the isolation repair,
  complete the canonical matrix, comparisons, labeling and end-to-end case.
  This item is blocked by the isolation item. Full release acceptance remains
  open; neither task is marked complete.

Under the former policy this candidate could be proposed as a draft PR,
but not released while the full live gate failed. The explicit subsequent
policy decision below introduces a separately checked experimental tier.


## Release-policy history and practical scope

The full-matrix requirement at every alpha cut was already documented by
`237ba29d` on October 8. This implementation added its CI enforcement in
`2b1720e0`; the policy is not newly invented by the release check. Neither
[the release guide](../../release-verification.md) nor the current workflow
contains an experimental-alpha exception. Smoke scope is accepted by ordinary
`check`, but not `check --cut`. Unsupported hosts can be disclosed as
unmeasured only within the explicit allowed set, which excludes Claude Code
and Codex. Changing the release policy would require a deliberate reviewed
policy change, not relabeling missing or failing evidence.

The 12,033 required case runs have not been launched. The runner executes
cases serially per batch, with a five-minute bound per case and possible
reruns; subscriptions still have quota and elapsed-time costs. No credible
completion-time or monetary forecast was measured. Reconcile this matrix's
intended release scope and cost before launching it; the diagnostic above
was a single 60-second-bounded invocation.

Exact commands currently blocking qualification:

```bash
node scripts/evals-live.mjs preflight --host=claude-code --model=haiku
node scripts/evals-live.mjs preflight --host=codex --model=gpt-6-astra
npm run evals:live -- check --cut
```

The first requires human subscription login. The second still lacks a
passing isolation observation. The third refuses the missing full record.
Nothing has been merged, tagged, published, or represented as a released
alpha.27.


## Explicit policy decision, 2026-10-10

After the former blocking policy was explained, Gerald explicitly approved
adopting a separate experimental-alpha tier and publishing alpha.27 under
it. The earlier blocker sections above are retained as historical evidence;
they do not say that the full matrix passed. The implementation is now in
[release verification](../../release-verification.md#experimental-alpha-tier),
`scripts/release-gate.mjs`, the bounded native runner and the release workflow.
Full qualification remains a separate mandatory gate for broader readiness.
No credentials or user security settings were changed.

Independent recheck cleared `0e114045` with eight bounded controls; see the
[review result](evidence/alpha27-release/independent-recheck.md). A separate
focused review of the new release policy is required before tagging. Final
native evidence, gate logs, candidate identity and publication receipts will
be appended after actual execution.


## Experimental candidate validation

The focused policy review passed after all three findings were repaired.
Three fresh independent native Codex sessions on the same candidate accepted
the correct control, rejected incorrect arithmetic, and rejected an injected
source variant. Rejected controls stayed running/leased with exact persisted
drafts; all fixtures stayed unchanged and the injection canary was absent.
The [checked manifest](../releases/3.0.0-alpha.27.json) binds the candidate,
full prepared bundles, public transcripts, judgments, and limitations.

The full unchanged suite passes **1,024 tests, zero failures, one existing
skip** at four-way test-file concurrency. Earlier full runs retain one old
release-policy assertion failure (corrected consistently with the approved
policy), and one hook deadline failure under observed concurrent CPU load.
No timing assertion or security/integrity test was relaxed. The first local
contention diagnosis is an inference from timing and concurrent high-CPU
processes; the passing rerun and CI are the actual verification.

Final candidate lint and typecheck pass; packaged smoke passes; static
conformance is 85 passed, zero failed, 19 untested. The experimental gate
passes on the final recorded surface. The qualified gate still fails on the
absent canonical record. [Final and earlier gate logs](evidence/alpha27-release/)
retain the complete observed denominator.
