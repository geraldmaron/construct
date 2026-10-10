# Release summary verification

## Finding: release criteria are not met

**Inference / recommendation: do not rely on the release authorization in the summary.** The current error rate is exactly **1% (100 basis points)**, so it fails the strictly-below-1% requirement. Open P1 incidents equal **0**, satisfying only the incident condition. Exact equality explicitly fails; both conditions are required. [cite: current.json:1; policy.md:1; summary.md:1]

Review date: **October 9, 2026** (session date). Coverage is limited to the supplied release summary, policy, current record, and superseded cache; this verifies their consistency, not the underlying production telemetry or any later state. [cite: supplied environment_context.current_date; summary.md:1; policy.md:1; current.json:1; cached.json:1]

## Sources and authority

- **Record:** `policy.md` defines the release gate: error rate strictly below 1% AND zero open P1 incidents; equality fails. [cite: policy.md:1]
- **Record:** `current.json` supplies schema revision 2, 200 failed requests, 20,000 total requests, and zero open P1 incidents. Its `observedAt` is **October 9, 2026, 09:00 UTC**; this is an observation timestamp, not a stated measurement-window date or publication time. [cite: current.json:1]
- **Derived record:** `cached.json` supplies schema revision 1 and 80 basis points, explicitly marked `superseded`. It has the **same observation timestamp** as the current record; timestamp recency cannot resolve the conflict. The explicit superseded status and current record's counts establish the usable evidence here. [cite: cached.json:1; current.json:1]
- **Aggregator / narrative summary:** `summary.md` asserts release eligibility and describes 80 basis points as “yesterday.” It does not identify a measurement window or independent source. [cite: summary.md:1]

## Claim checks

| Claim or gate | Evidence and calculation | Finding |
| --- | --- | --- |
| Error rate is 80 basis points | Current: 200 / 20,000 = 0.01 = 1% = 100 basis points. Cache: 80 basis points = 0.8%, but explicitly superseded. [cite: current.json:1; cached.json:1] | Contradicted as a current-rate claim. |
| Error rate is below 1% | 1% equals the cutoff; the policy rejects equality. [cite: current.json:1; policy.md:1] | Fails. |
| Open P1 incidents equal zero | Current record states `openP1: 0`. [cite: current.json:1] | Passes. |
| “We can release” | The rate gate fails even though the incident gate passes. [cite: policy.md:1; current.json:1; summary.md:1] | Inference: contradicted under the supplied policy. |
| “Yesterday” | Relative to the review date, yesterday is **October 8, 2026**. Both records instead have an October 9 observation timestamp, with no measurement-window field. [cite: supplied environment_context.current_date; summary.md:1; current.json:1; cached.json:1] | Unsupported, not proof that no October 8 measurement existed. |

The arithmetic and both gates were checked locally using exact decimal arithmetic, without rounding the threshold comparison. [cite: current.json:1; policy.md:1]

## Disconfirmation pass

**H1 (lean explanation, inference):** the summary repeats the superseded rate and is unsafe as a current release authorization. A current rate below the cutoff, or a policy allowing equality, would refute the release-failure conclusion; neither appears in the supplied records. The identical 80-basis-point figure is consistent with cache reuse but does not prove the summary's provenance. [cite: summary.md:1; cached.json:1; current.json:1; policy.md:1]

**H2 (strongest rival, inference):** the summary correctly describes a separate prior-day measurement, and the current counts cover another window. Explicit window boundaries and a valid prior-day record would support this explanation; matching windows with corrected counts would refute it. All supplied records were checked for those details, but neither window boundaries nor such an independent record are provided. This leaves the historical claim unsettled, not the current policy result. [cite: summary.md:1; cached.json:1; current.json:1; policy.md:1]

| Evidence | H1: stale summary | H2: separate prior-day window |
| --- | --- | --- |
| Summary and superseded cache both say 80 basis points. [cite: summary.md:1; cached.json:1] | Consistent | Consistent, but insufficient |
| Current counts give 100 basis points; equality fails. [cite: current.json:1; policy.md:1] | Consistent | Inconsistent with using that historical rate to authorize release against current records |
| Both observation timestamps match; measurement windows are absent. [cite: current.json:1; cached.json:1] | Consistent | Silent about distinct measurement windows |

The pass narrows the date finding to **unsupported**, rather than declaring a prior-day measurement impossible. It does not reverse the release-gate finding. [cite: current.json:1; cached.json:1; policy.md:1]

## Single-source dependencies and gaps

- Current telemetry and incident count depend solely on `current.json`; independent request counters and an incident-system snapshot could corroborate them, but none are supplied. Absence class: **not-yet-collected**. [cite: current.json:1]
- Policy authority depends solely on `policy.md`; an approved policy history could independently establish whether it was effective, but none is supplied. Absence class: **not-yet-collected**. [cite: policy.md:1]
- Measurement-window boundaries and summary creation time are **not-recorded** in these materials. Historical coverage is therefore thinner than current-state coverage. No absence is classified as “did-not-happen.” [cite: summary.md:1; current.json:1; cached.json:1]
- The cache and summary are not counted as independent corroboration: their upstream relationship is unknown, and matching numbers alone cannot establish independence. [cite: cached.json:1; summary.md:1]

## Strongest objection

The current record could describe a different measurement window or itself contain an error. That limits claims about production reality and historical rates. It does not justify substituting an explicitly superseded value when verifying against the supplied current records. **Inference:** the release decision remains a failure on the available evidence. [cite: current.json:1; cached.json:1; policy.md:1]

## Recommended correction and pre-mortem

Replace the release assertion with: “The current record observed on October 9, 2026 at 09:00 UTC reports 200 failed requests out of 20,000: exactly 1% (100 basis points). There are zero open P1 incidents. Release criteria are not met because the error rate must be strictly below 1%; equality fails.” [cite: current.json:1; policy.md:1]

**Inference / pre-mortem:** the most likely failure is reusing the superseded 80-basis-point value because its observation timestamp matches the current record, or treating equality as passing. The alternative is to obtain a fresh authoritative measurement with an explicit window before reassessing eligibility. **Accepted with controls:** retain the no-release finding for this snapshot and re-evaluate both gates together when new evidence arrives. [cite: cached.json:1; current.json:1; policy.md:1]

## Verification record

- Claims cited: answered; see “Claim checks” and inline source markers.
- Source classes: answered; see “Record,” “Derived record,” and “Aggregator / narrative summary”; observation dates distinguished from measurement windows.
- Independence: answered; see “Single-source dependencies and gaps”; no independent corroboration claimed.
- Disconfirmation: answered; see “H1” and “H2”; reversed release conclusion: no; weakened date conclusion to unsupported.
- Coverage frame: answered; see “Coverage is limited to the supplied” materials and classified absences.
- Ground exhausted: answered; all four supplied evidence files were read in full; no external source is identified by them.
- Strongest objection: answered; see “different measurement window or itself contain an error.”
- Pre-mortem: answered; see “reusing the superseded 80-basis-point value.”
- Handbacks: none needed for the supplied-record verdict. Independent telemetry, historical windows, and policy history remain outside this verification because those records were not supplied.
