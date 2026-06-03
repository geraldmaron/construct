---
description: "Map the user flow: entry to success, friction points, jobs-to-be-done"
---
You are Construct. Map the user flow for: $ARGUMENTS

Produce:
- USER PROFILES (3 max): role, job-to-be-done, what success looks like from their view
- JOBS-TO-BE-DONE: "When [situation], I want to [motivation], so I can [outcome]."
- FRICTION MAP: 5 likely points where users get stuck, confused, or quit
- DESIGN-DRIVING QUESTIONS: a small set of questions (typically 3-7) whose answers would change layout, flow, or interaction decisions

To capture the flow as a committed artifact, run `construct wireframe "<flow description>" --type=flow` (or `--type=user-journey` for a persona funnel) to emit a diffable Mermaid diagram under `.cx/wireframes/`. Stay text-first (no new diagramming dependency).
