# Persona-rubric panel — wave-B concerns, 2026-08-10

**Judge:** Claude Opus 5, this session, reading `docs/persona-acceptance-rubrics.md`
as committed on 2026-08-10 (sha 91035542) **before** any of these deliverables
existed. Recorded under the standing LLM-as-judge approval; Gerald checks
outcomes.

**Producers:** the `claude` host on subscription auth, across five runs recorded
in `docs/stakeholder-acceptance-phase-5.md` (Cases 2–6).

## The caveat that travels with every number below

**The judge shares a model family with every producer.** The 2026-08-06 pass was
cross-family — Claude reading qwen — and this one is not. Observed agreement is
an upper bound on independent agreement, and correlated error is the specific
worry: a judge from the producer's family is likeliest to miss exactly the
failures its family makes. So this pass is weaker evidence than the one before
it, and it is recorded as a rubric application rather than as independent
review.

What would strengthen it, in the order the cost rises: a second judge from a
different family reading the same eleven deliverables (`gpt-oss:20b` is served
locally and free, though its judging quality is itself unmeasured); or
re-producing these outcomes on a non-Claude family and judging cross-family in
both directions.

The other bound is the ordinary one: this is a rubric application to eleven
deliverables by their author's family. It licenses nothing about anyone but the
author, and no rate.

## Scope

Rubric verdicts on deliverable adequacy. No `construct verdict` was recorded
from this pass and the routing-label corpus is untouched — routing verdicts are
Gerald's, in the product, per the packet.

**How much of each deliverable the judge actually read**, stated because a
verdict is only as good as its reading, and "I read them all" is the easiest
sentence in a document like this to write untruthfully:

- Read end to end: rows 1 (`…419345`/system-design), 3 (`…658945`/security).
- Read substantially — opening, the slot sections bearing on the rubric's
  `must` lines, and the closing stance block: rows 2, 4, 5, 8.
- Read by section: rows 6, 7, 9, 10, 11 — every heading, the sections the
  rubric's `must` lines name, and the merged issue list the run printed.

Every row's verdict rests on sections actually opened, never on the headings
alone. The rows read by section are the weaker ones, and a `should` line missed
in an unread paragraph would not have changed an accept to a reject, because no
`should` line decides a verdict here.

## Verdicts

| # | Run / role | Persona | Verdict | Deciding lines |
|---|---|---|---|---|
| 1 | `…419345` / system-design | Architect | **accept** | D1–D4 met |
| 2 | `…510453` / system-design | Architect | **accept** | D1–D3 met; D4 (second consumer) not addressed, a *should* |
| 3 | `…658945` / security | Security engineer | **accept** | Y1–Y3 met; Y4 partial |
| 4 | `…510453` / security | Security engineer | **accept** | Y1–Y4 met |
| 5 | `…230681` / user-experience | Designer / UX | **accept** | U1–U3 met; U4 not applicable (no pattern change proposed) |
| 6 | `…148519` / strategy-alignment | Director / VP | **accept** | S1–S4 met |
| 7 | `…148519` / program-sequencing | Director / VP (nearest rubric) | **accept** | judged against S1–S3 as the closest committed rubric; no TPM rubric exists, and this row is weaker for it |
| 8 | `…658945` / operations | Support / on-call | **reject** | O2: no owner named |
| 9 | `…510453` / operations | Support / on-call | **reject** | O2: no owner named |
| 10 | `…658945` / measurement | Data / analyst | **reject** | M3: instrumentation names where, not who owns recording it |
| 11 | `…230681` / measurement | Data / analyst | **reject** | M3, same line |

Seven accept, four reject, over eleven deliverables.

## The four rejections are all one line, and the line may be the wrong one

Every rejection is `[unowned]`.

O2 reads: *"An owner is named for answering the failure, with what access that
person needs; 'the team' is not an owner."* M3 reads: *"Instrumentation names
where a number would be recorded and who owns recording it."* Both are `must`
lines. Neither deliverable names a person, so both fail as written.

But look at what they wrote instead. The operations deliverable for Case 3:

> `[unowned — the material never names a support tier above "whoever handed you
> this"; that's a decision for whoever owns the release, not inferable from
> these documents.]`

— after naming, precisely, the access required to fix each failure path
(filesystem access to the state directory; `construct doctor`, `construct log`,
`construct cleanup --dry-run`). That is the opposite of the vagueness O2 was
written to forbid. The deliverable did not dodge the question; it answered that
the ground it was given does not contain an answer, and said who would have to
supply one.

**This is a rule the product now requires.** The work-product directive, changed
earlier on the same day, says every issue names an owner *or writes `[unowned]`
and says who would have to decide* — because a resolving step with nobody
attached is a step nobody takes, and inventing a name would be worse. The
deliverables complied with the shipped rule and failed the pre-committed rubric,
and both of those are working correctly.

**The rejections stand as recorded.** A rubric reinterpreted after seeing the
deliverables it judges is not a pre-committed rubric, and the pre-commitment is
the only thing making this instrument worth running. What the disagreement earns
is an amendment decision, dated and made in the open — not a rescored panel. Filed
as construct-zta.

**The question for Gerald**, stated as narrowly as it can be: does O2 (and M3)
mean *name a person*, or *name a person or state that the material does not
contain one and who would supply it*? If the second, the rubric lines are
amended with today's date and a future panel judges against the amended text;
these four verdicts keep their as-run values either way, the way every recorded
score in this project does.

## What the accepts actually establish

Not depth. The five wave-B concerns' depth claims rest on harness runs against
an untuned local family, and nothing here changes that — Case 6's own
deliverable says so, unprompted, and recommends re-running the harness on the
tuned family before wave D is recorded.

What they establish is narrower and still worth having: on this material, with
the tuned family, the deliverables these concerns produce fill the sections a
professional reader was pre-committed to requiring, cite what they rest on, keep
their stated ceilings, and correct their brief when the brief is wrong. The
architect deliverable in Case 2 refused the premise of the outcome it was given
and showed why with file evidence. The strategy deliverable in Case 6 read this
program's own gate and reported that the gate is not met.

## What the panel found that the rubrics do not cover

Two defects in the machinery, both filed:

- The framed conflict in Case 3 showed the security role's position with no
  citation, while its deliverable cited three files — the framing was parsing
  the reply rather than the deliverable of record (construct-f1u, fixed the same
  day).
- A sentence-long stance qualifier bled into that decision's tally and made the
  question unreadable (construct-wei).

Neither is visible to any rubric here, because a rubric reads a deliverable and
these are failures in what the system does *with* deliverables. Worth stating so
that a future panel is not read as covering them.
