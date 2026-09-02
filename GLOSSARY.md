# Glossary

The vocabulary binding for every surface: state, command line, broker, docs.
`scripts/lint-glossary-parity.mjs` reads this table and fails CI if a retired
synonym appears in `src/`; a retired word surfacing there is a drift signal.

| Term (use this) | Retired v2 synonym | Meaning |
|---|---|---|
| project | — | The repository Construct is bound to. Its truth lives in `.construct/`; managed work happens only inside one. |
| constitution | — | The committed, human-reviewed statement of what the project is for, its principles, protected constraints, success measures, owners, boundaries, risk posture, cadence, glossary, and known unknowns. |
| source | — | A system or document collection the project reads, with a purpose, a locator, authority per claim type, freshness expectation, sensitivity, and capabilities. Declared in `sources.json` or local to a checkout. |
| claim | — | Something a source, a person, discovery, or a workflow said about an entity, with provenance, authority, sensitivity, confidence, and a status of observed, inferred, confirmed, or superseded. |
| entity | — | A thing the context graph tracks: artifact, system, person, team, initiative, requirement, work item, code component, test, metric, decision. |
| relation | — | A typed edge between entities (governs, implements, verifies, depends on, feeds, supersedes, contradicts, owned by, contributes to, sourced from, reports to, member of) with a basis of formal, declared, observed, or inferred. |
| artifact | — | A thing the project owns that a source can point at and a principle can govern: a document, a design record, a specification. Never the output of a run, which is a deliverable. |
| skill | persona | A portable `SKILL.md` plus a Construct manifest (`construct.skill.json`) declaring activation, stand-down, capabilities, tiers, dependencies, gates, limits, and evals. A method skill is shared technique; a professional pack is doctrine with obligations. |
| workflow | trunk | A versioned manifest of typed inputs and DAG steps with per-step skills, capabilities, sources, tiers, validators, retry, timeout, triggers, and policies. |
| resolver | dispatcher | Binds a workflow to exact skill versions, capabilities, sources, grants, executor, and lock entries before a run starts, and names every reason it cannot. |
| run | — | One execution of a workflow under an idempotency key, moving through preflight, blocked, ready, running, waiting for decision, succeeded, failed, cancelled. |
| step | — | One unit of a run, leased under a fencing token, gated by the policy engine, validated on submission, retried by policy. |
| deliverable | — | What a run produces, with a trust state of draft, validated, challenged, accepted, final, or rejected. Distinct from an artifact, which the project already owns. |
| decision | — | A call that belongs to the person: a decision, an approval, a clarification, or a block, raised by a run and answered in the host. |
| grant | — | A scoped permission: action tier, target system and resource, workflow, executor, budget, window, revocation. A break-glass grant adds a reason, a short expiry, and an exact target. |
| action tier | — | observe, draft, project_write, external_write, destructive, licensed_judgment. The last is never Construct's. |
| trigger | — | A standing outcome's definition: schedule or event, adapter, overlap policy, permission boundary, delivery. Fired by an external clock under an idempotency key. |
| drift finding | — | A deterministic or cited semantic finding that an obligation is unmet, with evidence, affected obligations, confidence, and a repair path. |
| lesson | ring | A proposed learning that walks proposed, checked, approved, admitted, and later superseded or invalidated. A run never admits one. |
| staff member | — | A named holder of capabilities and skills for the project. |
| host | harness | The agent runtime the person is in (Claude Code, Cursor, VS Code, OpenCode, Codex, Bob). Construct speaks to it over MCP and does the work there. |
| interactive surface | — | The broker tools a person's session uses: bootstrap, classify, context, remember, workflows, skills, start, claim, submit, status, inbox, decide, sources, staff, promote. |
| headless surface | — | The broker tools a configured runner uses: bootstrap, claim step, heartbeat, submit, status. It cannot decide, grant, remember, start, or finalize. |
| classifier | namer | The rule that reads an ordinary-language request as answer, remember, manage, or maintain, and says when to confirm before choosing the bigger one. |
| lockfile | — | `registry.lock.json`: the resolved skill and workflow versions, digests, and origins this project runs against. |
| registry index | — | `registry/index.json`: the shipped catalog of built-in skills and workflows with versions and digests, regenerated and checked in CI. |
