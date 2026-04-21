<!--
skills/roles/product-manager.md — Anti-pattern guidance for the Product-manager role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager domain and counter-moves to avoid them.
Applies to: cx-product-manager, cx-business-strategist.
-->
---
role: product-manager
applies_to: [cx-product-manager, cx-business-strategist]
inherits: null
version: 1
---
# Product Manager — Role guidance

Load this before drafting. These are the failure modes that separate strong role output from weak role output — check your draft against each.


### 1. Solution in the problem statement
**Symptom**: the problem is phrased as a missing feature ("users need a share button") instead of a user pain ("users cannot get their output to a collaborator without leaving the product").
**Why it fails**: anchors the team on one implementation before alternatives are considered; forecloses cheaper or better solutions.
**Counter-move**: write the problem as a user-observable pain with evidence. Save solutions for the proposal section.

### 2. Unfalsifiable acceptance criteria
**Symptom**: criteria use words like "intuitive", "fast", "robust", "delightful" with no numeric or observable threshold.
**Why it fails**: neither engineering nor QA can decide when the work is done; reviews devolve into taste arguments.
**Counter-move**: rewrite each criterion as a condition a stranger could check without asking the author.

### 3. Vanity metrics
**Symptom**: success measured by clicks, signups, page views, or "engagement" without connection to the user outcome.
**Why it fails**: rewards surface activity that looks like progress while the underlying problem persists.
**Counter-move**: name the user or business outcome. Pick a metric whose movement requires that outcome to occur.

### 4. Missing user evidence
**Symptom**: the PRD cites no tickets, interviews, session recordings, or data. The source is "stakeholder said".
**Why it fails**: stakeholders generalize from one loud user; the team ends up building for the loudest, not the representative.
**Counter-move**: cite at least two independent evidence sources. If evidence is thin, say so and propose a research step before committing.

### 5. Unbounded scope
**Symptom**: "goals" and "non-goals" are both empty, or non-goals is missing entirely.
**Why it fails**: every reviewer adds to the scope; the doc becomes a wishlist and the project misses its date.
**Counter-move**: force yourself to write three explicit non-goals. If you cannot, the scope is not thought through yet.

### 6. Stakeholder bias over user evidence
**Symptom**: requirements trace to an executive's preference, not to user data.
**Why it fails**: builds the wrong thing confidently. Eventually the executive moves on; the feature stays.
**Counter-move**: separate what the business wants from what the user needs. Name both. Explain how they reconcile.

### 7. Hiding the tradeoff
**Symptom**: the PRD reads as if the proposal has only upside.
**Why it fails**: loses credibility with engineering and leadership; tradeoffs surface in implementation as surprises.
**Counter-move**: write the strongest case against your own proposal. If you cannot, you have not understood it.

### 8. Deadlines without constraints
**Symptom**: a ship date with no mention of what could slip, what is fixed, and who is on the team.
**Why it fails**: the deadline becomes a wish. Scope balloons to fill available time and then the date slips anyway.
**Counter-move**: name at least one of: fixed scope, fixed quality bar, fixed team size. Everything else is the flex.

## Self-check before shipping

- [ ] Problem describes pain, not a missing feature
- [ ] Acceptance criteria are observable by a stranger
- [ ] Success metric is a user or business outcome, not activity
- [ ] At least two independent evidence sources cited
- [ ] Non-goals section has a meaningful number of items for scope control
- [ ] The strongest counter-argument is named and addressed
- [ ] Tradeoff between scope, date, and quality is explicit
