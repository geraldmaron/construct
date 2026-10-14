VERDICT: Accepted with controls

# Subagent review of the revised command remediation

Reviewed 2026-10-14 in `codex/source-activation-cli`, starting at
`06c9323fd29ef198abe32908504009cdcd5e2578`. Four subagents reviewed source evidence,
restore safety, command boundaries, and validation/record accuracy. Source and
command reviewers then implemented their reproduced findings; the restore reviewer
cross-reviewed the final fixes without editing them. The validation reviewer ran
the final project gate and checked unchanged product bytes. These are separate
reviewer executions with shared session context, not a fresh external native
semantic review or proof of exhaustive coverage.

The strongest case for the approach is that Construct retains inventory without
pretending every partial read witnessed it, and keeps file declarations distinct
from normalized state. Existing transaction, manifest, resolver and wire-format
contracts provide the needed boundaries without another runtime or schema version.

## Findings and closure

1. **Unrelated source mutations changed permissions** [severity: fatal before fix].
   Failure: actual `source add --write` reported writable, but later `init` dropped
   writes. Unrelated add/retire could turn explicit `read:false` into `true`.
   Evidence: normalized `read`/`write` fields were revalidated and persisted where
   the public file contract expects nested `capabilities`. Three CLI regressions
   failed before correction. Both populated declaration writers now use
   [the canonical serializer](../../../src/kernel/project/sources-file.ts#L49)
   before validation and persistence in [source add/retire](../../../src/cli/source.ts#L185).
   Ambiguous old top-level fields are rejected with explicit repair instructions;
   no historical permission intent is inferred. Two legacy controls failed before
   this safeguard. Actual CLI tests cover all four permission combinations,
   init/add/retire, disabled refresh, exact-byte refusal and explicit repair.

2. **Partial reads made superseded content appear current** [severity: serious before fix].
   Failure: retained `old.md` lost `supersededBy:new.md`, so citations omitted the
   marker and retrieval labeled it captured. The new regression failed before
   correction. [Reader carry](../../../src/kernel/source/service.ts#L229) and
   [host-report carry](../../../src/kernel/source/service.ts#L479) now preserve
   the existing manifest fields and reader metadata. The test checks repeated
   partial reads, current/immutable citations, retrieval and no unread claims.

3. **Complete host reads could not clear supersession with unchanged content**
   [severity: serious before fix]. Cross-review reproduced `unchanged` where a
   complete replacement should remove retained metadata. The report digest only
   included reference, fingerprint, text and URL. It now hashes
   `canonicalSchema(toManifest(items))`, covering every persisted manifest field.
   [The regression](../../../tests/kernel/source/service.test.ts#L611) proves
   clearing current metadata, preserving original/partial historical snapshots,
   and deduplicating identical or display-title-only reports.

No additional supported restore defect was found. The reviewer exercised combined
relation ID/natural-key collisions in both insertion orders, work-entity natural
key collisions and missing provenance sources, confirming atomic refusal. This
is bounded kernel coverage, not an assertion about arbitrary imported snapshots.

## Six challenges

1. Strongest failure: an unrelated mutation enables a read the person disabled;
   reproduced and repaired with canonical serialization and fail-closed legacy input.
2. Best alternative: accept top-level permission fields or infer old intent.
   Rejected because ambiguous external input must not silently widen access.
   Per-item canonical source storage was also considered; existing manifest
   contracts suffice for the demonstrated defects without a migration.
3. Claims audit: the prior green gate did not cover these counterexamples. Native
   payload hashes match the frozen failed candidate; that judgment remains failed.
   Final counts and product hashes below come from the final integrated run.
4. Assumption inversion: partial inventory is not fresh evidence; full reads may
   legitimately remove metadata; explicit disabled reads must survive unrelated
   mutations. Tests exercise all three, including immutable history and repeats.
5. Cost: people relying on restricted sources or current policy bear incorrect
   permissions/currency. Refusal preserves file and DB bytes and leaves permission
   choices explicit; no production frequency or impact magnitude was measured.
6. Hostile expert: cross-review tested the reverse full-report path and exposed
   missing metadata identity. After correction, separate source and CLI suites
   passed and the full integrated gate passed. No remaining supported defect was
   found in the reviewed paths; broader readiness remains unqualified.

## Verification

Check: final real project gate, run by validation reviewer.
Command: `npm run lint && npm run typecheck && npm test && npm run smoke`
Result: pass, exit 0.
Observed: 1,135 total, 1,134 passed, zero failed, one skipped; packaged smoke passed.
The skipped live-release-record test remains outside the pass count.
Log: `/private/tmp/construct-subagent-validation-final-gate.log`.

Check: actual original CLI scenarios after both fixes.
Command: `node docs/internal/command-remediation/verify-surfaces.mjs`
Result: pass, exit 0.
Observed: ten scenarios plus sequential control; concurrent additions both active.
Log: `/private/tmp/construct-subagent-validation-final-surfaces.log`.

Check: source admission, metadata and evidence consumers.
Command: `node --test tests/kernel/source/service.test.ts tests/kernel/source/change-tracking.test.ts tests/kernel/broker/evidence-generation.test.ts tests/kernel/project/evidence.test.ts tests/security/source-text.test.ts tests/kernel/broker/sources-report.test.ts`
Result: pass.
Observed: 61 passed, zero failed or skipped.
Log: `/private/tmp/construct-provenance-targeted-final.log`.
The host-replacement red/green logs are
`/private/tmp/construct-provenance-host-replacement-red.log` and
`/private/tmp/construct-provenance-host-replacement-green.log`.
Earlier carry-loss and permission negative controls are retained in reviewer tool
transcripts, not represented as separate file receipts.

Check: independent final cross-review of source and CLI patches.
Commands: `node --test tests/kernel/source/service.test.ts` and
`node --test tests/cli/source-lifecycle.test.ts`.
Result: pass.
Observed: 27 source tests and 11 CLI tests passed; no files edited by that reviewer.
The command owner additionally ran
`node --test tests/cli/source-lifecycle.test.ts tests/cli/source-activation.test.ts tests/kernel/project/discover-reset-files.test.ts`:
19 passed, none skipped. The restore review ran
`node --test tests/kernel/work/completion-restore.test.ts tests/kernel/work/structure.test.ts`:
17 passed, none skipped.

The first sandboxed baseline gate failed on test-owned fixture writes and process
inspection permissions. The same baseline gate then passed with permitted host
execution. It is separately retained in
`/private/tmp/construct-subagent-validation-baseline.json`; it predates these fixes
and does not validate them. Final evidence is
`/private/tmp/construct-subagent-validation-final.json`.

Outcome: source permissions survive unrelated declaration changes and reconciliation;
partial reads preserve supersession while complete reads can replace it.
Surface: actual CLI add/retire/init/refresh; source refresh/reporting, current and
snapshot citation resolution, ranked retrieval; packaged CLI/server smoke.
Data: sterile project/HOME fixtures, all four permission combinations, malformed
legacy permission files, superseded documents, repeated partial and full reports.
Observed: permissions unchanged after successful unrelated mutations; ambiguous
files refuse without file/DB changes; current and historical metadata behave as
asserted above. No real host configuration or credentials changed.
Verdict: proven for these local surfaces. Native desktop/fresh-user readiness,
canonical isolation, the original other-device incident and the unimplemented
setup/task facade remain unqualified. The old main-bound generation remains
unaccepted; no additional external native review was run.

Verification record
- Steelman stated: answered, see "existing transaction, manifest, resolver and wire-format contracts".
- All six run: answered, findings from permission inversion and metadata identity.
- Findings concrete: answered, one fatal and two serious mechanisms, corrected and cross-reviewed.
- VERDICT: accepted with controls, limited to reviewed local paths and recorded boundaries.
- Self-review: separate subagent execution with shared-context disclosure; owners' fixes cross-reviewed.
- No improvement drift: breakage only; no architectural facade or native-access expansion.
- implementation-verification: existing contracts reused; real gate and user-facing outcomes observed; final diff reviewed before commit.
- commit-and-pr: coherent local slices; no secrets or attribution trailers; no push, merge, PR or release.

Validated product/test bytes (SHA256, identical before and after the final gate):

```json
{
  "src/cli/source.ts": "0f0b36cb2cd67462899d763b7f805e455b45d6d32f17e91ecf512dc9c970bea8",
  "src/kernel/project/sources-file.ts": "c967d01e2abca801534eaf5a5dd5fa3f4d7727cb3004d8cc32b8a5b63a79be0c",
  "src/kernel/source/service.ts": "f198b14a54ad70b05d22db9e62e8c359da539e66eaaeb3a4d4321f80916cb117",
  "tests/cli/source-lifecycle.test.ts": "4a04f028334e91eaf3b95875dc4e6cc6d517e73408488ac6a9e1d21694c45c33",
  "tests/kernel/source/service.test.ts": "2605636407ee5864d0eaaf197cd35a8180c9ef87342f6236b770a997f31f0fd2"
}
```
