# Documentation

Everything here is written for someone using or integrating Construct. The
records of how it was built live in [`internal/`](internal/), separately and
labeled as history, so a reader can tell which they are holding. A lint holds
this list to the directory: a new file here is added below, which is the
moment someone decides it is documentation rather than a record.

## Start here

- [`first-run-and-hosts.md`](first-run-and-hosts.md) — install, initialize, and how the agent host behaves with Construct bound.
- [`project-configuration-and-constitution.md`](project-configuration-and-constitution.md) — the `.construct/` layout, configuration precedence, and the constitution.

## Using it

- [`sources-and-authority.md`](sources-and-authority.md) — declaring sources, authority per claim type, freshness, identity, organization.
- [`skills-and-packs.md`](skills-and-packs.md) — method skills, professional packs, progressive loading, versions and the lock.
- [`workflows-and-resolution.md`](workflows-and-resolution.md) — workflows, resolution before running, runs, deliverables and trust.
- [`permissions-and-autonomy.md`](permissions-and-autonomy.md) — the action lattice, approvals, standing grants, break-glass, the headless runner.
- [`recurring-operation.md`](recurring-operation.md) — standing outcomes fired by an external clock.
- [`connectors-and-semantics.md`](connectors-and-semantics.md) — what a connector declares, locators, credentials.
- [`troubleshooting-and-recovery.md`](troubleshooting-and-recovery.md) — failures, reset, blocked runs, registry skew, host wiring.

## Reference (generated from the definitions)

- [`cli-reference.md`](cli-reference.md) — every command and flag.
- [`broker-reference.md`](broker-reference.md) — every MCP tool on both surfaces.
- [`config-reference.md`](config-reference.md) — every configuration key and its tiers.
- [`catalog.md`](catalog.md) — shipped skills, workflows, capabilities, validators.
- [`state-model.md`](state-model.md) — tables, lifecycles, action tiers.
- [`exit-codes.md`](exit-codes.md) — the three exit codes.

## For contributors

- [`architecture-and-state-model.md`](architecture-and-state-model.md) — the dependency direction and the state properties.
- [`authoring-and-qualification.md`](authoring-and-qualification.md) — writing and qualifying skills and workflows.
- [`release-verification.md`](release-verification.md) — the gate and how an alpha is cut.
