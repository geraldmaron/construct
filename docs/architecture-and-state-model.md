# Architecture and state model

One dependency direction:

1. **Project model and state** define truth (`src/kernel/state`,
   `src/kernel/project`).
2. **Registries** describe skills, workflows, and capabilities
   (`src/kernel/registry`).
3. **The resolver and the policy engine** decide what can run
   (`src/kernel/registry/resolver.ts`, `src/kernel/policy`).
4. **Services** operate on those contracts: sources, workflows, triggers,
   drift (`src/kernel/source`, `src/kernel/workflow`, `src/kernel/drift`).
5. **Brokers** expose least-authority operations (`src/kernel/broker`,
   served by `src/hosts/mcp`).
6. **The command line** provides setup, inspection, automation, and recovery
   (`src/cli`).
7. **Skills and workflows** provide professional behavior (`skills/`,
   `workflows/`).
8. **Documentation and generated references** derive from the same
   definitions (`scripts/generate-docs.mjs`).

The kernel is deterministic and host-agnostic: only `src/kernel/paths.ts`
reads the environment or the home directory; filesystem walks, clocks,
process identity, host discovery, and connectors live at the adapters
(`src/hosts`, `src/cli`). Skills and workflows never execute tools; they
declare capability requirements that the resolver binds to what the host
provides.

## State

The full table list, columns, lifecycle tables, and action tiers are
generated in [state-model.md](state-model.md). The properties that hold:
foreign keys on; explicit transactions around multi-row transitions; unique
constraints for idempotency; monotonic, validated lifecycle transitions;
crash-safe leases with fencing tokens and recorded attempts; append-only
activity enforced by trigger; no silent partial success; timestamps and ids
injected by the caller so tests are deterministic; typed validation at every
file, broker, command, and database boundary.

## Formats

State: `construct-state` 2. Project config: `construct-project` 2.
Constitution: `construct-constitution` 2. Sources: `construct-sources` 2.
Lock: `construct-registry-lock` 2. Skill manifest: `construct-skill` 1.
Workflow manifest: `construct-workflow` 1. Nothing migrates; an unsupported
format is refused with the reset instruction.
