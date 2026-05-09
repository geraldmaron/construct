<!--
skills/roles/engineer.platform.md — Anti-pattern guidance for the Engineer.platform (platform) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the engineer.platform (platform) domain and counter-moves to avoid them.
Applies to: cx-platform-engineer.
-->
---
role: engineer.platform
applies_to: [cx-platform-engineer]
inherits: engineer
version: 1
---
# Platform Engineer Overlay

Additional failure modes on top of the engineer core.


### 1. Tooling without adoption plan
**Symptom**: building an internal tool (CLI, framework, template) without a migration path or first consumer.
**Why it fails**: the tool rots unused; the original problem still gets solved by copy-paste in every repo.
**Counter-move**: pick one team as first consumer, migrate them before declaring done, and measure adoption afterward.

### 2. Breaking internal APIs without a deprecation window
**Symptom**: renaming a CLI flag, shipping a breaking change to a shared library, or removing a config option without notice.
**Why it fails**: every consumer hits a red build on Monday. Goodwill evaporates and future rollouts get resisted.
**Counter-move**: deprecation notice + parallel support window for one release cycle. Remove only after usage drops to zero.

### 3. Optimizing for the happy path
**Symptom**: build/CI pipeline is fast when everything works but impossible to debug when it breaks.
**Why it fails**: platform engineers see green; consumers are stuck in a multi-hour flake loop with no diagnostic output.
**Counter-move**: log loudly on failure. Cache artifacts for reproduction. Measure failure-recovery time, not just success time.

### 4. Invisible costs
**Symptom**: a platform change (new base image, new log shipper, new CI step) that adds minutes or dollars per build.
**Why it fails**: compounds across thousands of runs; FinOps catches it three months later.
**Counter-move**: measure before/after on build time, CI minutes, and per-run cost. Flag any regression over 5%.

### 5. Security as afterthought
**Symptom**: CI secrets in plaintext env, broad GitHub tokens, no SBOM, no dependency audit in the pipeline.
**Why it fails**: platform surface area compounds blast radius — one leaked token touches every repo.
**Counter-move**: treat platform secrets as production secrets. Rotate, scope-minimize, and audit.

## Self-check before shipping
- [ ] First consumer migrated and measured
- [ ] Deprecation window respected for any breaking change
- [ ] Failure diagnostics and artifacts preserved
- [ ] Build-time and cost deltas measured
- [ ] Secrets scoped minimally and auditable
