# Attendance claim: verification finding

## Finding

**Inference: the committee should not rely on the claim as written.** The supplied records support “90% of survey respondents reported attending,” not an established attendance rate for all enrolled learners. The newspaper is not independent confirmation: it attributes its figure to the memo and explicitly says no independent survey was conducted. The cohort-wide claim is unsupported, not conclusively disproved. [cite: claim.md:1; memo.md:1; news.md:1; attendance.csv:1–2]

Suggested replacement: “Of 200 enrolled learners, 100 responded to the survey, and 90 of those respondents said they attended (90% of respondents; 45% of enrollment). Attendance among nonrespondents was not collected. The newspaper repeated the memo’s figure rather than independently verifying it.” [cite: attendance.csv:1–2; memo.md:1; news.md:1]

## Sources and coverage

- **Record of the assertion:** `claim.md` contains the claim being checked; it is not evidence that the claim is true. [cite: claim.md:1]
- **Record, aggregate:** `attendance.csv` lists the main cohort with 200 enrolled, 100 respondents, and 90 attended. It contains no learner-level attendance entries. [cite: attendance.csv:1–2]
- **Derived record:** `memo.md` summarizes the survey as 90 of 100 respondents saying they attended and states that nonrespondent attendance was not collected. This establishes self-report, not independently observed attendance. [cite: memo.md:1]
- **Aggregator:** `news.md` attributes attendance to the year-end memo and disclaims an independent survey. [cite: news.md:1]

Coverage is limited to the supplied main-cohort aggregate and survey summary; geography, event dates, and the reporting year's calendar identity are unspecified, so no broader geographic or time-period conclusion is made. “Year-end” is a document description, not a verified event or publication date. [cite: attendance.csv:1–2; claim.md:1; memo.md:1; news.md:1]

## Denominator and uncertainty

The calculations from the supplied counts are: response rate = 100 / 200 = 50%; respondent-reported attendance = 90 / 100 = 90%; affirmative attendance reports as a share of enrollment = 90 / 200 = 45%. There are 200 − 100 = 100 nonrespondents. [cite: attendance.csv:1–2; memo.md:1]

**Inference, conditional bounds:** treating the survey's 90 affirmative responses and remaining 10 responses as accurate attendance classifications, cohort attendance could range from 90 / 200 = 45% to (90 + 100) / 200 = 95%. These are missing-data bounds, not a confidence interval or an independently verified attendance range. A 90% cohort rate would require 180 attendees, including 90 of the 100 nonrespondents; the records do not establish that. [cite: attendance.csv:1–2; memo.md:1]

Nonrespondent attendance is **not-recorded**, not “did-not-happen.” Their attendance evidence is systematically thinner than respondents'. The missing learner-level responses and attendance logs are **not-yet-collected for this review**; whether such records exist elsewhere is unknown. [cite: memo.md:1; attendance.csv:1–2]

## Disconfirmation pass

Two hypotheses remain possible: **H1**, the claim improperly generalizes a respondent rate; **H2**, the cohort rate really is 90%, despite incomplete collection. To refute H1, I sought a complete-cohort count or a measured nonrespondent rate. To refute H2, I sought complete counts incompatible with 180 attendees. Neither appears in the supplied material. [cite: attendance.csv:1–2; memo.md:1; news.md:1]

| Evidence examined | H1: unsupported generalization | H2: true cohort rate of 90% |
| --- | --- | --- |
| 90 of 100 respondents reported attendance | Consistent | Consistent, but insufficient [cite: memo.md:1] |
| 200 enrolled; only 100 respondents | Consistent | Consistent if 90 nonrespondents attended [cite: attendance.csv:1–2] |
| Nonrespondent attendance not collected | Consistent | Silent on their actual attendance [cite: memo.md:1] |

**Inference:** H1 best explains why the statement is not justified by these records; H2 cannot be ruled out. The rival check limits the verdict to “unsupported,” rather than “false.” Separately, the claimed newspaper independence is directly contradicted by its stated attribution and lack of an independent survey. [cite: claim.md:1; memo.md:1; news.md:1; attendance.csv:1–2]

## Single-source dependencies

- **Survey counts:** the CSV and memo agree, but their independent origins are not established; treat them as one evidentiary chain, not independent corroboration. Independently maintained event check-in records could test attendance, if available. [cite: attendance.csv:1–2; memo.md:1]
- **Newspaper figure:** its stated upstream source is the memo. No independent attendance measurement is supplied. An independently collected attendance register or survey could provide corroboration, but was not supplied here. [cite: news.md:1; memo.md:1]

## Strongest objection

**Inference:** respondents might accurately represent the whole cohort, and the true cohort rate might indeed be 90%. That possibility does not establish representativeness or supply the missing attendance observations. Conversely, using 45% as the final cohort attendance rate would wrongly count every nonrespondent as absent. [cite: attendance.csv:1–2; memo.md:1]

## Recommendation and pre-mortem

Use the replacement wording and leave cohort-wide attendance unresolved. **Accepted with controls:** retain both the respondent denominator and the self-report qualifier. The strongest failure mode is that a shortened committee summary drops those qualifiers and again presents 90% as a cohort fact. The best alternative for establishing an actual cohort rate is a reconciled enrollment-and-attendance register, if available, rather than extrapolation from these responses. [cite: memo.md:1; attendance.csv:1–2]

The only substantive handback is independently supported cohort attendance. It cannot be settled from the supplied records because nonrespondent attendance was not collected and learner-level verification is absent. Request any existing attendance register or additional collection from the record holder; do not assume those records exist. [cite: memo.md:1; attendance.csv:1–2]

## Verification record

- Claims cited: answered — see “Finding” and “Denominator and uncertainty.”
- Source classes: answered — see “Sources and coverage”; no calendar date is inferred.
- Independence: answered — see “Single-source dependencies.”
- Disconfirmation: answered — see “Disconfirmation pass”; reversed the draft conclusion: no; the rival limits the finding to unsupported, not false.
- Coverage frame: answered — see “Coverage is limited” and the classified absences.
- Ground exhausted: answered — all four supplied documents were read in full; no external attendance evidence is used.
- Strongest objection: answered — see “Strongest objection.”
- Pre-mortem: answered — see “Recommendation and pre-mortem.”
- Handbacks: listed — see “The only substantive handback”; missing attendance evidence requires access or collection beyond the supplied records.
