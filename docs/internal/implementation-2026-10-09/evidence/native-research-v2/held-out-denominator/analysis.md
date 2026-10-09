# Attendance claim: finding

**Inference: the claim is unsupported as stated.** The supplied memo supports **90% of survey respondents saying they attended**, not 90% of all enrolled learners. The newspaper's claimed independence is contradicted by its explicit attribution to the memo and statement that no independent survey occurred. An enrollment-wide rate of 90% remains possible, but is not established. [cite: claim.md; memo.md; news.md; attendance.csv, main row]

## Scope and source authority

This review covers the supplied main cohort and the memo's unspecified year-end reporting period; no institution, geography, calendar year, or attendance definition is supplied, so the finding does not extend to other populations or periods. [cite: attendance.csv; memo.md; claim.md; news.md]

- **Record of the assertion:** `claim.md` asserts both enrollment-wide attendance and independent newspaper confirmation; it is the proposition being tested, not proof. [cite: claim.md]
- **Record of the memo's statement:** `memo.md` says 90 of 100 respondents reported attending and that nonrespondent attendance was not collected. As attendance evidence, it is a survey summary, not a learner-level attendance register. [cite: memo.md]
- **Derived record:** `attendance.csv` is an aggregate with 200 enrolled learners, 100 respondents, and 90 attended for the main cohort. Its provenance and dates are unspecified. Reading its attended field alongside the memo supports interpreting it as respondent attendance, not a complete census. That interpretation is an inference. [cite: attendance.csv, main row; memo.md]
- **Aggregator:** `news.md` repeats the memo's percentage and explicitly disclaims an independent survey. It has no independent evidentiary priority over the memo for attendance. [cite: news.md]

## Quantitative reconciliation

All counts below are learners, not attendance sessions. Calculations use the supplied cohort counts and assume the memo and CSV describe the same cohort and period; their matching counts support, but do not independently authenticate, that alignment. These are calculations/inferences from the records. [cite: attendance.csv, main row; memo.md]

| Quantity | Calculation | Meaning |
| --- | --- | --- |
| Respondent attendance rate | 90 / 100 = 90% | Self-reported attendance among respondents |
| Response coverage | 100 / 200 = 50% | Half of enrolled learners responded |
| Nonrespondents | 200 - 100 = 100 | Attendance not collected |
| Reported attendees as share of enrollment | 90 / 200 = 45% | Not an estimate that only 45% attended |
| Conditional full-cohort bounds | 90 / 200 to (90 + 100) / 200 = 45%–95% | Unknown nonrespondents contribute between zero and 100 attendees |

Source for every table row: [cite: attendance.csv, main row; memo.md]

The bounds assume the respondent reports are accurate and the remaining 10 respondents did not attend. They are logical bounds, not a confidence interval or independently verified attendance totals. Without those assumptions, actual attendance remains unverified. Nonrespondents have systematically thinner records: their attendance is **not collected**, not evidence of nonattendance. [cite: memo.md; attendance.csv, main row]

For exactly 90% of all enrollment, 0.90 × 200 = 180 attendees would be required: 180 - 90 = 90 of the 100 nonrespondents must also have attended. For an “at least 90%” boundary, at least 90 must have attended. The observed reports alone are 90 learners, or 45 percentage points of enrollment, short of that boundary; this is an evidence gap, not a demonstrated attendance shortfall. [cite: attendance.csv, main row; memo.md]

## Disconfirmation and strongest objection

**H1:** The claim improperly generalizes a respondent percentage. A complete cohort register or documented population estimation method could refute the inference that the supplied basis is insufficient. **H2, strongest rival:** The true enrollment-wide rate happens to be 90%. Under the stated assumptions, a nonrespondent attendance count other than 90 would refute that exact rate. I checked all supplied files for those refuters. [cite: claim.md; memo.md; attendance.csv; news.md]

| Evidence examined | H1: denominator overreach | H2: true rate happens to be 90% |
| --- | --- | --- |
| Memo explicitly limits observations to respondents | Consistent | Consistent, but insufficient |
| Nonrespondent attendance not collected | Consistent | Silent on their actual attendance |
| CSV contains aggregate counts only | Consistent | Silent on missing attendance |
| Newspaper repeats memo without an independent survey | Consistent with lack of additional support | Silent on true cohort rate |

Source for the comparison: [cite: memo.md; attendance.csv; news.md]

**Strongest objection:** Missing data do not prove the enrollment-wide rate is wrong. Accepted: H2 survives, so the finding is “unsupported,” not “false.” The disconfirmation pass limits the verdict without reversing it. The separate independence assertion is contradicted directly by the newspaper text. [cite: memo.md; news.md; attendance.csv]

## Single-source dependencies and remaining limit

The memo and newspaper form one evidence chain; the latter cannot count as corroboration. The CSV agrees numerically, but its independence is unestablished, so it is not treated as a separate attendance measurement. Learner-level survey responses and a contemporaneous attendance register could independently test the counts and missing attendance; neither is supplied or identified by a retrievable institution or record reference. The true cohort rate cannot be settled from these materials. [cite: memo.md; news.md; attendance.csv]

## Committee wording and reliance risk

Recommended wording: “Of 200 enrolled learners, 100 responded to the survey and 90 reported attending: 90% of respondents. Attendance among the other 100 was not collected, so the overall attendance rate is unknown. The newspaper repeats the memo rather than independently confirming it.” [cite: attendance.csv, main row; memo.md; news.md]

**Pre-mortem:** The likely failure is dropping “of respondents” when quoting the result, or treating missing responses as absences. The alternative is the qualified wording above, preserving both the denominator and unknown attendance. **Accepted with controls:** retain those qualifications. This finding does not authorize publication or outreach. [cite: claim.md; memo.md; news.md]

## Lookup observation

A bounded methodological search for `site.census.gov nonresponse bias respondents nonrespondents survey` and an attempted open of a Census Bureau response-rates definitions page produced no visible source content in this session. These are lookup attempts only, not verified results or citations. No external material supports this finding; the supplied records and displayed arithmetic are sufficient for the limited verdict.

## Verification record

- Claims cited: answered; see “finding” and source-marked calculations.
- Source classes: answered; see “Scope and source authority.” No event dates supplied.
- Independence: answered; see “Single-source dependencies.”
- Disconfirmation: answered; see “H1” and “H2”; reversal: no, verdict limited to unsupported.
- Coverage frame: answered; see “main cohort” and “unspecified year-end reporting period.”
- Ground exhausted: answered; all supplied files read in full; external methodology lookup yielded no observable content and is not relied upon.
- Strongest objection: answered; see “Missing data do not prove.”
- Pre-mortem: answered; see “dropping ‘of respondents’.”
- Handbacks: true cohort attendance remains unresolved; see missing learner-level records and unidentified institution under “remaining limit.” No additional prerequisite to this finding.
- Quantities: answered; see “Quantitative reconciliation,” assumptions, bounds, and exact-rate boundary.
- Action scope: answered; finding saved and wording proposed only; no publication or outreach.
- Lookup observations: attempts only, results unobserved; see “Lookup observation.” No public source was used to verify this cohort.
