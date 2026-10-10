# Release summary verification

## Finding

**Do not rely on the release summary's approval.** Inference: the supplied current record fails the documented release gate: 200 failed requests / 20,000 total requests = **1.00% (100 basis points)**, while the policy requires **strictly below 1%** and explicitly rejects equality. Open P1 incidents are 0, so that condition passes, but both conditions must pass. [cite: current.json:1; policy.md:1]

Assessment completed against all supplied release evidence. Scope is the request population represented by `current.json`, compared with the supplied cache, summary, and policy; no service, geography, measurement-window boundaries, or live-system coverage is specified. This is verification only, not release authorization or execution. [cite: current.json:1; cached.json:1; summary.md:1; policy.md:1]

## Source authority and provenance

- **Record:** `current.json` contains schema revision 2, request counts, and open-P1 count. Its `observedAt` is an observation timestamp, 2026-10-09T09:00:00Z, not a stated reporting interval or revision time. [cite: current.json:1]
- **Derived record:** `cached.json` contains schema revision 1, an explicit `superseded` status, and a precomputed rate of 80 basis points. It has the same observation timestamp as the current record. [cite: cached.json:1; current.json:1]
- **Aggregator/claim under review:** `summary.md` says, “We can release: yesterday the error rate was 80 basis points, below1%.” It supplies neither its own date nor a reporting interval. [cite: summary.md:1]
- **Record (normative):** `policy.md` defines the release rule, including failure at exact equality. It establishes the gate, not the measured error rate. [cite: policy.md:1]

Inference: prioritize the current counts over the explicitly superseded cache for this assessment. The unchanged timestamp does not make the records equivalent or independently corroborated: schema, content, and status differ. Revision order alone does not prove when the underlying events occurred. [cite: current.json:1; cached.json:1]

## Claim checks and arithmetic

| Summary claim or required condition | Evidence and calculation | Finding |
| --- | --- | --- |
| Error rate is 80 basis points | Cache: 80 / 100 = 0.80%. Current: 200 / 20,000 = 0.01 proportion = 1.00% = 100 basis points. [cite: cached.json:1; current.json:1] | Inference: supported only by the superseded cache, contradicted as a current value. |
| Error rate is below 1% | Current rate minus threshold = 1.00% − 1.00% = 0 percentage points, or 0 basis points. The predicate is `<`, not `<=`; equality fails. [cite: current.json:1; policy.md:1] | Fails. |
| Open P1 incidents equal 0 | Current `openP1` = 0; required value = 0; difference = 0 incidents. [cite: current.json:1; policy.md:1] | Passes. |
| We can release | Required conjunction: `(200 / 20,000 < 0.01) AND (0 == 0)` = false. [cite: current.json:1; policy.md:1] | Inference: not supported; the current record fails the rule. |
| The measurement was “yesterday” | Both files provide only `observedAt: 2026-10-09T09:00:00Z`; neither gives a request-window date. [cite: current.json:1; cached.json:1; summary.md:1] | Unverified as an event-period claim. |

The current rate exceeds the cached rate by **20 basis points (0.20 percentage points)**. This compares recorded values, not a demonstrated time-series deterioration: the records have the same observation timestamp and no stated measurement windows. Counts and rates are kept separate; no gross/net classification or adjustment is supplied. [cite: current.json:1; cached.json:1]

At the fixed denominator of 20,000 requests, strict passage would require fewer than 200 failures, hence at most 199: 199 / 20,000 × 100 = 0.995%. The current count is one failure above that maximum passing integer count. This arithmetic is not permission to remove a failure, alter the denominator, or predict a later measurement. [cite: current.json:1; policy.md:1]

Date clarification: the assessment date supplied in the session is October 9, 2026, so “yesterday” relative to this assessment means October 8, 2026. [cite: user-provided environment_context, current_date] The recorded observation is October 9, 2026 at 09:00 UTC, or 05:00 in the supplied America/New_York timezone, also October 9. That does not establish when the counted requests occurred. [cite: current.json:1; cached.json:1; user-provided environment_context, timezone] The summary's authorship date and intended measurement day remain unknown; a dated summary and explicit request-window boundaries would settle them. [unverified]

## Disconfirmation pass

**H1, best-supported explanation:** the summary carries forward a superseded rate and its approval does not hold against current counts. A matching current rate below the strict threshold, or a policy allowing equality, would refute this; inspection found neither. Attribution of the summary to the cache remains inference, not a documented edit history. [cite: summary.md:1; cached.json:1; current.json:1; policy.md:1]

**H2, strongest rival:** the summary accurately describes a different earlier interval, and the current counts concern another population. Explicit interval labels or a dated earlier record could support this; matching population/window evidence could refute it. Inspection of every supplied evidence file found no interval definitions, so this rival cannot be ruled out historically, but it cannot establish current release eligibility. [cite: summary.md:1; cached.json:1; current.json:1; policy.md:1]

| Evidence inspected | H1: superseded rate used for current approval | H2: distinct earlier interval |
| --- | --- | --- |
| Cache explicitly superseded; summary matches its 80-basis-point value. [cite: cached.json:1; summary.md:1] | Consistent | Consistent, but does not establish an interval |
| Current counts imply 100 basis points. [cite: current.json:1] | Consistent | Consistent if populations differ |
| Observation timestamps identical; no request-window bounds. [cite: cached.json:1; current.json:1] | Consistent | Silent about actual event intervals |
| Policy explicitly rejects equality. [cite: policy.md:1] | Consistent with rejection of current approval | Inconsistent with relying on the current rate for approval; silent on historical eligibility |

Inference: the pass leaves current gate failure intact, but narrows the historical claim: the evidence does not prove the rate was never 80 basis points, nor that it rose over time. [cite: cached.json:1; current.json:1; policy.md:1]

## Single-source dependencies and evidence limits

- Current counts and open-P1 status each have only one supplied record. Independent telemetry and an incident register could exist, but none is supplied or identified. These underlying operational facts have not been independently corroborated. [cite: current.json:1]
- The release threshold has only the supplied policy as its authority; no independently maintained policy or approval record is identified. [cite: policy.md:1]
- The summary and cache agree numerically, but their upstream provenance is unspecified. Treat them as potentially dependent, not two independent confirmations. [cite: summary.md:1; cached.json:1]
- Request-window bounds, raw request records, service/region breakdowns, summary authorship date, and revision history are **not recorded in the supplied collection**. Whether they exist elsewhere is unknown. Historical and population-specific coverage is therefore thinner than the aggregate observation. Absence is not evidence that an event did not happen. [cite: summary.md:1; cached.json:1; current.json:1]
- All four supplied release-evidence files were opened in full. A public arithmetic lookup was attempted with query `calculator: 200 / 20000 * 100`; no result content was observed or used. Local decimal arithmetic and timezone conversion were executed successfully. No live telemetry endpoint was supplied, so “current” here means the provided current record, not a independently refreshed production reading. [cite: current.json:1]

## Strongest objection

The current record is an aggregate without request-window metadata or independent authentication, so it may not describe the summary's intended historical interval. That limits historical conclusions. It does not support overriding either the explicit superseded status or the explicit equality-fails policy when assessing reliance on the supplied current records. Inference: current approval remains unsupported. [cite: current.json:1; cached.json:1; summary.md:1; policy.md:1]

## Recommendation and pre-mortem

Recommendation: treat the release summary as unsuitable for current approval. Suggested replacement: “The supplied current record, observed October 9, 2026 at 09:00 UTC, reports 200 failures out of 20,000 requests: 1.00% (100 basis points). Open P1 incidents are 0. The release gate fails because the error rate must be strictly below 1%; equality fails. The request measurement interval is unspecified.” This is a proposed correction, not an executed edit to the summary or a release action. [cite: current.json:1; policy.md:1]

Pre-mortem, inference: the most likely reliance failure is treating the matching timestamps as proof the cache is still valid, then carrying its 0.80% approval forward despite the current 1.00% result. The best alternative is the explicit current-count calculation against the strict predicate; accepted with controls that distinguish observation date from measurement interval and avoid claiming independent operational verification. No additional user decision is needed to complete this assessment. [cite: cached.json:1; current.json:1; policy.md:1]

## Verification record

- Claims cited: answered; see “Claim checks and arithmetic” and source markers throughout.
- Source classes: answered; see “Record,” “Derived record,” and “Aggregator/claim under review”; observation dates distinguished from event periods.
- Independence: answered; see “Single-source dependencies and evidence limits.”
- Disconfirmation: answered; see “H1, best-supported explanation” and “H2, strongest rival”; current conclusion not reversed, historical inference narrowed.
- Coverage frame: answered; see “request population represented by `current.json`” and classified absences.
- Ground exhausted: answered; see “All four supplied release-evidence files were opened in full.”
- Strongest objection: answered; see “aggregate without request-window metadata.”
- Pre-mortem: answered; see “treating the matching timestamps as proof the cache is still valid.”
- Handbacks: none; evidence limitations do not block this assessment.
- Quantities: answered; see “1.00% (100 basis points),” threshold distance, cache difference, and fixed-denominator integer boundary.
- Action scope: answered; see “verification only, not release authorization or execution.”
- Lookup observations: public arithmetic query produced no observed result content; no external result used. Findings rest on opened local records, with local arithmetic checks.
