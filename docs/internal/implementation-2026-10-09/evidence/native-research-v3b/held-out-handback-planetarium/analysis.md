# Planetarium capacity assessment

## Finding

**The held packet does not support the committee's claim.** Inference: confirmed room access and the current programme support **two shows with 36 audience places each: 72 admissions**, 48 below the target of 120. Even if the requested extension is approved, three shows support only **108 admissions**, 12 below target. These are capacity ceilings, not attendance forecasts or permission to release tickets. [cite: layout.tsv, lines 1–3; running-order.txt, lines 2–3; room-bookings.ics, lines 4–20; committee-note.txt, lines 2–4]

Scope: this assessment covers the supplied plan for Larkfield Astronomy Circle's Thursday, **15 October 2026** event, interpreting “next Thursday” relative to the committee note dated **9 October 2026** and matching the booking's event date. It assesses the held records only, not later approvals or alternative venues. Calendar times below retain the file's `Z` (UTC) basis; no local-time conversion is assumed. [cite: committee-note.txt, lines 1–3; room-bookings.ics, lines 7–8, 16–17]

## Evidence and authority

All five supplied substantive files were read in full. They are **records**, but their authority differs by claim:

- **Committee planning record:** the note dated 9 October states the claim and assumes three shows at 40 places each, with an extension described as likely. It also records that no tickets have been offered or sold. It is evidence of the committee's assumptions, not venue approval. [cite: committee-note.txt, lines 1–4]
- **Venue layout record:** revision 2 is explicitly current; revision 1 is superseded. The current plan starts with 42 audience positions and removes six for the projection enclosure. Two crew positions are separate from the audience count. No issue date is supplied. [cite: layout.tsv, lines 1–3]
- **Producer's programme record:** the running order dated 8 October defines sequential, non-overlapping programme durations and states that the programme has not been shortened or retimed. It expressly assigns access authority to the bookings desk and audience-place authority to the current venue layout. [cite: running-order.txt, lines 1–3]
- **Booking record:** the confirmed event provides access from 18:00 to 19:40, including preparation and clearance. Its calendar `DTSTAMP` is 8 October at 09:00Z; this is a record timestamp, not the event time. The extension entry has a later `DTSTAMP`, 9 October at 11:00Z, but remains `TENTATIVE`, “not accepted,” and explicitly leaves the existing confirmation unchanged. Recency does not turn that request into approval. [cite: room-bookings.ics, lines 4–20]
- **Coordinator's issues record:** the note dated 9 October documents attendance-evidence gaps and staffing prerequisites; it does not alter access or layout. [cite: open-issues.txt, lines 1–4]

## Capacity calculation

Inference: net audience capacity is **42 − 6 = 36 per show**. Do not subtract the two crew positions again or count them as audience places. The superseded pre-projector layout's 40 audience places cannot govern the current plan. [cite: layout.tsv, lines 1–3]

For a positive number of shows `n`, inference from the held running order gives total room time in minutes:

`10 preparation + 25n shows + 10(n − 1) changeovers + 10 clearance = 35n + 10`.

There is no extra changeover after the final show. All these activities must fit inside authorized access. [cite: running-order.txt, line 2; room-bookings.ics, line 11]

| Scenario | Available room time | Programme time | Time margin | Audience admissions | Gap to 120 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Confirmed access, two shows | 100 minutes | 80 minutes | 20 minutes spare | 72 | 48 short |
| Confirmed access, three shows | 100 minutes | 115 minutes | 15 minutes over | 108 nominal; not schedulable | 12 short even ignoring time |
| Requested extension approved, three shows | 120 minutes | 115 minutes | 5 minutes spare | 108 | 12 short |

Every table result is an **inference** calculated from the recorded durations, access intervals and net audience positions. The feasibility boundary is programme time **≤** authorized access; the numerical claim requires capacity **≥ 120**. Only two shows fit confirmed access. Three require at least access through **19:55Z**, 15 minutes beyond the confirmed end, even though the request runs to 20:00Z. [cite: running-order.txt, line 2; room-bookings.ics, lines 7–11, 16–20; layout.tsv, line 3; committee-note.txt, line 2]

These totals count audience admissions across shows. Inference: 72 admissions can accommodate at most 72 distinct people if each attends once; repeat attendance reduces distinct-person reach. If “120 people” means the same people attending every show, simultaneous capacity is still only 36, so that interpretation also fails. The packet contains no guest list to resolve attendance allocation. [cite: layout.tsv, line 3; open-issues.txt, line 2]

## Disconfirmation and strongest objection

Two hypotheses were tested: **A**, the held plan supports only 72 admissions under confirmed access; **B**, the committee's anticipated extension and 40-place assumption support 120. A would be refuted by a controlling approval, shorter programme or different current layout. B would be refuted by non-approval, insufficient time or a lower current audience count. All held files were checked for those possibilities. [cite: committee-note.txt, lines 2–3; layout.tsv, lines 2–3; running-order.txt, lines 2–3; room-bookings.ics, lines 4–20; open-issues.txt, line 4]

| Held evidence | A: 72 on confirmed terms | B: 120 as drafted |
| --- | --- | --- |
| Current net layout: 36 | Consistent | Inconsistent |
| Three shows need 115 minutes; confirmed access is 100 | Consistent | Inconsistent on confirmed terms |
| Extension tentative; chair calls it likely | Consistent with current limit | Consistent with expectation, not approval |
| Programme not shortened or retimed | Consistent | No timing workaround supported |

The table is an **inference** comparison, not additional corroboration. The pass did not reverse the finding. [cite: layout.tsv, line 3; running-order.txt, line 2; room-bookings.ics, lines 7–20; committee-note.txt, line 3]

**Strongest objection:** the committee is making a forward-looking plan and the extension might be granted before the event. That is a fair conditional scenario, not evidence of present authorization. Inference: granting it would cure the timing deficit but still leave the three-show total at 108. The objection therefore does not rescue 120. [cite: committee-note.txt, line 3; room-bookings.ics, lines 14–20; layout.tsv, line 3]

## Unresolved issues and limits

- **Extension approval:** explicitly not granted in the held booking, rather than merely absent from the packet. Its eventual disposition is unknown. No external check was made or authorized. [cite: room-bookings.ics, lines 18–20]
- **Attendance:** demand survey and named guest list are absent, and no forecast is validated. Class: not-recorded in this collection; actual demand remains unknown, not zero. Capacity cannot establish how many people will come. [cite: open-issues.txt, line 2]
- **Staffing:** a named volunteer lead and final helper rota must be confirmed before any later ticket release; neither is in the packet. Class: not-recorded, not proof that no volunteers exist. These are later execution conditions, not blockers to this assessment or reasons to increase capacity. [cite: open-issues.txt, line 3]
- **Alternatives:** the existing recording has captions, but no replacement recording or larger venue has been selected. A later expansion needs a new room plan and booking. Inference: captions alone provide no evidence of extra places or shorter running time. Selection is expressly absent; feasibility of an alternative is unknown. [cite: open-issues.txt, line 4; running-order.txt, line 2]

### Single-source dependencies

Seat capacity depends on the single current layout record; timing on the single running order; room authorization on the single calendar export. Staffing and demand gaps depend on the coordinator's note. Independent venue confirmation, a separately validated programme or audience records could in principle test these facts, but none is supplied. The committee's assumptions do not independently corroborate them. The records address different constraints rather than independently confirming the same quantity. Prospective attendees' evidence is systematically thinner: no direct demand evidence is held. [cite: layout.tsv, lines 1–3; running-order.txt, lines 2–3; room-bookings.ics, lines 4–20; committee-note.txt, line 3; open-issues.txt, lines 2–3]

## Recommendation and action boundary

**Recommendation (inference): use 72 admissions across two shows as the record-supported planning ceiling, with 108 across three only as an extension-dependent scenario; do not present 120 as supported.** Accepted with controls: these ceilings assume the held layout and programme and do not establish attendance or staffing readiness. The strongest failure mode is treating the tentative extension and superseded seat count as settled. The best supported alternative to the draft is the two-show baseline, not an invented larger venue or shortened programme. [cite: layout.tsv, lines 2–3; running-order.txt, line 2; room-bookings.ics, lines 7–20; open-issues.txt, lines 2–4]

**Pre-mortem (inference):** if the draft is treated as executable unchanged, three shows exceed confirmed access by 15 minutes and 120 admissions exceed the current three-show layout by 12. Approval of the extension resolves only the first problem. [cite: running-order.txt, line 2; room-bookings.ics, lines 7–20; layout.tsv, line 3; committee-note.txt, lines 2–3]

Assessment complete within the supplied-file scope. No bookings, ticket releases, contacts or external research were undertaken. No handback is required to finish this assessment; later approval and staffing conditions remain unresolved execution matters.

## Verification record

- Claims cited: answered; see “Finding” and the calculation source markers.
- Source classes: answered; see “records, but their authority differs” and the explicit inference labels.
- Independence: answered; see “Single-source dependencies.”
- Disconfirmation: answered; see “Two hypotheses were tested”; reversed the draft conclusion: no.
- Coverage frame: answered; see “the supplied plan” and “Unresolved issues and limits.”
- Ground exhausted: answered; see “All five supplied substantive files were read in full.”
- Strongest objection: answered; see “forward-looking plan.”
- Pre-mortem: answered; see “three shows exceed confirmed access.”
- Handbacks: none for this deliverable; see “later approval and staffing conditions.”
- Quantities: answered; see “Capacity calculation,” including units, gross/net counts, attendance interpretation, boundaries and gaps.
- Action scope: answered; see “No bookings, ticket releases, contacts or external research.”
- Lookup observations: no external lookup used; held results are the five cited files.
