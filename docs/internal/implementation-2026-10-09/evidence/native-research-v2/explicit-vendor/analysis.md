# Finding: the rate halved; fewer failures and migration causation are not established

**Recommendation:** Do not cite the vendor claim as written. **Inference:** The supplied totals support a halving of the failed-job rate, not the failed-job count, and do not establish that a migration caused the change. [cite: request.md; vendor.md; record.json]

Suggested wording, limited to the supplied record: “The recorded failed-job rate was 8% in period A and 4% in period B, a 50% relative reduction (4 percentage points). Each period recorded 80 failed jobs; total jobs increased from 1,000 to 2,000.” [cite: record.json, periodA and periodB; calculations below]

## Scope and source authority

Coverage is limited to the aggregate jobs in the two supplied period buckets; geography, calendar boundaries, durations, job definitions, and migration timing are not recorded. No external lookup or action was undertaken, as requested. [cite: record.json; request.md]

- **Record of the requested claim:** `request.md` attributes to Vendor Delta the claim that a migration cut failed jobs by 50%; it establishes what is being checked, not the empirical truth. [cite: request.md]
- **Record, supplied aggregate:** `record.json` directly supplies the job and failure counts and labels its owner `operations`. Its `observedAt` field is October 9, 2026, an observation-date label, not a period boundary or migration date; the file provides no independent authentication or collection method. [cite: record.json]
- **Aggregator, vendor marketing:** `vendor.md` says failures were cut in half and explicitly bases that assertion on `record.json`. It is direct evidence of the marketing wording, not an independent measurement. [cite: vendor.md]
- **Aggregator, press:** `press.md` explicitly repeats `vendor.md` without independent measurements. [cite: press.md]

**Inference:** For the numerical comparison, the aggregate record is more direct than either restatement. The marketing and press chain adds no independent corroboration; there is one measurement source, not three. The migration attribution appears in the requested claim but has no supporting migration record in the supplied collection. [cite: record.json; vendor.md; press.md; request.md]

## Quantitative reconciliation

The units are total jobs and failed jobs within each labeled period. Rates use all recorded jobs in the same period as their denominator, not elapsed time. Whether the buckets have comparable durations, workloads, or counting rules is unknown; no gross/net or retry adjustment is supplied. [cite: record.json]

| Measure | Period A | Period B | Comparison |
|---|---:|---:|---|
| Total jobs | 1,000 | 2,000 | +1,000 jobs; +100% |
| Failed jobs | 80 | 80 | 0 fewer jobs; 0% reduction |
| Failed-job rate | 80 / 1,000 = 8% | 80 / 2,000 = 4% | 4 percentage points lower; 50% relative reduction |

All table inputs and calculations derive solely from the supplied period totals. [cite: record.json, periodA and periodB]

- Count reduction: `(80 − 80) / 80 = 0%`. For a count reduction of at least 50%, period B would need to record at most `80 × 0.5 = 40` failures; the observed count is 40 failures above that boundary. This is an arithmetic comparison, not an estimate of failures prevented. [cite: record.json, periodA.failed and periodB.failed]
- Rate reduction: `(0.08 − 0.04) / 0.08 = 50%`; absolute difference: `8% − 4% = 4 percentage points`. The rate is exactly at the half-rate boundary of 4%, with zero distance from that boundary. [cite: record.json, periodA and periodB]
- **Inference:** A claim about failures per hour, total failures avoided, or migration impact cannot be calculated from these aggregates because the required time basis and counterfactual are absent. [cite: record.json]

## Disconfirmation pass

**H1, lean interpretation:** The vendor wording overstates what the record establishes by conflating count with rate and attributing the change to migration. **H2, strongest rival:** “Failed jobs” is shorthand for failure rate, and a migration really caused the improvement, with supporting context omitted from this collection. These are competing interpretations, not established facts. [cite: request.md; vendor.md; record.json]

| Evidence | H1: claim overstates supplied support | H2: shorthand plus genuine migration effect |
|---|---|---|
| Equal failure counts, doubled total jobs | Consistent | Consistent with rate shorthand |
| Rate is exactly half | Consistent with metric conflation | Consistent with numerical rate claim |
| No migration timing, intervention comparison, or workload detail | Consistent with insufficient support, not proof of no effect | Silent on whether the effect is genuine |
| Press repeats vendor without measurements | Consistent with no independent corroboration | Silent on causation |

The table is an inference-based comparison of the supplied record and restatements. [cite: record.json; vendor.md; press.md; request.md]

- **Refuter sought for H1:** An explicit rate definition, a lower failure count, or migration evidence tying comparable periods to the intervention. All supplied substantive files were read; the equal counts contradict a count reduction, while no rate definition or causal evidence is supplied. [cite: request.md; vendor.md; press.md; record.json]
- **Refuter sought for H2:** Arithmetic inconsistent with a halved rate, an explicit count-only definition, or evidence that the change preceded migration. The rate arithmetic fits H2; neither a count-only definition nor migration chronology is recorded. H2 remains possible but its causal component is unverified. [cite: request.md; vendor.md; record.json]

**Inference:** The rate-only reading survives the strongest numerical challenge; the count-reduction reading does not. Neither hypothesis settles actual causation. The pass narrows any blanket rejection of the vendor's number: 50% is defensible for relative rate, but not for failure count or as proof of migration impact. No initial finding was reversed; its defensible scope is explicitly limited. [cite: record.json; request.md; vendor.md]

## Strongest objection

The strongest objection to this finding is that a reasonable reader might understand “cut failed jobs by 50%” as a reduction in failure probability rather than raw count. On that reading, the supplied rate arithmetic is exactly right; unchanged failures at twice the recorded job volume can be consistent with an improvement. **Inference:** This prevents calling the numerical claim wholly false or accusing the vendor of deception. It still does not establish comparability or that migration caused the change, so an unqualified causal citation would exceed the evidence. [cite: request.md; vendor.md; record.json]

## Single-source dependencies and absences

- **Counts and rates:** All depend on `record.json`; vendor and press are downstream copies. An independent source could exist in separately collected job-level execution or monitoring records, but none is supplied. [cite: record.json; vendor.md; press.md]
- **Migration attribution:** Present in the requested claim, not supported by an intervention record. Independent deployment/change records could establish timing; an appropriately controlled comparison could test attribution. Their existence and contents are unknown. [cite: request.md; record.json]
- **Not-recorded:** Period dates/durations, migration timing, workload mix, failure definitions, retries, collection method, and causal comparison are missing from this collection. This classification does not mean they were never recorded elsewhere. [cite: record.json; vendor.md; press.md; request.md]
- **Not-yet-collected in this investigation:** Independent operational or intervention evidence; external collection is excluded by the request. **Did-not-happen:** No event absence is established. [cite: request.md; record.json; vendor.md; press.md]
- **Inference, coverage skew:** Marketing and press provide repeated narrative, while the operational perspective is limited to a single aggregate file and a self-labeled owner. Individual jobs and differing workload groups have no separate representation, so no subgroup or broader-population conclusion is warranted. [cite: record.json; vendor.md; press.md]

## Limits, pre-mortem, and action boundary

**Unverified:** Whether migration caused the rate change. Dated intervention evidence and a comparison that addresses changes in workload and measurement would be needed to settle that attribution; the supplied-files-only scope cannot provide them. This is the material prerequisite only if the original causal claim must be retained, not a request to collect new evidence or contact anyone. [unverified]

**Recommendation pre-mortem:** Even the narrower wording could mislead if presented as comparable before/after performance when period definitions or job mix differ. **Inference:** The likely failure is a correct aggregate calculation being mistaken for a causal result. Control: retain “recorded,” the period labels, denominators, and unchanged counts, and omit migration attribution. [cite: record.json; request.md]

This deliverable verifies supplied evidence and proposes qualified wording only. It does not authorize publication, vendor contact, external research, or operational action. [cite: request.md]

## Verification record

- Claims cited: answered — see “Quantitative reconciliation” and inline source markers.
- Source classes: answered — see “Scope and source authority”; observation date distinguished from event dates.
- Independence: answered — see “one measurement source, not three” and “Single-source dependencies and absences.”
- Disconfirmation: answered — see “Disconfirmation pass”; reversed the draft conclusion: no, narrowed the supported interpretation.
- Coverage frame: answered — see “Coverage is limited” and classified absences.
- Ground exhausted: answered — all four supplied substantive files opened and read: `request.md`, `record.json`, `vendor.md`, `press.md`.
- Strongest objection: answered — see “Strongest objection.”
- Pre-mortem: answered — see “Recommendation pre-mortem.”
- Handbacks: conditional prerequisite only — see “Whether migration caused the rate change”; no additional access is needed for the aggregate finding.
- Quantities: answered — see “Quantitative reconciliation”; arithmetic checked directly from the JSON with Node.
- Action scope: answered — see “verifies supplied evidence and proposes qualified wording only.”
- Lookup observations: no external lookup used; local document reads returned contents, and the arithmetic check returned 8%, 4%, 0% count reduction, 50% relative rate reduction, and a 40-failure gap from the half-count boundary. [cite: record.json; calculations in “Quantitative reconciliation”]
