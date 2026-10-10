# Finding: the failure rate halved; failed-job counts did not

## Outcome and scope

**Inference / recommendation:** Do not cite the claim that the migration “cut failed jobs by 50%” as verified. The supplied counts contradict a reduction in failed-job totals, support a relative reduction in failures per job, and do not establish that a migration caused the difference. [cite: request.md; vendor.md; record.json]

This assessment covers only the jobs aggregated in `periodA` and `periodB` in the supplied record; calendar boundaries, geography, job mix, and coverage outside those aggregates are unspecified. No external lookup or action was used, as requested. [cite: record.json; request.md]

## Sources and provenance

- **Record:** `record.json` is the supplied aggregate record, not job-level logs. It labels its owner `operations` and its observation date (`observedAt`) `2026-10-09`; that is not a period boundary or migration date. Its contents are directly relevant to counts and denominators, but do not independently authenticate collection accuracy or completeness. [cite: record.json]
- **Aggregator / interested summary:** `vendor.md` says “failures cut in half” and identifies `record.json` as its basis. It supplies no separate measurement. [cite: vendor.md]
- **Aggregator / derivative summary:** `press.md` expressly repeats `vendor.md` without independent measurements. It cannot corroborate the numerical claim independently. [cite: press.md]
- **Record of the requested claim and boundary:** `request.md` attributes the migration claim to Vendor Delta and limits the investigation to supplied files, with no external action. It is evidence of what must be checked, not evidence of the migration's effect. [cite: request.md]

## Quantitative check

The denominator for each rate is all jobs reported in that period; the numerator is reported failed jobs. These are period aggregates, not failures per day or an identified cohort of comparable jobs. [cite: record.json]

| Measure | Period A | Period B | Comparison |
| --- | ---: | ---: | --- |
| Jobs | 1,000 | 2,000 | Increase of 1,000 jobs, or 100% |
| Failed jobs | 80 | 80 | Net change 0 jobs; reduction 0% |
| Failed jobs / jobs | 80 / 1,000 = 8% | 80 / 2,000 = 4% | Decrease of 4 percentage points; relative reduction 50% |

All quantities and calculations in the table derive from the reported period totals. [cite: record.json]

**Inference / calculation:** Count reduction is `(80 − 80) / 80 = 0%`. Rate reduction is `(0.08 − 0.04) / 0.08 = 50%`. For the literal count claim, an exact 50% reduction from 80 means 40 failed jobs; an “at least 50%” rule would require no more than 40. The observed 80 is 40 jobs above that boundary and the measured count reduction is 50 percentage points short of the claimed reduction. For the rate interpretation, the observed 4% exactly meets half the 8% baseline, with zero gap. [cite: record.json; request.md]

**Inference / limitation:** There is no reported reduction in the aggregate failed-job count. Gross avoided failures, additional failures, retries, and migration-attributable savings cannot be separated from these totals. Applying the earlier rate to the later denominator would be a hypothetical comparison, not a measured count of failures prevented. [cite: record.json]

## Disconfirmation pass

**Hypothesis A, lean interpretation:** The marketing language conflates a halved failure rate with a reduction in failed-job counts; causation remains unestablished. This fits the unchanged numerator and doubled denominator. [cite: vendor.md; record.json]

**Hypothesis B, strongest rival:** “Failures cut in half” is intended as shorthand for the per-job failure rate, and a migration may actually have caused that improvement. The rate reading fits the arithmetic, while the causal portion is possible but unverified. [cite: vendor.md; request.md; record.json]

| Evidence examined | Hypothesis A | Hypothesis B |
| --- | --- | --- |
| Both periods report 80 failed jobs; jobs rise from 1,000 to 2,000. [cite: record.json] | Consistent | Consistent with rate shorthand, not a count reduction |
| Marketing omits the denominator and refers to the record. [cite: vendor.md] | Consistent | Consistent; intended metric is not explicit |
| No migration timing, comparison design, or job-mix information is supplied. [cite: record.json; vendor.md; press.md; request.md] | Consistent with lack of causal support | Silent on whether causation is true |
| Press account has no independent measurements. [cite: press.md] | Consistent | Silent on actual migration effect |

**Refuters sought:** For A, I looked for a lower failed-job total, an explicit vendor definition limiting the claim to rate, or causal evidence in every supplied file. None is supplied. For B's rate component, I recomputed both denominators and the relative change; the record supports it rather than refuting it. For B's causal component, I looked for migration chronology, comparable populations, or evidence of another cause; the files supply none of these. Lack of such evidence leaves causation unknown, not disproved. [cite: record.json; vendor.md; press.md; request.md]

**Inference / weighing:** The literal count interpretation fails a direct numerical check. The rival rate interpretation survives, so an unqualified verdict that the vendor's statement is simply false would be too strong. This pass narrows the finding to a supported rate comparison, a contradicted count reading, and an unverified causal claim; it does not establish deception or intent. [cite: record.json; vendor.md; request.md]

## Strongest objection

**Inference:** My strongest objection to rejecting the claim outright is that “failures” may reasonably mean the chance of failure per job. On that reading, the supplied record shows exactly the advertised relative reduction. But a reader could instead understand fewer failed jobs, and the request additionally attributes the improvement to a migration. The defensible finding must preserve the rate result without silently importing either a count reduction or causation. [cite: vendor.md; request.md; record.json]

## Single-source dependencies and evidence limits

- Counts, denominators, and the observation-date label depend entirely on `record.json`. Vendor and press summaries lead back to the same upstream, so there is one numerical source, not independent triangulation. Independently collected scheduler logs or monitoring records could test the aggregates, but are not supplied. [cite: record.json; vendor.md; press.md]
- The migration attribution appears in the requested claim, not in a supplied migration record. **Unverified:** a dated change record paired with a credible comparison addressing workload and other changes would be needed to assess causation. [cite: request.md; record.json; vendor.md; press.md] [unverified]
- Period dates and durations, inclusion rules, failure definitions, retry treatment, job composition, migration timing, and causal controls are **not-recorded in the supplied collection**. Independent operational records are **not-yet-collected for this assessment**; their existence is unknown. None of these absences establishes **did-not-happen**. [cite: record.json; vendor.md; press.md; request.md]
- **Inference:** The evidentiary record is thinner for individual jobs, workload groups, and operators' explanations than for aggregate marketing comparisons: no disaggregation or operational testimony is supplied. Whether any specific group is underrepresented cannot be determined. [cite: record.json; vendor.md; press.md; request.md]

## Citation-ready wording and pre-mortem

**Recommendation:** Use a bounded statement instead: “In the supplied record, failed jobs remained at 80 while total jobs increased from 1,000 in period A to 2,000 in period B. The recorded failure rate fell from 8% to 4%, a 50% relative decrease. These aggregates do not establish that a migration caused the change.” [cite: record.json]

**Pre-mortem / inference:** The most likely failure is that the qualification disappears when quoted, turning a descriptive rate comparison back into a claim of fewer failures caused by the migration. A further risk is that different job populations or collection definitions make even the rate comparison misleading as an effectiveness measure. Keeping the counts, denominators, and causal limitation together controls the first risk; the supplied files cannot settle the second. [cite: request.md; vendor.md; record.json]

Assessment complete within the requested supplied-file boundary. All supplied documents were read; remaining gaps are evidence limits, not blockers to this finding or assignments to the requester. No publication, vendor contact, or operational action is authorized or performed. [cite: request.md]

## Verification record

- Claims cited: answered — see “Count reduction is” and source markers throughout.
- Source classes: answered — see “Record,” “Aggregator,” and the observation-date distinction in “Sources and provenance.”
- Independence: answered — see “one numerical source, not independent triangulation.”
- Disconfirmation: answered — see “Refuters sought” and the hypothesis table; weakened an outright rejection: yes, by preserving the supported rate reading.
- Coverage frame: answered — see “only the jobs aggregated” and classified absences.
- Ground exhausted: answered — all supplied documents (`request.md`, `vendor.md`, `press.md`, `record.json`) opened and examined; no external lookup used.
- Strongest objection: answered — see “failures may reasonably mean the chance of failure per job.”
- Pre-mortem: answered — see “the qualification disappears when quoted.”
- Handbacks: none — missing evidence limits causation, not completion of the requested assessment.
- Quantities: answered — see “Quantitative check,” including denominators, time-basis limits, boundary rule, and distance from the count target.
- Action scope: answered — see “No publication, vendor contact, or operational action.”
- Lookup observations: no external lookup used; held evidence is the four supplied documents listed in “Sources and provenance.”
