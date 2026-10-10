# Independent recheck of semantic review fixes

Read-only recheck on 2026-10-09. The implementing agent continued editing while this pass ran; `recheck-snapshot/` preserves the inspected code. No repository edits, model calls, native subscription trial, network activity, or personal configuration change occurred. The host preflight race probe uses a disposable local fake transport through an explicit trusted test seam, not a model or qualification witness.

## Remaining confirmed defect: pending-draft promotion prevents completion

After final submission prepares a draft and a matching semantic receipt exists, `runSemanticProblems` accepts the prepared body even though the final step remains leased. Promotion can therefore move that draft to challenged, accepted and final before the required identical final resubmission. On resubmission, `pendingSemanticReview` always calls `upsertDraft`; the storage contract rejects redrafting a challenged/accepted/final deliverable. The exact reviewed candidate can no longer complete normally. Challenging the pending draft alone is sufficient to cause the failure.

Reproduction is the first test in `recheck-snapshot/tests/kernel/workflow/recheck-semantic-review.test.ts`: prepare candidate, append a synthetic adapter receipt, promote the pending draft through challenged → accepted → final, then resubmit identical output. The object is final while its step is still leased; resubmission throws `only a draft or rejected deliverable can be redrafted`.

Smallest fix: refuse trust promotion of a final-step pending draft until its step has completed, including challenge promotion; explain that completion/resubmission comes first. Alternatively, support completing the same immutable body without redrafting or dropping existing trust, with generation equality enforced. Do not permit different content to inherit the promotion or semantic receipt.

## Fixes independently exercised

Nine isolated tests passed: the remaining defect reproduction above and eight verification/control cases:

- Cancellation during a delayed version/auth preflight now prevents reviewer dispatch. The current snapshot rechecks lease/run in its dispatch transaction and throws before the fixture's reviewer-launch marker is created.
- Raw byte bounds include private reasoning events and incomplete lines; null envelopes and invalid completion order are rejected.
- A waived final step now reviews and persists the identical effective body, including current waiver metadata, and completes after a matching receipt.
- An oversized final candidate remains a draft with a null preparation reference and an explicit repair message.
- Final-step clarification pauses before completion, resumes with a new lease, includes the person's answer in the bundle, and can complete after review.
- Final `noData` continuation creates a reviewable attempt and completes only after matching review.
- A review of the final body cannot promote a different earlier deliverable.
- A pre-upgrade binding missing the semantic contract is blocked instead of succeeding without review.

These tests verify mechanics and rejection paths. Synthetic `host_semantic` events are explicit core-test seams and provide no evidence about semantic judgment quality, native model execution, or native containment. Actual authorized native subscription qualification remains separate.

## Identity and containment scope

The new pin resolves the npm launcher to the platform native binary, rejects ordinary script replacements and project-contained binaries, binds digest/version before producer work, and rechecks the pinned path/digest. This addresses the earlier late PATH-script substitution when the broker's startup environment is trusted. No additional post-start substitution bypass was confirmed in this pass.

Keep that trust boundary explicit: native file magic and a self-reported version alone do not authenticate vendor provenance. A new broker/CLI startup still derives its initial pin from its own environment. A producer-controlled new startup must not be presented as independently authenticated solely by those checks. A host-owned qualified installation/profile record can provide that stronger boundary without introducing signing changes or claiming universal machine integrity.

The finite native trial should remain bound to the exact pinned installation, profile and effective permission configuration it tests. This pass does not demand a universal containment guarantee and does not classify lack of such a guarantee as a code defect. It also does not treat post-hoc event rejection as undoing an external effect.

Reproduce the isolated checks from `recheck-snapshot/` with:

```sh
node --test tests/kernel/workflow/recheck-semantic-review.test.ts
```

The snapshot hashes and captured test log are saved beside this report. The remaining pending-promotion finding was reported promptly to the implementing agent; subsequent fixes need a targeted regression test.
