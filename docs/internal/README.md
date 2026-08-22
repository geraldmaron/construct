# Development records

Nothing in this directory is documentation for using Construct. Everything in
`docs/` one level up is; this is the other kind of writing a project
accumulates, kept separate so a reader can tell which they are holding.

What lives here is the evidence behind claims made elsewhere. Construct's
fifteenth commitment is that anything called working carries a test, a probe, or
a recorded run — and a recorded run has to be somewhere. These are those runs,
plus the design decisions and acceptance packets that explain why the code took
the shape it did.

They are kept, rather than deleted once read, because deleting them would leave
the claims they support standing on nothing. They are kept *here*, rather than
beside the guides, because a person installing a tool has no reason to read a
dated probe transcript or an acceptance packet addressed to one stakeholder, and
a directory that mixes the two makes them work out which is which.

## What is in here

- **Probe and trial records** — `host-trial-*.md`, `injected-ground-review.md`.
  What actually happened when Construct was attached to a host, or when a
  document written to steer the reviewer was put in front of it. Each is dated
  because the date is the provenance: it says which version of which host was
  measured.
- **Measurements** — `2026-08-21-shape-chooser-miss-rate.md`. A figure and the
  method that produced it. The lint re-derives the headline from its fixture, so
  the number and the prose cannot drift apart silently.
- **Acceptance packets** — `stakeholder-acceptance-phase-*.md`. What to read and
  where, written for one person to check a phase's work. They are correspondence
  more than documentation.
- **Design records and plans** — `connector-seam-design.md`,
  `org-coverage-plan.md`, `agentic-platform-strategy.md`,
  `prd-agentic-platform.md`, `session-artifact-form.md`. Why a shape was chosen,
  what was considered and rejected. Where one of these disagrees with the issue
  tracker, the tracker is the record.
- **Judging rubrics** — `persona-acceptance-rubrics.md`, committed before any
  judging for the same reason an answer key is: a rubric written after reading
  the work would be tuned to pass it.
- **Skill runs and the use ledger** — `skill-runs/`, `skill-use-ledger.md`. The
  pre-registered instrument for the skills wedge and the invocations recorded
  against it. The ledger states its own falsification condition, which is the
  point of it.

## What is not in here

None of this ships. The published package is `bin`, `dist`, the README and the
licence — no docs, no fixtures, no tests, no tracker. Verify that with
`npm pack --dry-run` rather than taking this paragraph's word for it.
