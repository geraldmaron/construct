# Construct Strategy

Construct is a project-bound, capability-aware operating layer for agent
hosts. It progressively learns what a project or organization is, remembers
authoritative context and constraints, invokes professional methods and
capabilities appropriate to an outcome, detects material drift, performs
permitted work through the current host or an explicitly configured runner,
and surfaces only decisions that genuinely belong to the user.

The package is `@geraldmaron/construct`, continuing the predecessor's name on
the `3.0.0` line as prereleases under the `alpha` dist-tag. A prerelease
cannot move `latest`, so `latest` stays on the predecessor's `2.1.1` until a
`3.0.0` is promoted deliberately. The `construct` command name is unchanged.
No version on the `3.0.0` line carries compatibility with any earlier alpha:
formats, files, commands, and schemas change outright while the tag holds.

## North star

Point Construct at a project and it makes the obvious obvious: the constraint
that must not be violated, the principle the change contradicts, the source
that went stale under a claim, the initiative nobody owns, the write that
needs one exact approval. The person thinks about outcomes and answers only
the questions that are theirs. Everything else is done in the host they
already use, recorded, cited, and handed back finished.

## Commitments

1. **One project, one state.** Project truth lives in `.construct/` in the
   repository: `project.json`, `constitution.json`, `sources.json`,
   `registry.lock.json`, optional `skills/` and `workflows/`, and one
   ignored runtime database under `state/`. There is no home database and no
   shared workspace. A committed file describes; it never authorizes.
2. **Host-native, never a second runtime.** Construct runs inside the agent
   host the person is in, over MCP, and does the work there. It never
   spawns another general-purpose agent, never switches hosts silently, and
   never spends through another executor because one is installed. A
   headless runner exists only when explicitly configured and can claim,
   heartbeat, and submit; it cannot decide, grant, or finalize.
3. **Local-first, no daemon.** Nothing runs resident. Standing outcomes are
   fired by an external clock (cron, CI, a host's own scheduler) under an
   idempotency key; Construct keeps the ledger, the lock, the retries, the
   evidence, and the deliverable.
4. **Registries describe; the resolver binds.** Skills carry a Construct
   manifest beside their portable `SKILL.md`; workflows carry a manifest of
   typed inputs and DAG steps. Both are versioned and digested, locked per
   project, and resolved before any run starts. Nothing enqueues a step the
   resolver did not bind; nothing chooses a "close enough" skill, source, or
   version.
5. **Authority is declared per claim type.** A source is authoritative only
   for what the project says it is. A tracker is not authority for
   ownership; an HRIS is not authority for capacity; a profile is authority
   for nothing. Ownership, reporting lines, and membership read from any
   source are proposals until a person confirms them.
6. **Permission is a typed lattice.** observe, draft, project_write,
   external_write, destructive, licensed_judgment. Denials name the attempted
   action, the missing scope, what remains safe, and the smallest step-up.
   An approval covers exactly one action and expires. Break-glass is exact,
   reasoned, short, and never transfers. Nothing turns off the evidence,
   integrity, or completion gates.
7. **Deterministic before semantic.** Validators and drift checks run
   before a model reads. Every material finding cites its evidence and names
   the obligation it affects; similarity is never a contradiction; velocity
   is never capacity. Silence is correct when nothing changed.
8. **Trust is kernel-owned.** A finished step leaves a draft. Validation,
   challenge, acceptance, and finality move only through recorded
   transitions, the last two by the person.
9. **Learning is proposed, never applied.** A run may propose a lesson, a
   constitution change, or a source semantic; a person admits it. No run
   rewrites a skill, workflow, or project truth because a model inferred
   something.
10. **Professional capability is obligations, not personas.** A pack is
    doctrine with cited sources, obligations a deliverable must carry,
    procedure, templates, checks, fixtures, and explicit limits. Licensed
    judgments (legal, tax, audit, medical, fiduciary) are prepared for a
    qualified person and never given.
11. **Measured gates over asserted claims.** Anything called working carries
    a test, a probe, or a recorded run. What could not be exercised is
    labeled untested, never assumed.
12. **One voice, ordinary language.** User-facing surfaces speak plainly.
    Protocol, tokens, digests, and lattice mechanics belong to diagnostics
    and references.

## What is killed

Named so it stays dead: the keyword implication map and model namer, roles
as lenses over a shared playbook and the generated lens packs, per-role
depth and tuned-family matrices, the home database and repo-local state
toggle, the 37-verb command line and its legacy aliases, the format-1 project
state, host spawn adapters and per-host trial packets as the proof of
host-independence, external-subject and stakeholder-packet phase gates as
acceptance of a surface that no longer exists, workspace presets, and any
online registry or marketplace.

## Program shape

The cutover ran as six phases in one program, each landing with the full gate
green and no later phase starting while an earlier one held two live truths:
A the core (state format 2, project layout and configuration, constitution
and discovery, sources and the context graph, the policy engine); B the
deletion of the old universe with a minimal object command line; C the
registries and the workflow service with triggers; D the typed broker with
host wiring and the remaining command nouns; E the requalified method skills,
the nine professional packs, the built-in workflows, and drift detection; F
documentation as a product contract and packaging, conformance, and release
verification. The tracker holds the per-phase record.

What remains after F is use: real outcomes run in real hosts by the author,
each exercised path recorded, each untested path named.

## Named risks

1. **The activation proxy overpromises.** Skill triggers are checked by a
   lexical proxy; the real judge is the host model. Mitigation: model-judged
   fixtures ship beside every skill and run only under the conformance
   command against a real host; nothing lexical is reported as a model result.
2. **Doctrine goes stale.** Pack sources carry review dates and were not
   re-opened in the build that cited them. Mitigation: each source names a
   review-due date; a finding leaning on a clause must open it first.
3. **A connector that does not exist gets assumed.** Only directory reading
   ships; every other source kind reads through the host's own tools or is
   reported unreachable. Mitigation: refresh never fabricates a snapshot, and
   a source with no reader is unreachable, not empty.
4. **Solo bandwidth.** Mitigation: deterministic checks in CI, model-judged
   evals only under an explicit command, and a small surface with one
   registry behind help, completions, docs, and tests.
