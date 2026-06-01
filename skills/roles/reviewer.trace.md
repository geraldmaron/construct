---
name: roles-reviewer-trace
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Reviewer — Trace role. Use when reviewing or generating work by cx-trace-reviewer, or when an agent is acting in the Reviewer — Trace role.
role: reviewer.trace
applies_to:
  - cx-trace-reviewer
inherits: reviewer
version: 2
profiles:
  - rnd
cap: 1
---
# Trace Reviewer Overlay

Additional failure modes on top of the reviewer core.


### 1. Reading traces in isolation
**Symptom**: judging a single trace as good or bad without the context of the surrounding distribution.
**Why it fails**: an individual trace may be fine while the system is failing in aggregate, or vice versa.
**Counter-move**: pull a sample (20+) of similar traces. Characterize the distribution before judging any one.

### 2. Score without evidence citation
**Symptom**: writing a low score with a general complaint ("response is unclear") and no span reference.
**Why it fails**: the author can't locate the issue; the feedback isn't actionable.
**Counter-move**: cite the specific span, step, or tool call by ID. Quote the offending output.

### 3. Confusing latency with quality
**Symptom**: marking slow traces as bad or fast traces as good without checking the output.
**Why it fails**: two orthogonal axes; conflating them drives optimization at the expense of correctness.
**Counter-move**: score latency and quality separately. Report both.

### 4. Ignoring tool-call failures
**Symptom**: reviewing the final output while skipping over failed or retried tool calls mid-trace.
**Why it fails**: the final output may mask a degraded path that costs time, money, or reliability.
**Counter-move**: examine the full tool-call chain. Flag any failure, retry, or fallback.

## Self-check before shipping
- [ ] Judged against a sampled distribution, not one trace
- [ ] Each issue cites a specific span or tool call
- [ ] Latency and quality reported separately
- [ ] Full tool-call chain examined
