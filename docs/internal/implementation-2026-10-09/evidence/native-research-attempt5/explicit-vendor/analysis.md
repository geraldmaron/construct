# Finding: rate reduction supported; count reduction and causation are not

**Inference / recommendation:** Do not cite the vendor claim as written. The supplied totals support a 50% relative reduction in the failed-job rate, not a reduction in the number of failed jobs, and do not establish that a migration caused the difference. [cite: request.md; record.json, periodA and periodB]

## Scope and source classes

This review covers only the aggregate jobs and failures labeled `periodA` and `periodB` in the supplied record; geography, period boundaries, workload composition, and migration timing are unspecified, and external investigation is excluded by the request. [cite: record.json; request.md]

- **Record:** `request.md` is the primary record of the requested verification and its claim that Vendor Delta says a migration cut failed jobs by 50%; it is not evidence of the migration's effect. [cite: request.md]
- **Record:** `record.json` is the supplied aggregate data record, not underlying job-level telemetry. It labels its owner `operations` and its observation date (`observedAt`) `2026-10-09`; that date is not a stated migration date or either period's boundary. [cite: record.json]
- **Aggregator:** `vendor.md` is a marketing summary saying failures were cut in half and naming `record.json` as its basis. [cite: vendor.md]
- **Aggregator:** `press.md` describes a press article repeating `vendor.md` without independent measurements. [cite: press.md]

## What the arithmetic establishes

| Metric | Period A | Period B | Change |
|---|---:|---:|---|
| Jobs | 1,000 | 2,000 | Doubled [cite: record.json, periodA.jobs and periodB.jobs] |
| Failed jobs | 80 | 80 | No change [cite: record.json, periodA.failed and periodB.failed] |
| Failed-job rate, calculated | 8% | 4% | Down 4 percentage points; 50% relative reduction [cite: record.json, periodA and periodB] |

**Inference (arithmetic):** `80 / 1000 = 8%`; `80 / 2000 = 4%`; `(8% - 4%) / 8% = 50%`. The failed-job count reduction is `(80 - 80) / 80 = 0%`. These calculations were checked directly against the JSON values. [cite: record.json, periodA and periodB]

## Independence and single-source list

**Inference:** The apparent chain is `record.json → vendor.md → press.md`. These are not three independent measurements: the marketing names the record as its basis, and the press summary explicitly reports no independent measurements. [cite: vendor.md; press.md; record.json]

- **Single-source numerical finding:** All counts and calculated rates depend on `record.json`. Independent telemetry or an audit could exist, but neither is supplied; their existence is unknown. [cite: record.json; vendor.md; press.md] [unverified] A separately collected job ledger or audit reconciliation would test these aggregates.
- **Single-source migration assertion:** The migration framing appears in `request.md`; the other supplied files do not document a migration or its effect. This is absence from this collection, not proof that no migration happened. [cite: request.md; vendor.md; press.md; record.json] [unverified] A migration change record tied to the measured periods would settle timing, though not causation by itself.

## Disconfirmation pass

**Hypothesis A, lean interpretation (inference):** The claim overstates a descriptive rate comparison. The same number of failures is divided by more jobs; the cause of the rate difference remains unknown. A comparable count showing fewer failures would refute the count finding; credible causal evidence would refute the causal uncertainty. I sought both in every supplied substantive file and found neither. [cite: request.md; vendor.md; press.md; record.json]

**Hypothesis B, strongest rival (inference):** The vendor intended “failure rate,” and the migration genuinely improved reliability while job volume grew. The aggregates are compatible with this interpretation. A non-decreasing rate would refute its numerical part; timing showing the migration occurred after measurement, or evidence that the difference arose from measurement or workload changes, could undermine its causal part. I checked for those facts: the rate does decrease, but the supplied files contain no timing, measurement-definition, or workload evidence to resolve causation. [cite: request.md; vendor.md; press.md; record.json]

| Evidence | Hypothesis A: descriptive comparison, cause unknown | Hypothesis B: migration improved failure rate |
|---|---|---|
| Equal failed-job counts, doubled jobs [cite: record.json] | Consistent | Consistent if the claim means rate, not count |
| Calculated rate falls from 8% to 4% [cite: record.json] | Consistent | Consistent, not causal proof |
| Marketing repeats “cut in half” [cite: vendor.md] | Consistent | Consistent, not discriminating evidence |
| No independent press measurements [cite: press.md] | Silent on cause | Silent on cause |
| No migration timing, workload detail, or comparison control in the collection [cite: request.md; vendor.md; press.md; record.json] | Silent on actual cause | Silent on actual cause |

**Inference / disconfirmation result:** The rival weakens a blanket verdict that the claim is false: a rate-based reading is numerically correct. It does not rescue a count-based reading or establish migration causation. The final finding is therefore narrower than outright rejection of every interpretation. [cite: record.json; request.md; vendor.md]

## Coverage and absences

- **Not-recorded in the supplied collection:** Period dates and durations, migration timing, job eligibility rules, failure definitions, workload mix, and a control or counterfactual. No item is classified as “did-not-happen.” [cite: request.md; vendor.md; press.md; record.json]
- **Not-yet-collected for this review:** Underlying telemetry and independent audit or migration records. Whether such records exist is unknown; external collection was not attempted because the request prohibits it. [cite: request.md; record.json; vendor.md; press.md]
- **Inference / coverage skew:** The collection preserves the vendor's promotional interpretation but offers only aggregate operational data, with no job-level or customer-level evidence. It cannot establish whether workloads are comparable or whether all affected customers experienced an improvement. [cite: vendor.md; press.md; record.json]

## Strongest objection

**Inference:** My strongest objection is that “a migration cut failed jobs by 50%” makes both a count claim and a causal claim that these records cannot sustain. Failed jobs remain at 80 in each period; the denominator doubles. Even accepting the charitable interpretation of “failure rate,” the arithmetic cannot identify why the rate fell. [cite: request.md; record.json]

**Inference / strongest objection to this finding:** The vendor may have meant rate, and the migration may actually have caused the improvement. The supplied aggregates do not contradict that possibility. Accordingly, this finding does not allege deception or conclude that the migration had no benefit. [cite: request.md; vendor.md; record.json]

## Supported wording and pre-mortem

**Recommendation:** If citing these materials, use: “In the supplied aggregate record, failed jobs were 80 out of 1,000 jobs in period A and 80 out of 2,000 in period B. The recorded failure rate fell from 8% to 4%, a 50% relative reduction; the failed-job count was unchanged.” [cite: record.json, periodA and periodB]

**Inference / pre-mortem:** This narrower wording could still mislead if readers assume the periods are comparable or attribute the change to migration. The most plausible failure is that different job mixes or measurement rules explain the rate difference. Keep the qualification that comparability and causation are not established by these records. [cite: record.json; request.md]

## Ground exhausted and earned handback

All supplied substantive documents were opened in full: `request.md`, `vendor.md`, `press.md`, and `record.json`. Their entire numerical evidence was checked. No external action was taken. [cite: request.md; vendor.md; press.md; record.json]

**Unsettled:** Whether migration caused the rate change. [unverified] Resolving this needs authorized access to migration timing, comparable measurement definitions and workloads, and evidence addressing alternative explanations; those are not supplied, and seeking them externally is outside the permitted scope. [cite: request.md; record.json]

## Verification record

- Claims cited: answered — see “What the arithmetic establishes” and claim-level markers throughout.
- Source classes: answered — see “Scope and source classes”; `observedAt` is identified as an observation date.
- Independence: answered — see “Independence and single-source list”; copies are not corroboration.
- Disconfirmation: answered — see “Disconfirmation pass”; reversed the draft conclusion: no; weakened a blanket false-claim verdict: yes.
- Coverage frame: answered — see “This review covers only” and “Coverage and absences.”
- Ground exhausted: answered — see “All supplied substantive documents were opened in full.”
- Strongest objection: answered — see “Strongest objection,” including the objection to this finding.
- Pre-mortem: answered — see “Supported wording and pre-mortem.”
- Handbacks: listed at “Unsettled”; causal attribution requires evidence outside the authorized collection.
