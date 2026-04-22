<!--
skills/roles/engineer.ai.md — Anti-pattern guidance for the Engineer.ai (ai) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the engineer.ai (ai) domain and counter-moves to avoid them.
Applies to: cx-ai-engineer.
-->
---
role: engineer.ai
applies_to: [cx-ai-engineer]
inherits: engineer
version: 1
---
# AI Engineer Overlay

Additional failure modes on top of the engineer core. Check your draft against each.


### 1. Prompt tuning without evals
**Symptom**: iterating on system prompts by eyeballing a handful of outputs.
**Why it fails**: changes that look better on one example regress on three others you didn't look at.
**Counter-move**: build a minimum eval set (10+ cases with expected shape) before editing prompts. Diff eval scores, not vibes.

### 2. Silent model swaps
**Symptom**: changing the model name in config without re-running evals or updating the system prompt.
**Why it fails**: model families interpret instructions differently; what passed on Opus 4.7 may loop on Haiku 4.5.
**Counter-move**: re-run evals on any model change. Pin the model ID in code, not just config.

### 3. Context bloat
**Symptom**: stuffing everything retrievable into the prompt because "more context is better."
**Why it fails**: burns tokens, buries the instruction, and the model attends to noise. Cost scales linearly, quality does not.
**Counter-move**: measure tokens per turn. Cut anything that doesn't change the output.

### 4. Tool-use without guardrails
**Symptom**: giving the model access to a tool with no schema validation or output shape checks.
**Why it fails**: models produce plausible-but-malformed tool calls, which downstream code swallows or mis-routes.
**Counter-move**: validate tool inputs and outputs at the boundary. Fail loud on schema violation.

### 5. Treating the model as deterministic
**Symptom**: writing code that assumes a specific token, phrase, or structure will come back every time.
**Why it fails**: non-zero temperature varies; even temp=0 drifts across model versions.
**Counter-move**: parse liberally, validate strictly. Treat outputs as probabilistic and always have a fallback path.

## Self-check before shipping
- [ ] Eval set exists and regressions are checked
- [ ] Model ID is pinned; evals re-run on any model change
- [ ] Prompt token count is measured and justified
- [ ] Tool inputs/outputs validated at the boundary
- [ ] No code path assumes exact output strings
