---
intake: none
---

<!--
  FIXTURE — authority policy for the fictional Nimbus daily loop. Invented
  for construct-b0nny.5.4 (Spike D). This governs the SIMULATED loop only;
  the loop script never makes a real network call regardless of what this
  policy says.
-->

# Nimbus daily loop — authority policy (FIXTURE)

## Allowed without human approval

- Read every fixture source (strategy, objectives, GitHub-issue stand-in,
  Jira-backlog stand-in, Slack/Confluence stand-in).
- Detect and normalize signals into its own internal representation.
- Check signals against the strategy doc for alignment/conflict.
- Filter noise from meaningful signals.
- Maintain run-to-run state (what was already reported) so it never
  reports the same unchanged finding as "new".
- Draft a recommendation and a proposed artifact (brief, backlog-item
  update, status-change suggestion) as a **PROPOSAL** — a file on disk
  marked `status: "pending_approval"`.

## Requires explicit human approval before proceeding

- Any write that would be external in a real deployment: commenting on or
  editing a GitHub issue, editing or commenting on a Jira-style ticket,
  posting a Slack message, editing a Confluence-style page, or changing an
  objective's recorded status.
- Approval must be a distinct, logged step (an approval record with an
  approver identity and timestamp) separate from the proposal itself. The
  loop must refuse to apply a proposal that has no matching approval
  record.

## Always prohibited, even with approval

- Real network calls of any kind. Every "external effect" this loop ever
  produces is a local simulation labeled `"_simulated": true`,
  logging exactly what would have been sent. There is no code path in this
  spike that calls a real GitHub/Jira/Slack API.
- Deleting or overwriting a prior run's evidence. New runs append; they
  never rewrite history.
