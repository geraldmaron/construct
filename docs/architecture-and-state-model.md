# Architecture and state model

One dependency direction:

1. **Project model and state** define truth (`src/kernel/state`,
   `src/kernel/project`).
2. **Registries** describe skills, workflows, and capabilities
   (`src/kernel/registry`).
3. **The resolver and the policy engine** decide what can run
   (`src/kernel/registry/resolver.ts`, `src/kernel/policy`).
4. **Services** operate on those contracts: sources, workflows, triggers,
   drift, the native work ledger, and what each session knows of the others
   in the project (`src/kernel/source`, `src/kernel/workflow`,
   `src/kernel/drift`, `src/kernel/work`, `src/kernel/coord`). Shared
   boundaries sit beside them: path containment (`src/kernel/safety`),
   credential redaction and safe rendering (`src/kernel/render`), and the
   skills the package ships (`src/kernel/skills`).
5. **Brokers** expose least-authority operations (`src/kernel/broker`,
   served by `src/hosts/mcp`).
6. **The command line** provides setup, inspection, automation, and recovery
   (`src/cli`).
7. **Skills and workflows** provide professional behavior (`skills/`,
   `workflows/`).
8. **Documentation and generated references** derive from the same
   definitions (`scripts/generate-docs.mjs`).

The kernel is deterministic and host-agnostic: only `src/kernel/paths.ts`
reads the environment or the home directory; clocks, process identity, git,
process launching, host discovery, and connectors live at the adapters
(`src/hosts`, `src/cli`). The kernel's own file access covers the walk up to
the project root, the project's files, declared directory sources, skill and
workflow bundles, and Construct's own state files. Skills and workflows
never execute tools; they declare capability requirements that the resolver
binds to what the host provides.

Bounded delegation follows the same direction. `src/kernel/delegation`
owns dispatch, native child work and claims, limits, review dispositions,
and integration eligibility. `src/hosts/delegation` owns CLI authentication
probes, process supervision, isolated worktree snapshots, patch application,
and configured validation commands. The kernel receives a driver interface;
it never builds a vendor command or imports process-launching code.

Execution snapshots are versioned `delegation.state.v1` records in the
existing append-only `work_events` table, one child work item per attempt.
Dispatch checks and writes run under the store's existing immediate
transaction. Existing sessions, reservations, work/run links, activity, and
reviews remain authoritative. There is no second database or schema upgrade.

## State

A project keeps one store, `.construct/state/construct.sqlite` (ignored by
Git), in its main checkout. Every git worktree of the project binds to that
store, so `construct init` and `construct reset` run in the main checkout,
not in a worktree. The store records its project's id; every binding,
`construct migrate`, and `construct doctor` check it, and a store that
belongs to a different project is refused (doctor's `state-project` check).

The full table list, columns, lifecycle tables, and action tiers are
generated in [state-model.md](state-model.md). The properties that hold:
foreign keys on; explicit transactions around multi-row transitions; unique
constraints for idempotency; monotonic, validated lifecycle transitions;
crash-safe leases with fencing tokens and recorded attempts; append-only
activity enforced by trigger; no silent partial success; timestamps and ids
injected by the caller so tests are deterministic; typed validation at every
file, broker, command, and database boundary.

## Formats

State: `construct-state` 4. Project config: `construct-project` 2.
Constitution: `construct-constitution` 2. Sources: `construct-sources` 2.
Lock: `construct-registry-lock` 2. Skill manifest: `construct-skill` 1.
Workflow manifest: `construct-workflow` 1. User defaults:
`construct-user-defaults` 1. A work snapshot written by
`construct work export` carries `construct-work-export` 1;
`construct work restore` refuses any other with its own error, not the
reset instruction.

Only the state database migrates. A complete store in format 2, 3 or 4 is
upgraded, one way, by `construct migrate` and nothing else: stop every
Construct session on the project first, since one still running an older
Construct would go on writing to the store without format 4's protections.
The command refuses while another process has the store open (`--force`
upgrades anyway), backs the file up beside it under the upgrade's own write
lock, and removes that backup again if the upgrade fails without changing
the store. A store written by a newer Construct is refused with the
instruction to upgrade Construct, never to reset. Any other state format, a
store missing one of its format's tables, and every other file format above
in an unsupported version are refused with the reset instruction.
