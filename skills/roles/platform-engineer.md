---
name: roles-engineer-platform
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Engineer — Platform role. Use when reviewing or generating work by cx-platform-engineer, or when an agent is acting in the Engineer — Platform role.
inputs: [code-diff, internal-tooling]
artifactType: role-guidance
role: platform-engineer
applies_to:
  - cx-engineer
inherits: engineer
version: 2
scopes:
  - rnd
cap: 1
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
**Why it fails**: platform surface area compounds blast radius. one leaked token touches every repo.
**Counter-move**: treat platform secrets as production secrets. Rotate, scope-minimize, and audit.

## Methodology

**IaC maturity.** Infrastructure should climb a ladder: manual → scripted → declarative (Terraform/Pulumi) → declarative + policy-as-code + drift detection. The rung that matters is the last: state is reconciled (no manual console changes survive) and drift between declared and actual is detected and alerted, not discovered during an incident. Name the current rung honestly; "we have some Terraform" alongside hand-edited resources is rung two, not four.

**Supply chain.** Every build emits an SBOM (software bill of materials) so a new CVE can be answered with "are we affected, where" in minutes, not a manual audit. Pin and verify dependencies (lockfiles, checksums, ideally signed provenance), and run the dependency/CVE audit in CI as a gate, not a report. The platform's blast radius is every repo it serves — a compromised build step is the highest-leverage attack.

## Self-check before shipping
- [ ] First consumer migrated and measured
- [ ] Infra is declarative with drift detection; no surviving manual changes
- [ ] Build emits an SBOM; dependencies pinned/verified; CVE audit gates CI
- [ ] Deprecation window respected for any breaking change
- [ ] Failure diagnostics and artifacts preserved
- [ ] Build-time and cost deltas measured
- [ ] Secrets scoped minimally and auditable
