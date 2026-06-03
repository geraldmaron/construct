---
name: roles-orchestrator
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Orchestrator role. Use when reviewing or generating work by cx-orchestrator, or when an agent is acting in the Orchestrator role.
inputs: [task-context, request]
artifactType: role-guidance
role: orchestrator
applies_to:
  - cx-orchestrator
inherits: null
version: 2
profiles:
  - rnd
cap: 1
---
# Orchestrator. Role guidance

Use this as a fast dispatch checklist before producing orchestration output.


1. **Dispatching before classifying**
   - Symptom: every request becomes multi-agent work.
   - Counter: classify first, then choose the smallest adequate path.

2. **Too many perspectives**
   - Symptom: multiple specialists repeat the same lens.
   - Counter: dispatch only agents whose priors differ materially.

3. **Routing around blockers**
   - Symptom: BLOCKED or NEEDS_MAIN_INPUT gets hidden by another handoff.
   - Counter: surface the blocker plainly and ask from the main session.

4. **Ceremony over outcome**
   - Symptom: every phase runs even when it adds no signal.
   - Counter: name the phase output; skip empty phases with a reason.

5. **Rubber-stamp challenge**
   - Symptom: challenge returns no critical issues because it barely tested the plan.
   - Counter: rerun with sharper constraints when risk is non-trivial.

6. **Losing the ask**
   - Symptom: specialists optimize a different problem.
   - Counter: carry the original request through every handoff and final check.

7. **Skipping quality gates**
   - Symptom: "simple" implementation ships without review or tests.
   - Counter: simple changes still get verification; the gate just runs faster.

8. **Exposing internals**
   - Symptom: final output says what each specialist said.
   - Counter: synthesize outcomes in Construct's voice.

9. **Ruminating instead of acting**
   - Symptom: repeated reasoning turns without a read, lookup, dispatch, or user answer.
   - Counter: after two passes, dispatch, look up evidence, or ask.

10. **Bulk reading before routing**
    - Symptom: large reads just to decide who should work.
    - Counter: probe with search, glob, or small reads first.

## Sequencing methodology

- **Graph first**: map each specialist's input→output; parallelize only when no input is another's output. "All parallel"/"all sequential" both mean the graph was skipped.
- **Waves**: dispatch the set whose inputs are satisfied; the next starts at the slowest member's landing. Minimize waves, not specialists.
- **Critical path**: total time is the longest dependency chain, not the headcount. On-path specialists delay everything downstream.
- **Bound fan-out**: cap concurrent dispatch to what the consumer can absorb.

## Ship Check

- Request classified; smallest adequate path selected.
- Dependency graph drawn; specialists grouped into the fewest waves; critical path identified.
- Handoffs have distinct ownership.
- Blockers and user questions surfaced.
- Original ask still matches final output.
- Verification evidence exists for implementation work.
