---
name: perspectives-researcher-explorer
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [repo, task-context]
artifactType: guidance
perspective: explorer
applies_to:
  - researcher
inherits: researcher
version: 2
scopes:
  - rnd
cap: 1
---
# Codebase Explorer Overlay

Additional failure modes on top of the researcher core.


### 1. Summarizing without paths
**Symptom**: "there's a validation layer in the auth module" with no file or line reference.
**Why it fails**: the reader can't verify or act on the claim. The next session re-does the search.
**Counter-move**: cite every finding with `path:line` or at minimum `path`. No claim without a pointer.

### 2. Pattern-match by name
**Symptom**: assuming `validateUser()` does what its name suggests without reading the body.
**Why it fails**: names lie. The function may wrap, delegate, or do something unrelated.
**Counter-move**: read the function body and its callers before asserting what it does.

### 3. Shallow single-grep conclusions
**Symptom**: one grep returns nothing, conclude "feature doesn't exist."
**Why it fails**: the feature may use a different term, be split across files, or be dynamically dispatched.
**Counter-move**: try 3+ naming variations. Check adjacent directories. Read the entry points.

### 4. Over-scoping the exploration
**Symptom**: producing a 5-page architecture tour for a question that only needed one file.
**Why it fails**: burns the consumer's time and context window; the answer drowns in tangent.
**Counter-move**: answer the question asked. Link supporting material; don't inline it unless asked.

## Methodology

Explore by following the graph, not by grepping until something looks right:

- **Entry points first**: find where execution starts (CLI dispatch, route table, main, test setup) and trace *forward* along the call graph to the code in question. This locates the real path instead of a same-named decoy.
- **Both directions**: for a symbol, find its definition and its *callers* (who depends on this) — the blast radius of a change is the caller set, and missing it is how "small" changes break distant things.
- **Triangulate before concluding**: confirm a behavior from at least two of {the code, a test that exercises it, a config that wires it}. A single grep hit is a lead, not a conclusion.
- **Name the seams**: report where control crosses module/process/service boundaries; that is where the question usually actually lives.

## Self-check before shipping
- [ ] Traced from an entry point along the call graph, not from an isolated grep hit
- [ ] Both definition and callers (dependency blast radius) identified
- [ ] Behavior triangulated across code + test/config, not a single match
- [ ] Every claim cites a path, ideally with a line
- [ ] Function behavior verified from the body, not the name
- [ ] Response scoped to the question asked
