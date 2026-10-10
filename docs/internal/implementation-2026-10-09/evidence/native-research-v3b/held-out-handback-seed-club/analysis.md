# Assessment of the September germination claim

Assessment date: 9 October 2026. Scope: only the five supplied records, covering the recorded September trial of lot M-17 and the report and future-trial planning proofs/minute. No external research or contact was undertaken. This assessment does not establish results for other lots, seasons, locations, or a larger trial. [cite: protocol.txt:1–5; claim.txt:1–5; newsletter.txt:1–2; planning-minute.txt:1–3; count-events.jsonl:1–5]

## Report decision

**Inference and recommendation: do not use the proposed sentence unchanged.** The initial figures explain the claimed 30% relative gain, but an explicit correction reduces the supported relative difference to 25%. More importantly, “pre-soaking raised” implies a causal effect that this design cannot isolate: treatment and bench location coincide. Changing only 30% to 25% would not repair that problem. Accept a descriptive replacement with controls: identify the day-10 emergence endpoint, corrected counts, and bench limitation. [cite: claim.txt:2–4; protocol.txt:2–4; count-events.jsonl:1–5]

Suggested report wording (derived from the supplied records):

> In the September trial of lot M-17, corrected day-10 counts showed emerged seedlings from 150 of 200 pre-soaked seeds (75%) and 120 of 200 dry-sown seeds (60%). The observed difference was 15 percentage points, or 25% relative to the dry-sown rate. Because all pre-soaked trays were on the east bench and all dry-sown trays were on the west bench, without randomized or rotated bench assignment, the trial cannot separate a pre-soaking effect from a bench effect.

[cite: protocol.txt:2–4; count-events.jsonl:1–5]

## Source authority and chronology

- **Record: `protocol.txt`.** Defines the population, endpoint, bench assignments and event replacement rule. Its recorded date is 10 September 2026; it also declares log completeness as of 21 September. It is authoritative here for interpretation and recorded design, not an independent count audit. [cite: protocol.txt:1–5]
- **Record: `count-events.jsonl`.** The grow lead's whole-tray count log. Initial events C1–C4 were recorded on 20 September. C5, recorded on 21 September, explicitly supersedes C3, correcting S1 from 80 to 74 from a retained counting sheet. Its stated observation remains day 10; this is not a later emergence count or an increment. Use C1, C2, C4 and C5, not C3 plus C5. The underlying sheet is not supplied, so its content cannot be independently checked here. [cite: count-events.jsonl:1–5; protocol.txt:4–5]
- **Record of proposed wording, not measurement: `claim.txt`.** The report proof is dated 24 September and cites the initial 20 September count. Its publication status is “not published” at the proof's recorded state; subsequent status is unknown. The held correction predates that proof. [cite: claim.txt:1–5; count-events.jsonl:5]
- **Aggregator/derivative account: `newsletter.txt`.** The newsletter proof is dated 23 September and expressly relies on the communications team's report proof, with no separate measurements. It is evidence of repetition, not corroboration. Its reference to a report proof precedes the supplied report proof's 24 September date; an earlier version could explain this, but version history is not supplied. That provenance detail remains unresolved and does not alter the corrected count arithmetic. [cite: newsletter.txt:1–2; claim.txt:1–4]
- **Record: `planning-minute.txt`.** The committee minute is dated 25 September. It records future booking conditions and decisions, not trial observations; the grow lead owns observations. The minute cannot validate or overturn the count log. [cite: planning-minute.txt:1–3]

## Supported numbers and reconciliation

Every tray contained 100 seeds, with no recorded exclusions: two dry-sown trays and two pre-soaked trays, 200 seeds per group and 400 overall. The time basis is day 10 after sowing on 10 September; the measured criterion is an emerged seedling, not a separately measured final germination or viability endpoint. [cite: protocol.txt:2]

| Tray | Treatment / bench | Initial count | Applicable count | Applicable emergence rate | Count source |
|---|---|---:|---:|---:|---|
| D1 | Dry / west | 58 | 58 | 58% | C1 |
| D2 | Dry / west | 62 | 62 | 62% | C2 |
| S1 | Pre-soak / east | 80 | 74 | 74% | C3 replaced by C5 |
| S2 | Pre-soak / east | 76 | 76 | 76% | C4 |

All rates in this table are count / 100 seeds × 100. [cite: protocol.txt:2–4; count-events.jsonl:1–5]

| Comparison | Initial records | Corrected records |
|---|---|---|
| Dry-sown emergence | (58 + 62) / 200 = 60% | 120 / 200 = 60% |
| Pre-soaked emergence | (80 + 76) / 200 = 78% | (74 + 76) / 200 = 75% |
| Extra emerged seedlings in pre-soaked group | 156 − 120 = 36 | 150 − 120 = 30 |
| Absolute rate difference | 78% − 60% = 18 percentage points | 75% − 60% = 15 percentage points |
| Relative difference, dry-sown baseline | (156 − 120) / 120 × 100 = 30% | (150 − 120) / 120 × 100 = 25% |

These are calculations from the recorded counts and equal group denominators, not estimated causal effects. C5 removes six seedlings from the initial pre-soaked total: its rate falls by three percentage points, and the relative-gain figure falls from 30% to 25%. Thirty extra seedlings is not a 30% gain; 15 percentage points is not a 15% relative gain. No acceptance threshold is supplied. [cite: protocol.txt:2–4; count-events.jsonl:1–5; claim.txt:2]

## Disconfirmation and strongest rival

**Inference:** two explanations fit the corrected group difference: pre-soaking contributed to emergence, or bench conditions (possibly together with other variation) account for some or all of it. Both could also contribute. The held material cannot choose between these explanations. [cite: protocol.txt:2–3; count-events.jsonl:1–5]

| Evidence sought/read | Pre-soaking contributes | Bench conditions account for the difference |
|---|---|---|
| Both corrected soaked counts exceed both dry counts | Consistent | Consistent |
| All trays use the same lot and endpoint | Consistent; narrows some alternatives | Consistent; does not equalize benches |
| Treatment perfectly aligned with bench | Cannot isolate treatment | Consistent with rival |
| Randomization, rotation or measured bench conditions | Not available to test separation | Not available to test separation |
| Repeat trial or independent audit | Absent from packet | Absent from packet |

[cite: protocol.txt:2–5; count-events.jsonl:1–5]

A treatment-balanced comparison across benches could challenge a treatment-only or bench-only explanation; the protocol was checked specifically for that separation and records none. No such future evidence is assumed. For the numerical rival that 30% remains the applicable figure, the refuting evidence is already present: the express C5 replacement rule and correction. No event reverses C5 in the log declared complete as of 21 September. **The disconfirmation pass weakens the proposed causal conclusion and rejects its current numerical basis, while preserving the observed positive difference.** [cite: protocol.txt:3–5; count-events.jsonl:1–5]

### Strongest objection

**Inference:** the best case for the original statement is that its arithmetic exactly matches the initial counts and both pre-soaked trays still outperform both dry trays after correction. That supports an observed association, not keeping a superseded number or identifying its cause. Shared bench placement leaves the strongest rival intact. [cite: count-events.jsonl:1–5; protocol.txt:2–4]

## Independence and single-source limits

- **Counts and correction:** one grow-lead observation stream. The retained counting sheet could substantiate transcription but would still be upstream material, not an independent audit. A separate count audit could independently check counts, but none is supplied. [cite: count-events.jsonl:1–5; protocol.txt:4–5]
- **Design and coverage:** the protocol is the held account of lot, denominator, exclusions and placement. There is no separate supplied bench or sowing record with which to audit those assertions. [cite: protocol.txt:2–5]
- **Claim and newsletter:** one dependent reporting chain. The newsletter explicitly derives from the report proof; the report's appeal back to the newsletter is circular, not two-source confirmation. [cite: claim.txt:3–4; newsletter.txt:2]
- **Future booking status:** the committee minute is the held decision record. Separate owner or booking documentation could exist, but is not supplied and was not sought. [cite: planning-minute.txt:2–3]

## Unresolved report and larger-trial issues

**Evidence limits, not blockers to this assessment:**

- Bench temperature and light were **not collected**. The size and direction of any bench effect are unknown, not demonstrated absent. Treatment/bench separation remains unresolved. [cite: protocol.txt:3]
- Independent count audit and repeat-trial evidence are **not present in the packet**. This is not proof that no other evidence exists anywhere. The correction's retained sheet and proof version history are also not supplied. [cite: protocol.txt:5; count-events.jsonl:5; newsletter.txt:1–2; claim.txt:1–5]
- Later emergence, final germination, viability and performance in other lots or seasons are **not recorded in the supplied evidence**. Inference: the recorded seed total does not create hundreds of independently assigned treatment replicates; there are only two trays per treatment, each treatment confined to one bench. No causal significance or larger-trial success claim is supported here. [cite: protocol.txt:2–3]
- A named keyholder and reserved bench plan are **not yet chosen** according to the committee minute, and authorization and booking **had not happened at that recorded state**. These are conditions for booking the contemplated next-spring trial, not prerequisites for assessing September's held evidence. Their present status beyond the minute is unknown. [cite: planning-minute.txt:1–3]

**Recommendation for interpreting any larger trial:** a larger seed count alone would not resolve the current confounding; treatment allocation would need to permit separation from bench conditions before making a causal claim. This is an evidence condition for future interpretation, not an instruction or authorization to redesign, book or run anything. [cite: protocol.txt:2–3; planning-minute.txt:2]

### Pre-mortem of the report recommendation

**Inference:** the likeliest failure is replacing “30%” with “25%” while retaining “raised germination,” or dropping the bench caveat when shortening the report. That would publish corrected arithmetic as an unsupported causal result. The proposed replacement controls this by pairing the observed emergence numbers with the design limitation. [cite: claim.txt:2; protocol.txt:2–3; count-events.jsonl:1–5]

## Verification record

- Claims cited: answered; see “Report decision,” “Supported numbers” and “Unresolved report and larger-trial issues.”
- Source classes: answered; see “Source authority and chronology,” including document, recording and observation date distinctions.
- Independence: answered; see “Independence and single-source limits.”
- Disconfirmation: answered; see “Disconfirmation and strongest rival.” Reversed the proposed numerical conclusion: yes; weakened the causal conclusion: yes.
- Coverage frame: answered; see “Scope: only the five supplied records” and classified evidence limits.
- Ground exhausted: answered; all five supplied evidence files read in full, listed in “Source authority and chronology.”
- Strongest objection: answered; see “Strongest objection.”
- Pre-mortem: answered; see “Pre-mortem of the report recommendation.”
- Handbacks: none needed for this assessment. Future booking conditions remain future-action limits.
- Quantities: answered; see both tables and explicit calculations in “Supported numbers and reconciliation”; event selection and arithmetic independently recalculated with a local script.
- Action scope: assessment and proposed wording only. No source record changed, no contact made, and no publication or future trial authorized by this assessment.
- Lookup observations: no external lookup used; source references identify supplied filenames and line numbers, with event IDs for the count log.
