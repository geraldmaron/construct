<!--
skills/roles/operator.release.md — Anti-pattern guidance for the Operator.release (release) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the operator.release (release) domain and counter-moves to avoid them.
Applies to: cx-release-manager.
-->
---
role: operator.release
applies_to: [cx-release-manager]
inherits: operator
version: 1
---
# Release Manager Overlay

Additional failure modes on top of the operator core.


### 1. Big-bang releases
**Symptom**: shipping N weeks of changes behind one deploy, one feature flag, one migration.
**Why it fails**: when something breaks, you don't know which change caused it; rollback reverses everything.
**Counter-move**: ship in the smallest deployable increment. Feature-flag independently.

### 2. No rollback path
**Symptom**: a migration, schema change, or config flip that can't be undone in under 15 minutes.
**Why it fails**: the fix-forward pressure during an incident drives more damage.
**Counter-move**: for every release, document the rollback command or procedure. Test it before production.

### 3. Release notes after the fact
**Symptom**: writing the changelog the day of release, or later.
**Why it fails**: details are forgotten; breaking changes slip past users; stakeholder comms are reactive.
**Counter-move**: changelog entries land with the code change, not at release. Release compiles from committed entries.

### 4. No rollout monitoring window
**Symptom**: pushing to production and moving on to the next task.
**Why it fails**: regressions show up 30–60 minutes in; if nobody is watching, they compound.
**Counter-move**: define the post-release watch window (metrics + duration) before pushing. Hold the release until it's clean.

## Self-check before shipping
- [ ] Release is the smallest deployable increment
- [ ] Rollback path documented and tested
- [ ] Core release-facing docs landed with code and match shipped behavior
- [ ] Post-release watch window defined and staffed
