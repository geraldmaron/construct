# Release summary verification

## Finding

**Inference: the release summary is not reliable for the release decision. The supplied current record fails the release policy.** The error rate is exactly **1%**, not strictly below 1%; zero open P1 incidents satisfies only the other required condition. Recommendation: do not rely on the summary's release clearance. [cite: current.json; policy.md; summary.md]

Verification date: October 9, 2026 (session date). Scope: the supplied release summary, policy, and two local snapshots; this finding covers the requests counted in the current snapshot, not an independently checked live service. No deployment or other operational action was requested or performed.

## Sources and authority

- **Record, governing rule:** `policy.md` requires error rate strictly below 1% **and** open P1 incidents equal to zero; exact equality fails. It defines the decision rule, not the observed service state. [cite: policy.md]
- **Record, current supplied snapshot:** `current.json` has schema revision 2, 200 failed requests, 20,000 total requests, and `openP1: 0`. Its `observedAt` field is October 9, 2026 at 09:00 UTC, an observation timestamp, not a stated measurement-window start or end. [cite: current.json]
- **Record, superseded supplied snapshot:** `cached.json` has schema revision 1, explicit `status: "superseded"`, and error rate 80 basis points. Its observation timestamp is also October 9, 2026 at 09:00 UTC. [cite: cached.json]
- **Aggregator, claim under review:** `summary.md` asserts release clearance because “yesterday” the error rate was 80 basis points, below 1%. It supplies no separate observation or P1 count. [cite: summary.md]

**Inference: use the current request counts for this comparison.** The cache explicitly declares itself superseded, while the current snapshot provides the numerator and denominator under the revised schema. The identical observation timestamps do not establish equal contents or make the superseded value current. A higher schema revision alone would not prove a later measurement; the conflict is preserved rather than explained away. [cite: cached.json; current.json]

## Claim checks and calculations

| Claim or gate | Evidence and calculation | Finding |
| --- | --- | --- |
| Error rate is 80 basis points | Cache: 80 / 10,000 = 0.008 = 0.8%. Current: 200 failed requests / 20,000 total requests = 0.01 = 1% = 100 basis points. | Supported only by the superseded cache; not by the current snapshot. [cite: cached.json; current.json] |
| Error rate is below 1% | Current 1% < 1% is false. Distance to the threshold is zero percentage points; the rule excludes equality. | Error-rate gate fails. [cite: current.json; policy.md] |
| Open P1 incidents equal zero | Current count is 0; distance from the required count of 0 is zero incidents. | P1 gate passes. [cite: current.json; policy.md] |
| We can release | Both gates are required: false AND true = false. | Inference: clearance is contradicted by the supplied current record. [cite: current.json; policy.md; summary.md] |
| The observation was “yesterday” | Relative to the session date October 9, 2026, yesterday is October 8, 2026. Both snapshots instead state an October 9 observation. The summary has no creation date. | Unsupported as a current statement; its original relative-date context cannot be established. [cite: summary.md; cached.json; current.json] |

The current value exceeds the cached value by **20 basis points**, or **0.2 percentage points**: 100 − 80 = 20 basis points. This is a discrepancy between records, not evidence of deterioration over time, because the observation timestamps are unchanged and measurement windows are unspecified. [cite: current.json; cached.json]

At the fixed denominator of 20,000 requests, the strict boundary requires fewer than 200 failures, hence at most 199 integer failures. The current count is one failure above that maximum passing count. This is a mathematical comparison only, not permission to alter records or a prediction about a future sample. [cite: current.json; policy.md]

## Disconfirmation pass

**Hypothesis A:** the current snapshot supersedes the cached basis-point value and fails the gate. Refuters sought: a non-superseded cache, current arithmetic below the limit, or policy language permitting equality. None appears in the supplied records. [cite: current.json; cached.json; policy.md]

**Hypothesis B, strongest rival:** the summary accurately describes a separate earlier measurement and might have been valid in that earlier context. Refuters sought: an explicit superseded flag and the absence of a distinct earlier observation in the provided snapshots. The flag defeats use of the cache as current evidence; the shared timestamp weakens the earlier-measurement explanation. A separate earlier measurement remains unknown, and would not establish current clearance. [cite: summary.md; cached.json; current.json; policy.md]

| Evidence | A: current gate fails | B: separate earlier measurement |
| --- | --- | --- |
| Cache explicitly superseded; revision differs | Consistent | Consistent with an old statement, but not current clearance. [cite: cached.json; current.json] |
| Same observation timestamp in both snapshots | Consistent with revised representation; does not prove why it changed | Inconsistent with treating these snapshots as proof of different observation dates. [cite: cached.json; current.json] |
| Current request counts give exactly 1%; equality fails | Consistent | Silent about historical validity; inconsistent with current clearance. [cite: current.json; policy.md] |
| No summary creation date or measurement window | Silent about the current arithmetic | Silent; leaves historical context unknown. [cite: summary.md; cached.json; current.json] |

**Inference:** the rival does not overcome the direct current calculation and strict rule. The disconfirmation pass does not reverse or weaken the current-gate finding; it limits the conclusion about whether the summary was ever historically accurate. [cite: current.json; cached.json; summary.md; policy.md]

## Coverage, independence, and remaining uncertainty

- **Single-source list:** current error rate and P1 count each rest on `current.json` alone. Independent evidence could exist in upstream request telemetry and the incident register, but neither is supplied or identified by a reachable locator. Their live values are **not-yet-collected**, not independently verified. [cite: current.json]
- **Single-source list:** the release rule rests on `policy.md` alone. A separately maintained approved policy could independently confirm it, but no such source is identified. [cite: policy.md]
- The summary repeats the cache's value, but their provenance is unspecified. Do not count them as independent corroboration. The two snapshots' upstream relationship is likewise unrecorded. [cite: summary.md; cached.json; current.json]
- Measurement window, service/environment, geography, request-selection criteria, and summary creation date are **not-recorded** in these supplied files. Cached data lacks the request counts and incident count, so its collection coverage is thinner than the current snapshot's. No absence is classified as **did-not-happen**. [cite: summary.md; cached.json; current.json]
- All four supplied documents were opened and read. No external lookup was used: no upstream endpoint, service identity, or record locator was supplied. No further prerequisite blocks this bounded finding; a claim about live readiness would require identified telemetry and incident records with appropriate access, outside the completed local verification.

## Strongest objection

The file labeled current could itself be stale or contain bad counts; these records do not independently prove production state. That limits this finding to the supplied snapshot. It does not rescue the summary: the only current supplied numerator and denominator yield a failing rate, and the competing value is explicitly superseded. [cite: current.json; cached.json; summary.md; policy.md]

## Pre-mortem

Most likely failure of the recommendation: a reader treats this snapshot finding as a permanent release prohibition or, conversely, reuses the cached value because its timestamp matches. Control: preserve the observation time, exact counts, superseded status, and strict boundary in any decision context; assess any subsequent record on its own evidence. This report verifies records and recommends against reliance on this summary; it does not authorize a release or operate a system. [cite: current.json; cached.json; policy.md]

## Verification record

- Claims cited: answered — see “Claim checks and calculations.”
- Source classes: answered — see “Sources and authority,” including observation date-kind.
- Independence: answered — see “Single-source list”; no independent corroboration claimed.
- Disconfirmation: answered — see “Disconfirmation pass”; reversed the draft conclusion: no.
- Coverage frame: answered — see “Scope” and “Coverage, independence, and remaining uncertainty.”
- Ground exhausted: answered — “All four supplied documents were opened and read.”
- Strongest objection: answered — see “Strongest objection.”
- Pre-mortem: answered — see “Pre-mortem.”
- Handbacks: none for the bounded verification; live-state limitation identified under “Coverage, independence, and remaining uncertainty.”
- Quantities: answered — see “Claim checks and calculations”; decimal arithmetic checked locally against the JSON records.
- Action scope: answered — “No deployment or other operational action was requested or performed.”
- Lookup observations: no external lookup used; held results are the four local files named under “Sources and authority.”
