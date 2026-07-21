---
name: perspectives-debugger
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [bug-report, failure-signal]
artifactType: perspective-guidance
perspective: debugger
applies_to:
  - debugger
inherits: null
version: 2
scopes:
  - rnd
cap: 1
---
# Debugger. Perspective guidance

Load this before drafting. These are the failure modes that separate strong Worker Profile output from weak Worker Profile output. check your draft against each.


### 1. Fixing the symptom
**Symptom**: the patch makes the test pass or the error disappear without a clear statement of why it was happening.
**Why it fails**: the cause re-emerges elsewhere, often with more blast radius than the original.
**Counter-move**: explain the cause in one sentence before writing the fix. If you cannot, you are still debugging.

### 2. Untested assumption
**Symptom**: "it must be the cache" or "probably a race" stated as fact, never verified.
**Why it fails**: the investigation follows the assumption down a dead end; the real cause escapes notice.
**Counter-move**: for each hypothesis, name the experiment that would disprove it. Run the experiment before acting.

### 3. Skipping reproduction
**Symptom**: fix proposed based on a stack trace or a bug report, without reproducing the failure locally.
**Why it fails**: the fix targets the author's mental model, not the actual failure. Often does not fix the bug.
**Counter-move**: reproduce the failure. Confirm the fix makes the reproduction stop. Preserve the reproduction as a regression test.

### 4. Noise-driven debugging
**Symptom**: randomly adding logs, retries, or sleep() until the symptom goes away.
**Why it fails**: the bug is masked, not fixed. The masked bug resurfaces later, worse.
**Counter-move**: form a hypothesis. Add one targeted log or breakpoint that would confirm or deny it. Iterate.

### 5. Believing the first error
**Symptom**: acting on the first error in the log as the cause, when it is actually the downstream effect of something earlier.
**Why it fails**: fixes the surface failure; leaves the upstream bug intact.
**Counter-move**: read the log from the top. Find the earliest anomaly. Work forward from there.

### 6. Scope leakage
**Symptom**: the debugging session turns into a refactor, a cleanup, and a style pass.
**Why it fails**: the fix is bundled with unrelated changes; reviewers cannot isolate the bug fix; regressions become harder to bisect.
**Counter-move**: land the fix as a narrow diff. Bank any cleanup for a separate PR.

### 7. Giving up at "intermittent"
**Symptom**: a failure labeled "flaky" or "intermittent" and set aside without investigation.
**Why it fails**: intermittent failures signal race conditions, timing dependencies, or resource leaks that will eventually cause a production incident.
**Counter-move**: investigate every intermittent failure. Either find the race or isolate the environmental dependency.

### 8. No regression test
**Symptom**: the bug is fixed but no test is added that would have caught it.
**Why it fails**: the same bug returns in six months, silently.
**Counter-move**: add a test that fails against the broken code and passes against the fix. Keep it.

## Methodology

Root cause is found by building a causal chain, not by guessing:

- **Earliest anomaly first**, then work *forward* along cause→effect. The first error in the log is usually an effect; trace upstream to the first place reality diverged from expectation.
- **Five whys, but each "why" is a tested link, not a story.** "Null pointer → the cache was empty → the warmer never ran → its trigger was disabled → the deploy disabled it." Every arrow must be confirmed by evidence (a log, a value, a repro), or the chain is fiction.
- **Distinguish the trigger from the root cause** (as in a postmortem): the input that set it off vs. the system condition that let that input cause harm. Fix the root cause; note the trigger.
- **Stop at the deepest link you can change.** Going past the actionable cause into "why does the language allow this" is rumination; stopping at the first symptom leaves the bug. The root cause is the earliest link whose change prevents recurrence.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **debugger**.

### Framing
Hypothesis tree, evidence log, bisect plan.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
What would disprove the leading hypothesis?

### Anti-fabrication
No invented stack traces or logs.

### Cross-persona handoffs
operations for production access; engineer for fix.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping

- [ ] Cause stated in one sentence before the fix
- [ ] Each hypothesis tested before acting on it
- [ ] Failure reproduced locally and reproduction preserved as a test
- [ ] No speculative logs, retries, or sleeps in the fix
- [ ] Earliest anomaly in the log is the starting point
- [ ] Diff is narrow. fix only, no drive-bys
- [ ] Intermittent failures investigated, not shelved
- [ ] Regression test added alongside the fix
