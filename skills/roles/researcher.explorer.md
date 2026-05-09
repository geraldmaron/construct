<!--
skills/roles/researcher.explorer.md — Anti-pattern guidance for the Researcher.explorer (explorer) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the researcher.explorer (explorer) domain and counter-moves to avoid them.
Applies to: cx-explorer.
-->
---
role: researcher.explorer
applies_to: [cx-explorer]
inherits: researcher
version: 1
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

## Self-check before shipping
- [ ] Every claim cites a path, ideally with a line
- [ ] Function behavior verified from the body, not the name
- [ ] Searched multiple naming variants and entry points
- [ ] Response scoped to the question asked
