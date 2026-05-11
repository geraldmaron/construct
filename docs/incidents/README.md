# Incidents

Living record of operational incidents on this repo. cx-sre writes here when invoked via the role framework or by direct request.

## File naming

`YYYY-MM-DD-<short-slug>.md` — one file per incident. Use the day of detection, not resolution.

## Required sections per incident

1. **Trigger** — the event that fired (e.g., `service.down`, `push_gate.fail`) and the bd issue ID.
2. **Timeline** — chronological log of detection → mitigation → resolution.
3. **Root cause** — single-paragraph diagnosis. Avoid blame.
4. **What worked** — L0 actions that succeeded, L1 dispatches that resolved cleanly.
5. **What didn't** — gaps in detection, escalation, or handoff. Drives postmortem follow-ups.
6. **Follow-ups** — bd issues filed; runbook updates.

A short stub is acceptable for low-severity incidents; only escalate to a full postmortem for SEV1/SEV2.

## Related

- `docs/runbooks/` — operational procedures (proactive)
- `docs/postmortems/` — deeper analysis for major incidents (created on demand)
