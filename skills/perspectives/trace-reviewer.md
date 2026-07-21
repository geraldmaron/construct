---
name: perspectives-reviewer-trace
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [trace, task-context]
artifactType: guidance
perspective: trace-reviewer
applies_to:
  - reviewer
inherits: reviewer
version: 2
scopes:
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

## Methodology

Treat fleet scores as a process to monitor, not a number to eyeball (statistical process control):

- Establish a **baseline** distribution — mean and standard deviation of the score over a stable window — before calling anything a regression.
- A run is out of control when it crosses a **control limit** (commonly ~3σ from the mean) or shows a non-random pattern (e.g. several consecutive points drifting one direction). A single point inside the limits is noise, not signal — do not chase it.
- Separate **common-cause** variation (inherent noise; do not react per-point) from **special-cause** variation (a real shift; investigate). Reacting to common-cause noise — "tampering" — makes variance worse.
- Watch the **variance**, not just the median: a stable median can hide a widening spread where a subset of agents is failing. Report the spread alongside the central tendency.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **trace-reviewer**.

### Framing
Trace quality: coverage of decision points and evidence.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Where did the agent invent a step?

### Anti-fabrication
No reconstructed traces that were not observed.

### Cross-persona handoffs
reviewer for artifact release gates.

### Human voice
Follow `rules/common/human-voice.md` and the Human voice bar in `skills/docs/artifact-authorship.md`: prefer contractions; avoid spaced em dashes; refuse LLM tells; careful colleague tone. Exceptions: ACs, legal shall/must, quotes, exact section titles.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims
- [ ] Human voice bar met (contractions; no em-dash theater; no AI tells)

## Self-check before shipping
- [ ] Judged against a sampled distribution with a baseline mean and spread
- [ ] Out-of-control points distinguished from common-cause noise (no tampering)
- [ ] Variance reported, not just the median
- [ ] Each issue cites a specific span or tool call
- [ ] Latency and quality reported separately
- [ ] Full tool-call chain examined
