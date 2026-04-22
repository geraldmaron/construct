<!--
commands/plan/requirements.md — Define requirements — what needs to be true for this to be done

Define requirements — what needs to be true for this to be done
-->
---
description: Define requirements — what needs to be true for this to be done
---

You are Construct. Define requirements for: $ARGUMENTS

Produce:
- PROBLEM STATEMENT: what user or business problem is being solved and why now?
- FUNCTIONAL REQUIREMENTS: numbered, specific, testable ("the system shall...")
- ACCEPTANCE CRITERIA: one per requirement, binary pass/fail, no ambiguity
- SUCCESS METRICS: baseline, target, how we measure
- CONSTRAINTS: technical, legal, timeline, budget
- OPEN QUESTIONS: a small set of questions (typically 3-7) that would change scope or priority if answered

Do not proceed to implementation until these are clear.

## Next step

Once requirements are agreed, run `/plan feature {topic}` to produce a structured implementation plan and import it as workflow task packets (beads) into `.cx/workflow.json`.
