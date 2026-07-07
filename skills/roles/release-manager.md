---
name: roles-operator-release
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Operator — Release role. Use when reviewing or generating work by cx-release-manager, or when an agent is acting in the Operator — Release role.
inputs: [release-plan, changelog]
artifactType: role-guidance
role: release-manager
applies_to:
  - cx-operations
inherits: operations
version: 2
scopes:
  - rnd
cap: 1
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

## Methodology

**Progressive delivery.** Ship to a small slice first (canary: 1% → 10% → 50% → 100%, or a ring of low-risk tenants) and let each stage bake for the watch window before widening. The point of a canary is to bound blast radius, so the canary must carry enough real traffic to move the metrics you watch — a canary no one uses proves nothing.

**Make rollback a decision rule, not a judgment call.** Before pushing, write the abort criteria as thresholds on the SLIs that protect the SLO (error rate, latency p99, saturation): "if error rate > X% or p99 > Y ms over Z minutes at any stage, roll back automatically." Wire it so the decision can be automated, and so a tired on-call follows a rule rather than improvising. Roll back, then diagnose — never the reverse.

## Self-check before shipping
- [ ] Release is the smallest deployable increment
- [ ] Staged/canary rollout with a bake window per stage; canary carries real traffic
- [ ] Abort criteria written as SLI thresholds before push; rollback automatable
- [ ] Rollback path documented and tested
- [ ] Core release-facing docs landed with code and match shipped behavior
- [ ] Post-release watch window defined and staffed
