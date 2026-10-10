# Attendance claim: unsupported for all enrolled learners

## Finding

**Inference: the committee should not rely on the claim as written.** The supplied evidence supports self-reported attendance by 90 of 100 survey respondents (90%), not a measured attendance rate of 90% among all 200 enrolled learners. Nonrespondent attendance was not collected. The newspaper repeats the memo rather than independently confirming it. [cite: claim.md; memo.md; attendance.csv; news.md]

Suggested replacement: “Of 200 enrolled learners, 100 responded to the survey, and 90 of those respondents said they attended. Attendance among the remaining 100 learners is unknown. The newspaper attributes its figure to the same memo and reports no independent survey.” [cite: attendance.csv; memo.md; news.md]

## Sources and coverage

This assessment covers the supplied main-cohort enrollment and survey figures associated with the described year-end memo; the records specify neither a calendar year, attendance window, location, nor a definition of attendance. No inference is made about other cohorts or periods. [cite: claim.md; attendance.csv; memo.md]

- **Record of the assertion:** `claim.md` asserts both an all-enrolled attendance rate and independent newspaper confirmation; it is the claim under examination, not proof. [cite: claim.md]
- **Record, aggregate survey account:** `memo.md` says 90 of 100 respondents reported attending and explicitly states that nonrespondent attendance was not collected. It does not supply individual responses or direct attendance observations. [cite: memo.md]
- **Record, aggregate tabulation:** `attendance.csv` lists the main cohort with 200 enrolled, 100 respondents and 90 attended. Its provenance and independence from the memo are unspecified; the memo supplies the respondent context for interpreting the matching attendance count. [cite: attendance.csv; memo.md]
- **Aggregator:** `news.md` attributes its 90% to the year-end memo and explicitly says no independent survey was conducted. [cite: news.md]

**Inference on independence:** the newspaper and memo form one evidentiary chain, not two independent measurements. The CSV is numerically consistent with the memo, but cannot be counted as independent corroboration without provenance. [cite: memo.md; news.md; attendance.csv]

## Quantitative reconciliation

All counts below are learners in the supplied main cohort. The time basis is unspecified. Calculations interpret the CSV attendance count as the memo's respondent self-reports, not verified physical attendance. [cite: attendance.csv; memo.md]

| Quantity | Calculation | Meaning |
| --- | --- | --- |
| Respondent attendance | 90 / 100 = 90% | Rate among respondents only |
| Survey response rate | 100 / 200 = 50% | Half the enrollment responded |
| Nonrespondents | 200 − 100 = 100 | Attendance unknown |
| Reported attendees as share of enrollment | 90 / 200 = 45% | Not a measured full-cohort attendance rate |
| Conditional full-cohort bounds | 90 / 200 to (90 + 100) / 200 = 45%–95% | None to all of the nonrespondents attended |
| Requirements for exactly 90% overall | 0.90 × 200 = 180; 180 − 90 = 90 | Would require 90 of the 100 nonrespondents to have attended |

Source for all inputs and derived calculations in the table: [cite: attendance.csv; memo.md]

**Inference:** conditional on accurate respondent reports and exhaustive binary attendance categories, the full-cohort rate can lie anywhere from 45% to 95%, inclusive. These are missing-data bounds, not a confidence interval. The claimed 90% lies 45 percentage points above the lower bound and 5 below the upper bound: it is possible, but not established. The ten respondents outside the reported attendance count are treated as nonattenders only for these conditional bounds. [cite: attendance.csv; memo.md]

## Disconfirmation pass

**H1, supported explanation:** the claim expands a respondent percentage to all enrollment and mistakes republication for independent confirmation. This would be refuted by complete-cohort attendance evidence or a genuinely independent newspaper measurement. All supplied files were checked for those features; the memo identifies uncollected attendance and the newspaper disclaims an independent survey. [cite: claim.md; memo.md; news.md; attendance.csv]

**H2, strongest rival:** the actual full-cohort attendance rate happens to be 90%, because 90 nonrespondents also attended. This would be refuted, under the stated assumptions, by a nonrespondent attendance total other than 90. The supplied records contain no such total, so this rival remains possible but unverified. [cite: attendance.csv; memo.md]

| Evidence checked | H1: unsupported extrapolation | H2: actual overall rate happens to be 90% |
| --- | --- | --- |
| 90 attendees among 100 respondents; 200 enrolled | Consistent | Consistent, but insufficient |
| Nonrespondent attendance not collected | Consistent | Silent on actual nonrespondent attendance |
| Newspaper attributes rate to memo; no independent survey | Consistent | Silent on actual overall rate; does not corroborate it |

Evidence for the comparison: [cite: attendance.csv; memo.md; news.md]

**Inference after disconfirmation:** no reversal of the unsupported-claim finding is warranted. The evidence does not prove that the true rate differs from 90%; it proves that the supplied basis does not establish that rate for everyone. The independent-confirmation portion is contradicted by the newspaper's own description of its sourcing. [cite: memo.md; attendance.csv; news.md]

## Strongest objection

“The respondents might accurately represent everyone.” That is possible, and the conditional bounds permit 90% overall. But the supplied records offer neither nonrespondent outcomes nor a sampling or response-bias basis for generalizing. Representativeness cannot be substituted for observation. **Inference:** retain the respondent-only wording rather than asserting either 90% or 45% as the actual cohort rate. [cite: memo.md; attendance.csv]

## Single-source dependencies and evidence limits

- Respondent attendance rests on the aggregate survey account; the matching CSV has unspecified provenance. Independent attendance logs could in principle exist, but none are supplied or identified as reachable. [cite: memo.md; attendance.csv]
- Enrollment rests on the CSV alone. An enrollment register could independently establish it, but no such register is supplied. [cite: attendance.csv]
- Newspaper sourcing rests on the supplied newspaper excerpt, which directly identifies the memo as its source. No separately collected attendance evidence appears there. [cite: news.md]
- Nonrespondent attendance is **not-yet-collected** in this survey, not “did-not-happen.” Their experience is systematically thinner in the record. Individual responses, sampling details and the attendance time window are **not-recorded** in the supplied materials; their existence elsewhere is unknown. [cite: memo.md; attendance.csv; news.md]

All supplied evidentiary files were read. No external lookup was used: the records provide no named institution, publication, event, date or linked primary record for a targeted external resolution. This limits the finding to evidentiary support in the supplied records. [cite: claim.md; memo.md; attendance.csv; news.md]

## Recommendation and pre-mortem

Use the replacement wording in the finding. **Accepted with controls:** preserve the respondent denominator and self-report qualification. The best alternative would be a complete-cohort measurement, but it is unavailable here and not needed to assess this claim. Most likely failure: a later summary drops those qualifications and repeats 90% as a cohort-wide fact; repeating the enrollment and response counts alongside the percentage controls that risk. **Inference:** the supplied evidence supports the narrower statement only. [cite: attendance.csv; memo.md]

This assessment is complete within the supplied-record scope. Missing attendance data remain an evidence limit, not a prerequisite to delivering this finding. No publication, contact, or operational action has been undertaken or authorized.

## Verification record

- Claims cited: answered; see “Finding” and source markers throughout.
- Source classes: answered; see “Sources and coverage.” Calendar and attendance dates are unspecified.
- Independence: answered; see “one evidentiary chain” and “Single-source dependencies.”
- Disconfirmation: answered; see H1/H2 and evidence comparison; reversed the draft conclusion: no.
- Coverage frame: answered; see “supplied main-cohort” and classified absences.
- Ground exhausted: answered; all supplied evidentiary files read, no identified external primary record.
- Strongest objection: answered; see “respondents might accurately represent everyone.”
- Pre-mortem: answered; see “a later summary drops those qualifications.”
- Handbacks: none; unavailable full-cohort data do not block this assessment.
- Quantities: answered; see inputs, denominators, assumptions, inclusive bounds and distances in “Quantitative reconciliation”; arithmetic independently checked with a local calculation.
- Action scope: answered; finding saved and replacement wording proposed, no external action taken.
- Lookup observations: no external lookup used; source results are the four supplied files read locally.
