# Cutover directive (Gerald, 2026-09-02)

This is the execution directive for the architectural cutover, recorded verbatim so a fresh session can run the program without chat history. The tracker epic for the program names this file. Section numbers below are what bead descriptions cite.

---

# Claude Code execution prompt: Construct architectural cutover

You are working in the live `geraldmaron/construct` repository. Execute the complete architectural and product cutover described below. This is an implementation assignment, not a request for another audit, a speculative design, or a list of recommendations.

## Mission

Rebuild the current alpha into a coherent, project-bound, capability-aware Construct experience that:

- works naturally inside the agent host the user is already using;
- understands the project before attempting managed work;
- remembers authoritative context, design principles, constraints, sources, people, systems, and decisions;
- supplies qualified professional capabilities rather than thin personas or generic checklists;
- resolves complete workflow dependency chains before execution;
- detects meaningful drift between declared intent and observed implementation;
- can define recurring and event-driven outcomes without becoming an always-on agent platform;
- knows what Construct, the current host, and configured systems can read or change;
- acts only within explicit, inspectable policy boundaries;
- keeps routine interactions small and does not turn basic questions or simple recordkeeping into ceremony;
- has one state model, one vocabulary, one help surface, and no legacy product path.

The target product definition is:

> Construct is a project-bound, capability-aware operating layer for agent hosts. It progressively learns what a project or organization is, remembers authoritative context and constraints, invokes professional methods and capabilities appropriate to an outcome, detects material drift, performs permitted work through the current host or an explicitly configured runner, and surfaces only decisions that genuinely belong to the user.

## Non-negotiable direction

1. There is no backwards-compatibility requirement for any prior Construct alpha, CLI, schema, store, skill pack, generated file, configuration file, or documentation contract.
2. Do not migrate schema-23 or format-v1 records. Introduce a new state/config format and refuse unsupported formats with a safe, concise reset instruction.
3. Delete superseded code, tests, fixtures, scripts, flags, commands, documentation, generated material, and terminology. Do not leave aliases, fallback paths, compatibility shims, deprecated code, dead exports, or “legacy” help groups.
4. Do not silently delete user data. A small detector may identify known old Construct-owned paths, but it must not parse or support their schemas. Destructive cleanup must name exact targets and require explicit confirmation.
5. Preserve unrelated user changes. Do not reset, discard, or overwrite a dirty worktree.
6. Do not push, merge, publish, tag, or open a pull request unless explicitly instructed after implementation.
7. Do not stop after producing a plan. Work through the dependency chain, implement the code, update documentation, run the complete gate, repair failures, and deliver a final evidence-backed handoff.
8. Do not claim a live host, connector, skill, workflow, scheduler, or professional capability works unless the relevant path was actually exercised. Label untestable external behavior honestly.
9. Keep Construct local-first and host-native. Do not build a competing general-purpose agent runtime, chat UI, vector database, secrets manager, or always-running daemon.
10. The current interactive host wins. Construct must never silently switch hosts, spawn another general-purpose coding agent, or spend through another executor merely because one is installed.
11. User-facing interactions use ordinary language. MCP, capability tokens, leases, registry digests, and broker mechanics belong in diagnostics and developer references, not normal conversational instructions.
12. User direction in this prompt supersedes stale strategy statements, tracker acceptance criteria, or documentation that deliberately retired professional depth or accepted a dual-store transition.

## Verified starting point

Before changing code, independently confirm these facts against the current checkout. The last verified live `main` was `360071ec7073b5debcccd041835c81a1234cf048` (`3.0.0-alpha.22`). If the branch is newer, use the newer code and adjust file paths without weakening the requirements.

- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run smoke` are green at the baseline.
- The baseline test run contains 3,036 tests, 2,955 passes, 81 skips, and zero failures.
- `src/kernel/state/**` is the new project-local state path.
- `src/kernel/store/**` is the old home/schema-23 state path.
- `src/cli/project-store.ts` explicitly says legacy verbs still use `withStore()`.
- `src/cli/source.ts`, `src/cli/status.ts`, `src/cli/maintenance.ts`, and many other public surfaces still use or describe the older store and vocabulary.
- `src/cli/status.ts` still mentions the removed `record_outcome` tool.
- `construct init` creates `.construct/state/construct.sqlite`, while the existing source path can create a separate XDG/home `construct.db`.
- `src/hosts/mcp/interactive.ts` currently exposes 12 tools, even though the recent release verdict records 13.
- `start_run` trusts the host to supply arbitrary concerns and arbitrary task roles. Empty tasks can create a run with no executable work.
- `submit_work` leaves a draft, but the interactive surface does not expose the full review/challenge/promotion lifecycle.
- `src/kernel/state/schema.ts` has richer StaffMember and Routine columns than `src/cli/staff.ts` and `src/cli/routine.ts` allow a user to configure.
- Routines are currently manual and depend on an external clock that the user wires themselves.
- `skills/` contains seven method skills plus the operational `construct` skill. Only the operational skill auto-installs.
- `docs/internal/skill-scorecards.md` says trigger precision/recall, A/B lift, and observed cross-host loading remain unqualified.
- `.claude/skills/construct-*` generated lenses are not the shipped professional capability layer.
- The older kernel contains useful ideas in `brief`, `capabilities`, `challenge`, `completion`, `context`, `implication`, `lessons`, `plan`, `run`, `verify`, and `watch`, but those ideas are not coherently connected to the v1 interactive product path.

If any fact is no longer true, record the contrary file/test evidence and continue from the actual code. Do not assume the recent release verdict is accurate merely because it is recent.

## Start safely

1. Read `AGENTS.md` completely.
2. Run `bd prime` and inspect relevant open/closed work if `bd` exists. If the binary is unavailable, do not install system software or block execution; maintain a precise internal task list and state the tracker limitation in the final handoff.
3. Inspect `git status`, the current branch, `origin/main`, recent history, and the package version. Fetch read-only if permitted. Never switch branches or discard changes without authorization.
4. Run and record the baseline gate before modifying source.
5. Build a reachability inventory based on imports, CLI dispatch, MCP registration, package exports/files, tests, smoke scripts, and documentation checks. Comments and filenames alone are not evidence of runtime reachability.
6. Use bounded read-only subagents only when they reduce latency for independent inventory work. Keep architectural decisions, cross-cutting edits, and final verification in the primary session. Do not create competing implementations.

## Target architecture

Implement one coherent dependency direction:

1. **Project model and state** define truth.
2. **Registries** describe capabilities and workflows.
3. **Resolver and policy engine** determine what can run.
4. **Services** operate on those contracts.
5. **Interactive and headless brokers** expose least-authority operations.
6. **CLI** provides setup, inspection, automation, and recovery.
7. **Skills and workflows** provide professional behavior.
8. **Documentation and generated references** derive from the same registries and command definitions.

The kernel must remain deterministic and host-agnostic. Filesystem, environment, process spawning, host discovery, external connectors, and clocks remain at adapters/surfaces. Do not let skills or workflow definitions execute arbitrary tools directly. They declare capability requirements; the resolver binds those requirements to available host or connector capabilities.

## 1. One project contract and one state universe

Create a new project/state format. A reasonable destination is project config format 2 and Construct state format 2, but use the next clean version warranted by the actual code. There is no migration from prior formats.

Use a clear project layout:

- `.construct/project.json`: small committed project identity and behavior configuration.
- `.construct/constitution.json`: committed, human-reviewable project intent, principles, protected constraints, success measures, and declared owners.
- `.construct/sources.json`: committed logical source declarations and source semantics that contain no credentials. Sensitive locators may remain in local state.
- `.construct/registry.lock.json`: committed resolved skill/workflow versions, sources, and content digests.
- `.construct/skills/`: optional project-authored capability packs.
- `.construct/workflows/`: optional project-authored workflows.
- `.construct/state/construct.sqlite`: the only runtime database; ignored by Git.

Do not retain `.construct/settings.json`, a home/global Construct work database, implicit shared workspaces, or the `state: home|local` split. A project-bound product must refuse to perform managed work when no project can be resolved. User presentation defaults may live in a conventional per-user config location, but project truth, permissions, source declarations, runs, and decisions must not.

Configuration precedence must be familiar and inspectable:

1. built-in safe defaults;
2. optional user presentation defaults;
3. committed project configuration;
4. environment variables for runtime/deployment concerns;
5. explicit command flags.

Provide `construct config explain <key>` or an equivalent command that prints the effective value and its source. Never allow a committed file to grant consent, carry secrets, select an arbitrary executable path, or enable consequential external writes.

Replace the current state schema with the smallest complete model supporting the intended workflows. It must include typed representations for:

- project profile and onboarding state;
- principles, constraints, success measures, glossary entries, and declared unknowns;
- sources and source snapshots;
- entities such as artifacts, systems, people, teams, initiatives, requirements, work items, code components, tests, metrics, and decisions;
- typed relationships between entities;
- claims with provenance, authority, freshness, sensitivity, confidence, and status (`observed`, `inferred`, `confirmed`, `superseded`, or equivalent);
- staff/capability assignments;
- skills and workflows resolved for the project;
- workflow runs, step runs, leases, attempts, and idempotency keys;
- deliverables and their verification/trust state;
- decisions and approvals;
- scoped capability grants and break-glass records;
- observations, drift findings, and proposed lessons;
- append-only activity/audit events.

Use normalized columns for fields that participate in policy, selection, querying, uniqueness, or state transitions. Do not hide core policy and workflow behavior in unvalidated `unknown` JSON blobs. JSON is appropriate for versioned input/output payloads with runtime validation.

Required state properties:

- foreign keys enabled;
- explicit transactions around multi-row state transitions;
- unique constraints for idempotency and deduplication;
- monotonic, validated lifecycle transitions;
- crash-safe leases and retries;
- append-only evidence/audit records where history matters;
- no silent partial success;
- deterministic timestamps injected through service clocks in tests;
- typed runtime validation at every file, broker, CLI, and database boundary.

## 2. Project Constitution and progressive discovery

Implement a first-class Project Constitution rather than expecting ground hints or loose source declarations to stand in for project understanding.

The constitution must capture at least:

- project name and plain-language purpose;
- project scale: solo, side project, team, multi-team program, or organization;
- lifecycle/maturity stage;
- current primary outcome;
- success measures;
- design and operating principles;
- protected constraints and explicit non-goals;
- canonical artifacts and documentation locations;
- ownership and decision rights;
- architectural boundaries and invariants;
- risk posture;
- review cadence;
- glossary;
- known unknowns.

Initialization and first activation use progressive discovery:

1. Inspect safe, already-readable project material before asking questions: repository shape, agent instructions, README, architecture/design documents, ownership files, package metadata, and configured source descriptions.
2. Draft an observed/inferred project profile with provenance.
3. Ask at most three initial human questions unless a consequential choice is blocked:
   - What is this to you: a side project, primary product, team project, or something broader?
   - What result matters most right now?
   - What should Construct be especially careful not to change or violate?
4. Ask deeper questions only when the answer changes scope, source authority, permission, or a quality gate.
5. Present inferred source authority or document roles as a proposed interpretation. Never silently promote ownership, authority, reporting lines, or project principles from inference to fact.

Support noninteractive initialization for CI and automation. It must never hang waiting for conversational input. Interactive questions belong in the host experience; CLI initialization should accept complete flags/files or create a clearly incomplete profile that `status` names.

## 3. Source semantics and context graph

Unify and port the valuable behavior currently split across legacy sources, source edges, source watches, records, context, provenance, and run source reads.

Each source needs:

- stable ID and kind;
- logical purpose;
- locator or host-resolved reference;
- authority level and the specific claims/entities for which it is authoritative;
- explicit statement of what it is not authoritative for;
- freshness expectation;
- sensitivity/retention classification;
- available read/write capabilities;
- identity mapping rules;
- connection/reachability status;
- last successful snapshot and evidence digest.

Support typed relationships including at least `governs`, `implements`, `verifies`, `depends_on`, `feeds`, `supersedes`, `contradicts`, `owned_by`, `contributes_to`, and `sourced_from`. Validate allowed endpoint types and prevent nonsensical relationships.

Organization mapping must be evidence-based:

- infer candidate people, teams, roles, ownership, and collaboration relationships from configured systems;
- preserve the distinction between formal structure, declared ownership, and observed collaboration;
- resolve identity ambiguity before merging records;
- require confirmation for reporting lines, authority, or consequential ownership assignments;
- show provenance and confidence for every inferred organizational relationship;
- do not claim HRIS, Jira, GitHub, or a profile is universally authoritative. Authority is configured per claim type.

Do not add fake live connectors. Preserve the host-MCP-first connector ladder where sound, but expose connection capability and failures through one source service. A connector must declare the system semantics and capabilities it provides. Credentials remain with the host, environment, or connector-specific credential mechanism, never the kernel or committed config.

## 4. Capability, skill, and workflow registries

Create a real local registry layer. This is a versioned catalog and resolver, not an online marketplace.

A suggested module shape is:

- `src/kernel/registry/models.ts`
- `src/kernel/registry/skill-registry.ts`
- `src/kernel/registry/workflow-registry.ts`
- `src/kernel/registry/capability-registry.ts`
- `src/kernel/registry/resolver.ts`
- `src/kernel/registry/dependency-graph.ts`
- `src/kernel/registry/validation.ts`
- `src/kernel/registry/lockfile.ts`

Adapt names to existing conventions, but keep responsibilities separate and dependency direction clean.

### Skill package contract

Keep `SKILL.md` portable and compliant with Agent Skills. Add one Construct companion manifest per Construct-aware skill, for example `construct.skill.json`, containing structured runtime metadata that does not fit portable frontmatter. Do not create multiple competing manifests.

The manifest must include:

- stable skill ID, title, semantic version, category, and owner/source;
- activation and stand-down intents;
- interaction classes it supports;
- outcomes and deliverable types it can own;
- required input contracts;
- output schemas/artifacts;
- required source types and minimum evidence;
- capability requirements, never concrete tool names;
- requested action tiers;
- skill and workflow dependencies with version ranges;
- quality gates, validators, and challenge requirements;
- escalation/handoff conditions;
- licensed-review boundaries;
- supported host/model observations without unsupported success claims;
- eval/fixture locations;
- bundle digest.

Enforce exact agreement between the portable frontmatter and Construct manifest for shared fields such as name/version. The bundle digest covers `SKILL.md`, manifest, references, scripts, assets, schemas, and eval fixtures in deterministic path order.

Skills must use progressive disclosure:

- registry metadata is cheap and available at bootstrap;
- the `SKILL.md` body loads only when selected;
- references/assets/scripts load only when the workflow step needs them;
- the host never receives the entire skill library by default.

### Workflow package contract

Add built-in workflows under a top-level `workflows/` package directory and project workflows under `.construct/workflows/`. Each workflow has one canonical manifest, for example `workflow.json`, containing:

- stable ID and semantic version;
- title, purpose, activation and stand-down rules;
- supported interaction class;
- typed input schema;
- ordered/DAG steps with stable IDs;
- `needs` dependencies;
- skill/version requirements;
- capability requirements;
- source and freshness requirements;
- per-step permission tier;
- input mapping and output contract;
- validators and challenge gates;
- failure, no-data, stale-data, retry, timeout, and cancellation policies;
- concurrency and deduplication policy;
- allowed triggers: manual, scheduled, or event;
- final deliverable contract;
- proposed context/lesson updates;
- eval/fixture locations;
- content digest.

The resolver must fail before execution for:

- missing skill/workflow/capability/source dependencies;
- incompatible versions;
- dependency cycles;
- missing step inputs;
- output-to-input schema mismatches;
- unknown action tiers;
- unavailable host/connector capabilities;
- ungranted consequential actions;
- missing validators on load-bearing outputs;
- stale or unavailable mandatory sources;
- ambiguous executor selection;
- lockfile divergence.

Every resolution result must explain why the workflow is runnable, blocked, outdated, or divergent. Never silently choose a “close enough” skill, source, role, host, or version.

### Versioning and currency

Implement:

- semantic versions per skill and workflow;
- deterministic bundle digests;
- a committed project lockfile of resolved versions/digests/sources;
- a generated shipped registry index checked into the package or produced deterministically during build;
- a `--check` generation command used by lint/CI;
- detection of installed/current/diverged/outdated/blocked states;
- status and doctor output for registry skew;
- an explicit update/reconcile operation that never overwrites project-authored skills or workflows without confirmation;
- release checks that fail if skill/workflow content changes without an appropriate version/digest update;
- package smoke tests proving schemas, built-in workflows, skill companions, and generated registry material are actually included in the npm tarball.

Do not add background update checks, silent network calls, or an online registry. Construct may compare the installed package, project lockfile, and project-authored bundles locally. A future remote source can implement the same registry-source interface.

## 5. Professional capability packs

Retain the seven current method skills as shared primitives where their content survives review:

- intake;
- context-mapping;
- investigative-research;
- decision-framing;
- requirements-structuring;
- written-voice;
- adversarial-review.

Do not represent those seven methods as the complete professional staff.

Replace the generated thin persona/lens story with high-quality professional practice packs. Build the initial set around real artifacts and workflows:

1. software-engineering;
2. system-architecture;
3. product-management;
4. experience-design;
5. program-delivery;
6. operations-reliability;
7. security-privacy;
8. strategy-research;
9. governance-risk, limited to compliance/legal/finance issue spotting and preparation for qualified review.

Do not create personality prompts or claim expertise because a role name exists. A professional pack is a bundle of obligations, doctrine, sources, procedures, templates, validators, risk rules, and handoffs.

Each pack must include:

- a complete portable `SKILL.md`;
- its Construct manifest;
- focused authoritative references with citations and review dates where doctrine is time-sensitive;
- templates/assets for the artifacts it owns;
- deterministic helper scripts or validators where they materially reduce model error;
- positive, negative, edge, and adversarial fixtures;
- evaluations for activation, stand-down, evidence quality, artifact completeness, and unsafe overreach;
- at least one end-to-end workflow that consumes it;
- explicit limitations and escalation boundaries.

Keep the operational `construct` skill small, but make it complete enough to teach the host:

- how to bootstrap the session;
- how to recognize the four interaction classes;
- when to stand down;
- how to use project context and registry metadata without loading everything;
- how to resolve a workflow before starting managed work;
- how to perform assigned work in the current host;
- how to submit evidence and run validators;
- how to surface permission requests and decisions conversationally;
- how to finish and hand the outcome back to the user;
- that it must not teach the user internal CLI/MCP plumbing or spawn another host.

Do not auto-install every professional pack into every host. `init` installs only the operational skill. Registry metadata makes available packs discoverable; selected skill bodies are loaded on demand. Users may explicitly pin/install project skills when a host requires filesystem projection.

## 6. Four interaction classes

Implement and test these classes across the operational skill, broker services, workflow selection, and user-facing documentation:

1. **Answer only:** answer a normal question. Do not create Construct records or a run.
2. **Remember:** record a requested note, decision, constraint, principle, or outcome using the smallest valid record. Do not create tasks or staff merely because something was recorded.
3. **Manage an outcome:** resolve a workflow, execute appropriately scoped work, verify it, and return the finished result.
4. **Maintain a standing outcome:** configure a recurring/event-driven workflow with sources, triggers, policy, evidence gates, and delivery behavior.

The host should infer the class from ordinary language. Ask only when choosing a higher class would materially change work, cost, persistence, permissions, or external side effects.

Required behavior examples:

- “What does this function do?” answers only.
- “Remember that we will not support schema migration before stable” records one decision/constraint and does not create a run.
- “Review this implementation against our design principles” selects the design-conformance workflow, resolves sources/skills/capabilities, performs the review, and returns a cited artifact.
- “Every January, compare team strategies to active Jira work and capacity” creates or proposes a standing workflow, explains missing source semantics or scheduler binding, and never pretends Jira velocity alone is capacity.

## 7. Workflow execution lifecycle

When a user runs a workflow, the system must:

1. bind to the active project and current host/session;
2. classify the interaction;
3. resolve the workflow version and complete dependency graph;
4. validate inputs, sources, source freshness, skills, capabilities, grants, executor, validators, and lockfile;
5. produce a concise preflight result and ask only for genuinely missing consequential decisions;
6. create one idempotent workflow run;
7. execute ready DAG steps through the current host or an explicitly pinned headless executor;
8. persist claims, evidence, step outputs, attempts, and audit events transactionally;
9. pause cleanly for decisions or unavailable capabilities;
10. resume after interruption without duplicating completed work or side effects;
11. validate each load-bearing step output;
12. challenge the final deliverable independently where the workflow requires it;
13. promote the deliverable only through kernel-owned lifecycle transitions;
14. return a finished artifact or a concise blocked/decision state;
15. propose, rather than silently apply, changes to the constitution, source semantics, skills, workflows, or learned project truth.

Use explicit run states such as `preflight`, `blocked`, `ready`, `running`, `waiting_for_decision`, `succeeded`, `failed`, and `cancelled`, with validated transitions. Use explicit step states and failure reasons. A task being “done” must not imply its deliverable is trusted or final.

## 8. Broker and host surfaces

Replace the current hand-maintained tool array with a single typed broker definition from which MCP registration, input schemas, descriptions, read/write annotations, tests, and reference documentation are derived.

Keep two authority surfaces:

- **Interactive broker:** current user session; may bootstrap, remember, start/continue outcomes, inspect context/registries, surface decisions, and submit work performed by this host.
- **Headless operator broker:** explicitly configured runner; limited to pre-resolved workflow steps, leases, scoped capabilities, output submission, and heartbeat/status. It cannot change project configuration, grant itself permission, resolve user decisions, or mark its own output final.

The exact tool grouping should follow MCP ergonomics and host compatibility, but the interactive surface must cover these clear jobs without a grab bag of unrelated flags:

- bootstrap/session status and capability handshake;
- project context summary and targeted context retrieval;
- minimal remember/record operation;
- workflow catalog/list/show/resolve/run;
- skill catalog/list/show/status;
- claim next interactive work and submit its evidence/output;
- run and deliverable status;
- inbox listing and explicit user decision relay;
- source status and refresh/request operations;
- staff/capability assignment inspection where relevant.

At session bootstrap return only the cheap summary:

- Construct/server version and project binding;
- host/client/executor identity;
- project profile completeness;
- unresolved onboarding questions;
- source reachability/freshness summary;
- skill/workflow registry health and lock status;
- available capability names and action tiers;
- currently granted/blocked action classes;
- open decisions and active runs;
- recommended next action.

Do not load entire skill bodies, source contents, or the full graph into the host at bootstrap. Provide targeted reads.

The host capability handshake must describe capabilities, not merely installed binaries:

- available read/write operations;
- resource/system scopes;
- current authorization/grants;
- session and executor identity;
- network/tool restrictions;
- cost/budget ceilings where known;
- project policy constraints;
- source availability and freshness.

## 9. Permission and autonomy model

Replace vague `auto`/`bypass` concepts and unvalidated policy JSON with a typed action lattice:

1. `observe`: read already granted project/context data and calculate status;
2. `draft`: produce an artifact or proposed change without applying it;
3. `project_write`: reversible writes to Construct state or project working files within an explicit outcome;
4. `external_write`: consequential changes to Jira, GitHub, messaging, deployment, access, or other systems;
5. `destructive`: irreversible deletion, overwrite of authoritative data, access revocation, or material spend;
6. `licensed_judgment`: legal, medical, regulated, fiduciary, or other qualified-human sign-off.

Defaults:

- observe and draft may run automatically inside existing grants;
- remember writes occur automatically only when the user explicitly asks to remember/record;
- project writes require an explicit managed outcome and project policy;
- external writes require action-time approval unless a narrow standing grant exists;
- destructive actions require action-time approval;
- Construct may issue-spot and prepare licensed work but never owns the licensed judgment.

Standing grants must be scoped by project, action, target system/resource, workflow, executor, maximum impact/budget, start/end time, and revocation state. Break-glass grants must additionally include a reason, short TTL, exact target, and audit event. Break-glass never disables evidence, source-integrity, or completion gates and never transfers to another executor.

Permission errors must say what operation was attempted, which capability/scope is missing, what remains safe to do, and the smallest step-up needed. Do not ask for all available permissions upfront.

## 10. Routines, scheduling, and events

Construct owns standing-outcome definitions and execution integrity; an external clock may own time.

Implement routine/workflow triggers with:

- manual, schedule, and event trigger definitions;
- schedule expression and timezone;
- external scheduler adapter identity;
- next/last run information;
- source freshness/no-data behavior;
- concurrency and overlap policy;
- idempotency/deduplication key;
- retry/backoff/timeout policy;
- permission boundary;
- delivery destination;
- enabled/disabled state;
- dry-run/preflight.

Provide adapters or generated recipes for common external clocks such as cron and CI without installing or supervising an always-on daemon. If a supported host automation service is available, treat it as another clock adapter. Construct must keep the run ledger, lock, retry decisions, evidence, and deliverable regardless of which clock fires it.

Build and test at least these built-in workflows:

- project bootstrap and constitution review;
- minimal remember/decision record;
- managed outcome with verification;
- design-principle conformance review;
- source freshness and drift review;
- adversarial deliverable review;
- strategy-to-execution and capacity review;
- standing/scheduled review wrapper.

The strategy-to-execution workflow must not use vector similarity as adjudication or Jira velocity as capacity truth. It must normalize initiatives, owners, dates, dependencies, allocations, constraints, skills, operational load, and historical throughput; preserve source authority; run deterministic conflict checks first; use model review for semantic conflicts; cite every material finding; show freshness and assumptions; and deliver conflicts, unlinked work, infeasible commitments, capacity ranges, and recommended decisions.

## 11. Drift detection and guardrailed learning

Implement drift against declared, traceable obligations rather than generic file changes.

Support lineage such as:

- principle → decision → requirement → work item → artifact/code component → test/metric → observed outcome;
- strategy → initiative → owner/team → allocation/capacity evidence → work item → delivery evidence;
- source → claim → dependent claim/artifact/workflow.

Detect at least:

- governing source changed and dependent claims are stale;
- principle or constraint lacks implementation/verification evidence;
- code/artifact changed without a related decision or requirement where policy requires one;
- requirement has no implementation or verification link;
- implementation contradicts a principle or accepted decision;
- duplicate or superseded documents remain active;
- initiatives lack owners, dependencies, capacity, work, or measures;
- active work has no strategy/goal linkage;
- incompatible commitments compete for the same constrained capacity;
- source authority or freshness is insufficient for a conclusion.

Run deterministic checks before model review. Every semantic finding must include evidence references, affected obligations, confidence, and a repair or decision path. Silence is correct when nothing material changed.

Learning lifecycle:

1. observation;
2. proposed claim/lesson;
3. evidence and affected scope;
4. deterministic/eval checks;
5. human approval when risk or policy requires it;
6. admitted versioned lesson;
7. later invalidation/supersession when evidence changes.

Never let a run rewrite a skill, workflow, constitution, permission, source authority, or project truth merely because the model inferred something. Preserve and port the sound parts of `src/kernel/lessons/**` rather than keeping its old store coupling.

## 12. CLI and user experience

Replace the current 37-verb surface with a small object-oriented CLI intended for setup, inspection, automation, and recovery. Ordinary interactive use remains conversational in the host.

Target a surface close to:

- `construct init`
- `construct status`
- `construct doctor`
- `construct config get|set|unset|list|path|validate|explain`
- `construct project show|validate|refresh`
- `construct source add|list|show|update|retire|relate|refresh`
- `construct skill list|show|install|remove|update|verify`
- `construct workflow list|show|resolve|run|enable|disable|validate`
- `construct run list|show|cancel|resume`
- `construct inbox list|show|resolve`
- `construct staff list|show|add|update|pause|retire`
- `construct serve`
- `construct reset`
- `construct completion`
- `construct version`
- `construct help`

Adjust exact nouns only if tests and user-task clarity justify it. Do not preserve old verbs as aliases. Do not expose `work`, `role-serve`, `ask`, `outcome`, `notes`, `compose`, `plan`, `propose`, `audit`, `mode`, `consent`, `trust`, `watch`, `reconcile`, `waive`, `revoke`, `verdict`, `corpus`, `lessons`, `backup`, or similar legacy verbs unless a required current use case cannot be expressed cleanly through the new object surface. In that case, implement the use case under the appropriate new noun, not the old verb.

CLI requirements:

- task-oriented grouped help;
- complete per-command/subcommand help;
- consistent `--json` for every read and automation-relevant operation;
- stable documented exit-code categories;
- `--dry-run` for consequential or scheduled execution;
- noninteractive operation never prompts or hangs;
- errors lead with the problem, then the safe next action;
- no stack traces without a debug flag;
- no essential meaning conveyed only by color;
- terminal escape hardening preserved;
- generated shell completions derived from the same command registry;
- singular/plural naming consistent across CLI, MCP, docs, and models;
- `status` answers project completeness, current work, decisions, source/registry health, and drift without opening another state universe;
- `doctor` verifies actual project state, config/schema validity, lock integrity, host binding, broker reachability, source capability, scheduler binding, and package completeness. It must not report healthy for a broken or missing active project.

Normal output follows: what happened, what did not happen, and what the user can do next. Avoid walls of internal vocabulary.

## 13. Concrete code cutover

Use the following as the minimum code dependency plan. Adjust only after proving actual imports/reachability.

### Phase A: establish the new core

- Replace `src/kernel/state/format.ts`, `schema.ts`, `open.ts`, and state access modules with the new format and typed state transitions.
- Expand `src/kernel/project/initialize.ts`, `layout.ts`, and config validation for the new project layout.
- Add Project Constitution, source semantics, context graph, claim/provenance, grant, registry, workflow-run, and drift services.
- Reuse or port pure logic from `src/kernel/brief/**`, `capabilities/**`, `challenge/**`, `completion/**`, `implication/**`, `lessons/**`, `plan/**`, `verify/**`, and `watch/**` only when it serves a consuming v2 workflow and has no old-store dependency.
- Delete unconsumed abstractions rather than preserving them for imagined future use.

### Phase B: port behavior, then delete the old universe

- Port necessary source authority/relations/snapshots from `src/kernel/store/sources.ts`, `source-edges.ts`, `source-watches.ts`, and related modules.
- Port necessary decision/proposal/consent behavior into typed v2 decisions and grants.
- Port necessary work-log, deliverable, challenge, completion, and lesson behavior into v2 services.
- Replace every `withStore()`/`openStore()` consumer with the new project service or delete the surface.
- Delete `src/kernel/store/**` completely when no imports remain.
- Delete old path resolution and home/local state selection from `src/cli/runtime.ts`, `local-state.ts`, and `settings-file.ts`; keep only genuinely reusable presentation/config logic under clearer modules.

### Phase C: registries and execution

- Add registry models, validators, resolver, dependency graph, lockfile, generation, and status.
- Add built-in workflow manifests and registry-aware skill packages.
- Bind brief capability resolution, source selection, policy, execution, validation, and completion through one workflow service.
- Ensure no workflow can enqueue arbitrary role strings or tasks that bypass registry resolution.

### Phase D: broker and CLI replacement

- Replace `src/hosts/mcp/interactive.ts` with typed definitions backed by services, not direct SQL/state modules.
- Preserve a separately scoped headless operator path; delete `role-serve` and other old broker surfaces once replaced.
- Rewrite `src/cli/index.ts` and command modules around the new object surface.
- Delete superseded CLI modules and tests; do not leave unused exports.
- Update package exports and `package.json#files` to include required schemas, built-in workflows, skill bundles, and registry material.

### Phase E: professional capabilities and drift workflows

- Requalify the seven methods against the new manifest and eval contract.
- Remove the generated lens/persona pack path and its stale `.claude/skills/construct-*` products if it no longer represents the architecture.
- Add the professional packs and built-in workflows.
- Add project bootstrap, design conformance, source drift, adversarial review, and strategy/capacity fixtures.

### Phase F: documentation, packaging, and complete removal

- Rewrite user documentation for the new product only.
- Generate command, broker, skill, workflow, config, and schema references from canonical definitions.
- Delete historical internal documents that assert the removed current architecture if they are shipped or treated as authoritative. Preserve only intentionally historical evidence, clearly isolated from current docs, if it still has research value.
- Remove old tests, fixtures, scripts, generated packs, and package files.
- Run zero-reference searches and the complete gate.

Do not move to a later phase while the earlier phase has two live truths. Temporary adapter code may exist inside a phase but must be deleted before the phase is considered complete.

## 14. Documentation as a product contract

Maintain a small authoritative documentation set:

- README: what Construct is, two-minute first use, and current limitations;
- first run and host behavior;
- project configuration and constitution;
- sources and source authority;
- skills and professional capability packs;
- workflows and dependency resolution;
- permissions and autonomy;
- recurring/scheduled operation;
- connectors and system semantics;
- CLI reference;
- broker/MCP reference for integrators;
- troubleshooting and recovery;
- architecture and state model for contributors;
- skill/workflow authoring and qualification;
- release verification.

Generate reference tables and examples where possible from command/broker/registry definitions. Execute documentation commands/examples in tests. CI must fail when:

- a command/subcommand/flag is undocumented or docs name a nonexistent one;
- broker tools and reference docs disagree;
- config schema and docs disagree;
- a skill/workflow registry entry lacks documentation or names a missing dependency;
- package contents omit a documented artifact;
- version/digest/lock material is stale;
- first-run output or workflow examples no longer match behavior.

Never make internal archaeology required reading for a user. Current docs must not mention removed verbs, stores, formats, persona packs, shared default workspaces, or deprecated flows.

## 15. Testing and acceptance

Use tests to prove the product contract rather than implementation strings alone.

### Required automated coverage

- fresh init creates the exact project layout and only one database;
- unsupported alpha state/config is refused without migration;
- no command creates or reads a global/home work database;
- configuration precedence and `explain` are correct;
- project discovery never crosses into an unrelated repository;
- bootstrap returns the correct project/host/capability/registry summary;
- answer-only behavior creates no records;
- remember behavior creates one minimal record and no run/tasks;
- managed outcome resolves a workflow and cannot start with unresolved dependencies;
- arbitrary concern/role strings cannot bypass the registry;
- skill/workflow version, digest, lock, update, divergence, and cycle detection;
- progressive skill loading and context-budget behavior;
- source authority, freshness, sensitivity, identity ambiguity, and provenance;
- permission tiers, standing grants, expiry, revocation, step-up, and break-glass scope;
- crash-safe workflow resume, leases, retries, cancellation, idempotency, and deduplication;
- draft/review/challenge/final lifecycle is kernel-owned;
- deterministic design-principle drift fixture;
- semantic drift fixture with evidence and a non-finding control;
- strategy/capacity fixture that refuses velocity-as-capacity and reports assumptions;
- schedule timezone, no-data, stale-data, overlap, retry, and external-clock behavior;
- CLI prose/JSON parity and stable exit codes;
- generated help, completions, docs, schemas, and registries remain synchronized;
- packaged install runs init → bootstrap → remember → managed workflow → decision → final deliverable using packaged bytes, not source-tree files;
- terminal injection, path traversal, symlink, malicious project config, prompt injection from sources, and excessive-permission requests fail safely.

### Real host conformance

Add a reusable host conformance harness that checks:

- installation/binding;
- operational skill discovery;
- bootstrap invocation;
- current-host preservation;
- ordinary-language interaction classification;
- targeted skill loading;
- managed workflow execution;
- decision relay;
- final handback;
- no nested host spawn.

Run it against every locally available supported host. A missing credential or unavailable host is an explicit untested result, not a pass. Keep CI deterministic and credential-free; live probes belong in an explicit release/conformance command.

### Deletion gates

Before declaring completion, these searches must have zero product-code/current-doc matches, apart from an intentionally isolated historical changelog if retained:

- `withStore`
- `openStore`
- `src/kernel/store`
- `schema 23`
- `record_outcome`
- `shared default workspace`
- `.construct/settings.json`
- `state: home`
- old CLI verbs and legacy help labels
- generated persona/lens pack paths that the new capability model replaces
- duplicate manually maintained command, broker, skill, or workflow catalogs

Also verify no orphaned files remain by checking imports, package contents, generated artifacts, test fixtures, and docs.

### Full gate

The final gate must include at least:

1. formatting/lint and generated-artifact checks;
2. typecheck;
3. all unit/integration/architecture/security tests;
4. first-run and host-protocol tests;
5. packaged-install smoke;
6. registry/lock/schema validation;
7. documentation example tests;
8. a clean `git status` containing only intended source changes.

After the implementation and full gate are green, follow the repository's release-version convention once: advance to the next alpha only if the package version is the source for shipped registry, skill, or workflow stamps; update the changelog; regenerate every derived artifact; and rerun the full gate. Do not tag or publish.

Do not reduce coverage, delete failing tests without replacing their surviving product obligation, or change assertions merely to make the gate green.

## 16. Product scenarios that must work

### Scenario A: basic question

Inside Claude Code in an initialized project, the user asks a normal code question. The operational skill recognizes answer-only behavior. Claude answers using its normal project access. Construct creates no run, decision, staff member, or record.

### Scenario B: minimal memory

The user says, “Record that we will not add schema migration until stable.” Construct records one decision/constraint with the user's wording, project binding, timestamp, and provenance. It does not create a workflow run or ask for roles, concerns, tasks, approval policy, or other irrelevant structure.

### Scenario C: design conformance

The user asks, “Review this feature against the project's design principles.” Construct bootstraps, identifies the governing constitution and artifacts, resolves the design-conformance workflow and skills, reads only relevant sources, checks deterministic invariants, performs semantic review, cites findings, validates the deliverable, records material drift, and returns a finished review. Unknown principles are surfaced as a focused question rather than invented.

### Scenario D: standing source review

The user defines a monthly review of governing documents against implementation. Construct validates sources, freshness, scheduler adapter, permissions, overlap behavior, and delivery. The external clock fires an idempotent run. No data or stale data follows declared policy. The user receives either a finished no-drift record, a cited drift report, or a concise blocked decision.

### Scenario E: organizational strategy review

The user connects strategy documents, Jira-like work data, and an HRIS/capacity source. Construct first confirms what each system represents and is authoritative for. It builds a provenance-rich candidate organization/initiative graph, resolves identities, calculates capacity ranges from explicit assumptions, identifies conflicts and unlinked work, and produces decisions. It does not equate profiles with authority, velocity with capacity, or similarity with contradiction.

### Scenario F: permissions

A workflow can read GitHub and draft a Jira change but lacks external-write permission. Construct completes the read and draft, then asks for the smallest scoped approval needed to apply that exact Jira change. Approval does not grant unrelated Jira writes, persist forever, or transfer to another executor.

## 17. Efficiency and maintainability constraints

- Favor small deterministic registries and services over framework machinery.
- Avoid new runtime dependencies unless they materially reduce complexity or security risk; justify each addition in the final handoff.
- Avoid repeated parsing/scanning during a session; cache immutable registry metadata by digest.
- Use pagination and targeted reads for large graphs, sources, histories, and catalogs.
- Keep bootstrap output bounded and stable.
- Do not store raw duplicate source content when a snapshot digest/reference is sufficient.
- Make refresh incremental by source snapshot/digest.
- Do not use embeddings when exact IDs, typed relationships, structured queries, or deterministic checks answer the question.
- Treat model review as a bounded workflow step with explicit inputs and output schema, not as hidden control flow.
- Keep current user-facing concepts few: project, source, skill, workflow, run, decision, staff member.
- A new abstraction must identify the shipped decision or workflow that consumes it.

## Final handoff

When implementation is complete, return:

1. the outcome in plain language;
2. the verified branch and final commit/worktree state;
3. a concise architecture summary;
4. the final project layout;
5. the final CLI and interactive/headless broker surfaces;
6. the skill and workflow catalogs with versions;
7. the configuration, capability, permission, and scheduling behavior;
8. the exact old modules/surfaces removed;
9. test and packaged-smoke results with counts;
10. live host/connector conformance results, including explicit untested items;
11. any remaining limitation that is supported by evidence and cannot safely be resolved in this assignment.

Do not describe unfinished work as a follow-up opportunity. If a requirement cannot be completed, state the concrete blocker, the evidence, what remains incomplete, and why proceeding would require a user decision or new authority. Otherwise, continue until the full gate is green and the old product universe is gone.
