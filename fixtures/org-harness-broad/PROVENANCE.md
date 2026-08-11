# Corpus provenance — the broad organization

All base material is real public content from the GSA Technology Transformation
Services handbook (github.com/GSA-TTS/handbook), retrieved 2026-08-10 at commit
`c220f93896b39e9e4ab0f486a1d5bf346ac06e3e`. It is a work of the United States
Government, in the public domain domestically and dedicated worldwide under
CC0 1.0, so nothing here is under a share-alike obligation this Apache-2.0
repository would have to carry. The base documents are verbatim copies with a
single origin comment prepended; the fetched originals are kept in `raw/` so
every later edit is auditable as a diff.

## Why this organization and not another

The original fixture organization (`fixtures/org-harness`) is 22 documents
drawn from one project's sync and hydration work. Every role reading it may be
forced onto the same handful of salient engineering tensions, which is the last
untested explanation for the role convergence that harness measured. Testing
that requires a second organization whose documents span concerns that do not
share a subject: what the organization sells and on what terms, how it prices
and bills, how it hires and staffs, who gets access to what, and what happens
when delivery goes wrong.

The TTS handbook is a real organization's real operating documentation across
exactly those functions, which is what the original corpus is not. It is also
public domain, which the alternatives with comparable breadth (company
handbooks published under CC BY-SA) are not.

## Base documents

| Corpus file | Origin (path under the handbook repo) |
| --- | --- |
| `strategy.md` | `pages/18f/history-and-values.md` |
| `org/solutions-portfolio.md` | `pages/office-of-solutions/index.md` |
| `rfc-003-cybersecurity-advisor.md` | `pages/request-for-comments/003-tts-cybersecurity-advisor.md` |
| `rfc-004-bucket-hiring.md` | `pages/request-for-comments/004-bucket-hiring-approach.md` |
| `policies/agreements.md` | `pages/18f/how-18f-works/agreements.md` |
| `policies/state-local-agreements.md` | `pages/18f/how-18f-works/state-local-agreements.md` |
| `policies/contractors.md` | `pages/18f/how-18f-works/contractors.md` |
| `policies/business-development.md` | `pages/18f/how-18f-works/business-development.md` |
| `policies/finance-and-billing.md` | `pages/about-us/centers-of-excellence/operations/finance.md` |
| `policies/time-tracking-and-rates.md` | `pages/about-us/centers-of-excellence/operations/tock.md` |
| `policies/hiring.md` | `pages/hiring-staying-or-changing-jobs/hiring.md` |
| `policies/project-teams-and-staffing.md` | `pages/18f/projects-partners/project-teams.md` |
| `policies/client-accounts.md` | `pages/18f/how-18f-works/client-accounts.md` |
| `policies/chat-user-management.md` | `pages/tools/slack/user-management.md` |
| `policies/password-requirements.md` | `pages/general-information-and-resources/tech-policies/password-requirements.md` |
| `policies/sensitive-information.md` | `pages/general-information-and-resources/sensitive-information.md` |
| `policies/security-incidents.md` | `pages/general-information-and-resources/tech-policies/security-incidents.md` |
| `policies/public-vulnerability-disclosure.md` | `pages/general-information-and-resources/tech-policies/responding-to-public-disclosure-vulnerabilities.md` |
| `policies/records-management.md` | `pages/general-information-and-resources/tech-policies/records-management.md` |
| `policies/project-lifecycle.md` | `pages/18f/how-18f-works/project-lifecycle.md` |
| `policies/projects-in-distress.md` | `pages/18f/projects-partners/projects-in-distress.md` |
| `policies/delivery-assurance.md` | `pages/about-us/centers-of-excellence/operations/delivery-assurance.md` |

## Held to parity with the original corpus

The comparison this harness exists to make is only readable if breadth is the
one thing that differs, so the selection was sized against `../org-harness`
rather than taken as far as the source would allow:

| | original | broad |
| --- | --- | --- |
| documents | 22 | 22 |
| corpus bytes | 135,443 | 141,115 |
| inlined dispatch prompt | ~39.0k est. tokens | ~40.6k est. tokens |

Both fit the local runner's 48k context with room for the response, so neither
sweep is measuring a truncated corpus. Five further handbook documents were
fetched and then dropped to hold that parity — offboarding, procurement
thresholds, hiring authorities, and two office-charter pages — and they are not
in `raw/` either, because a raw file with no corpus file beside it is not a
diff of anything.

## Deliberate differences from the original harness

- **No notes-drop.** The original corpus carries two authored notes as the
  team-notes-drop stimulus, and its answer key gates a rung on them. This
  harness has none: it exists to measure whether role plants discriminate over
  broader material, and the notes loop is a different question measured
  elsewhere. Its answer key carries `roleFindings` and nothing that would gate
  the notes rung.
- **All 22 documents are measured material.** The original's count includes
  its two authored notes, so this corpus has 22 real documents against the
  original's 20.

## Edits (the plants), 2026-08-10 — committed before any run

Ten plants, one per role that carries a depth claim, each keyed to the territory
only its owner asks about rather than to a kind of finding. Authored by
`claude-opus-5` reading this corpus, with the territory table from
`../org-harness/PROVENANCE.md` and no run over this corpus in existence. Every
plant is a single inserted paragraph; `raw/` holds the unedited original of each
file, so each edit is a diff.

| Plant | Role | Paragraph inserted into | Read against | The mechanism |
| --- | --- | --- | --- | --- |
| `CP-B1` | compliance | `policies/time-tracking-and-rates.md` | `policies/client-accounts.md` | hours entered by the timekeeping team under an absent employee's name reach the client's invoice as that person's labor, and no record says who filed them |
| `L-B1` | legal | `policies/state-local-agreements.md` | `policies/agreements.md` | the delegation that lets a designated official bind a state or local partner is confirmed verbally and kept in no file the package contains |
| `TP-B1` | program | `rfc-004-bucket-hiring.md` | `policies/project-teams-and-staffing.md` | an interim hiring cap counts replacements for people already on engagements against the same pool, rationing delivery's only remedy for a struggling team |
| `C-B1` | product | `org/solutions-portfolio.md` | `strategy.md` | the same organization promises bounded, terminable, cost-recovered engagements and a portfolio of standing services with no end date, funded from the first |
| `SA-B1` | strategy | `rfc-003-cybersecurity-advisor.md` | `policies/finance-and-billing.md` | a Front Office advisory role is structurally nonbillable, so approving it either raises the overhead partners are charged or lowers the utilization the organization is judged by |
| `SD-B1` | architect | `policies/project-lifecycle.md` | `policies/business-development.md` | a stage vocabulary authored for pipeline reporting became staffing's trigger, so its owner can no longer change it and nothing records the coupling |
| `OP-B1` | operations | `policies/security-incidents.md` | `policies/delivery-assurance.md` | detection is a person noticing and the clock starts at awareness, with no rotation and only a help-wanted channel for surge, so discovery and response are the same absent person |
| `UX-B1` | design | `policies/public-vulnerability-disclosure.md` | `policies/sensitive-information.md` | the bug bounty is the only intake, a report arriving elsewhere cannot be worked where it lands, and nothing carries it in on the reporter's behalf |
| `TH-B1` | security | `policies/chat-user-management.md` | `policies/password-requirements.md` | offboarding leaves a live account with its second factor removed and its recovery address outside the organization, still holding message history |
| `A-B1` | analyst | `policies/projects-in-distress.md` | `policies/records-management.md` | pivot, pause and stop decisions are made in conversation and counted nowhere, so the organization has no baseline for how often engagements go wrong |

`engineering` gets no plant, deliberately and permanently: no depth claim rests
on it, because the hosts are the engineers.

### What was checked before the sweep, and what was not

- **Every plant matches its own stated mechanism.** Each `gist` was run through
  the scorer as a claim citing that plant's document pair; all ten are credited.
  The first batch over the original corpus contained plants a correct claim
  still scored as a miss, and that failure is excluded here by construction
  rather than discovered afterwards. Two plants failed this check on their first
  keying (`L-B1`, `SA-B1`) and were re-keyed while it was still true that no run
  existed. Re-keying after a run is a different act and is not done.
- **No two plants share a document pair, and no document carries two plants.**
  Twenty distinct documents underpin ten plants. On the original corpus, plants
  sharing a pair could be credited by a claim about the neighbouring mechanism;
  here that particular confound cannot arise, so a collision measured on this
  corpus is a collision between roles rather than between plants.
- **Not checked: that each mechanism is reachable only by its owner.** That is
  the question the sweep exists to answer, and asserting it here would be
  assuming the result.

Known weaknesses, recorded before any run rather than discovered after, are in
`answer-key.json` under `roleFindings.knownWeaknesses`. In short: the plant
author shares a model family with whoever will read the runs and write the
verdict; two pairs of plants lean on related reasoning even though their
documents are disjoint; two mechanisms are absences, which are harder to cite
than statements; and nine of ten needed an inserted paragraph, so a plant
findable by register rather than by synthesis would flatter every lens equally.
