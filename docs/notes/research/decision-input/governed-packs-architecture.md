---
intake: none
intake_rationale: Architecture decision-input research requested directly by the maintainer.
---

# Research Brief: Governed capability packs and an invariant Construct substrate

- **Date / access date**: 2026-06-24
- **Bead**: construct-u0ik
- **Domain**: ai-tools, security, organizational design
- **Status**: complete
- **Recency baseline**: Current repository state was inspected on 2026-06-24. External sources are current official standards or specifications; oldest source used is NIST AI RMF 1.0 (2023).

## Question

Can Construct support multiple organizational and team structures through installable packs without allowing a pack to weaken its policy, approval, provenance, or certification contracts?

## Method

1. Inspected current repository contracts and implementations: profiles, profile loader and schema, specialist teams, role-policy engine, MCP broker, plugin registry, gate audit, research policy, and existing research-note conventions.
2. Ran `construct profile list`, `construct profile show`, and `construct gates:audit` on 2026-06-24. The gate audit reported one critical gap: `review` is required by `main` branch protection but is not found in the active CI workflow.
3. Searched current primary sources first: NIST AI RMF and its Generative AI Profile, NIST SSDF community-profile guidance, SLSA provenance specification, and Open Policy Agent bundle documentation. URLs below were fetched and checked on 2026-06-24.
4. Compared three options: retain profiles only; make packs general executable plugins; introduce declarative, governed capability packs above an invariant substrate. Marketing- and R&D-specific roles were intentionally not invented: no local user research or operating evidence establishes them.

## Sources

| ID | Title / Path | Class | Reliability | Credibility | Date | Verified | Relevance |
|---|---|---|---|---|---|---|---|
| I1 | `profiles/{rnd,creative,operations,research}.json` | internal | A | 1 | 2026-06-24 | n/a | Four curated organization profiles define roles, departments, intake, templates, and session hooks. |
| I2 | `lib/profiles/loader.mjs`; `docs/guides/concepts/profile-inheritance.md` | internal | A | 1 | 2026-06-24 | n/a | Active resolution selects one raw profile; the guide describes inheritance that the inspected loader does not implement. |
| I3 | `specialists/teams.json`; `lib/plugin-registry.mjs`; `lib/policy/engine.mjs`; `lib/mcp/broker.mjs`; `lib/gates-audit.mjs` | internal | A | 1 | 2026-06-24 | n/a | Current reusable team templates, integration plugin shape, policy enforcement, and gate-audit behavior. |
| E1 | [NIST Secure Software Development Framework project](https://csrc.nist.gov/projects/ssdf) | primary | A | 1 | 2026-06-24 | yes | Defines SSDF community profiles as use-case enhancements used with, not instead of, the base framework; records provenance as an SSDF practice. |
| E2 | [NIST AI RMF 1.0](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf) | primary | A | 1 | 2023-01-26 | yes | Defines GOVERN, MAP, MEASURE, and MANAGE, with governance cross-cutting the lifecycle. |
| E3 | [NIST AI RMF Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | primary | A | 1 | 2024-07 | yes | Defines a profile as an implementation tailored to setting, requirements, risk tolerance, and resources; names governance, content provenance, pre-deployment testing, and incident disclosure as focal considerations. |
| E4 | [SLSA Build Provenance](https://slsa.dev/spec/draft/build-provenance) | primary | A | 1 | accessed 2026-06-24 | yes | Specifies recording top-level inputs, resolved dependencies, builder identity, and byproducts useful for debugging and incident response. |
| E5 | [Open Policy Agent bundles](https://www.openpolicyagent.org/docs/management-bundles) | primary | A | 1 | accessed 2026-06-24 | yes | Demonstrates namespaced policy/data bundles, validation, and optional signed activation with exact-file hash checks. |

## Findings

### Finding 1: Construct already separates some organizational shape from governance, but the boundary is incomplete

**Observation**: The four curated profiles express different role counts, departments, intake taxonomies, document templates, and session hooks. `rnd` is the default R&D profile with 28 roles across six departments; the three other profiles have 7–8 roles. The active loader resolves exactly one configured or custom profile and returns it as read. [`I1`, `I2`]

**Observation**: Construct has a separate policy path: role manifests drive deny/approval decisions, and in team or enterprise mode the MCP broker blocks denied calls, stops approval-required calls before execution, rate-limits calls, and records a trace event. [`I3`]

**Inference**: The desired separation is directionally aligned with the codebase: organization-specific configuration does not need to own the execution controls. It is not yet a dependable substrate boundary because the configuration, teams, plugins, policies, and gates use separate contracts with no single composition or provenance model.

**Confidence**: high; these are direct repository observations.

### Finding 2: Existing profiles and team templates are not a pack system

**Observation**: `specialists/teams.json` holds focused templates with members, skills, and prose promotion gates. `lib/plugin-registry.mjs` validates external manifests that provide MCP integrations; every plugin is required to declare an `mcps` array. Neither shape declares pack compatibility, dependency resolution, gate implementation, signer identity, effective policy, certification evidence, uninstall behavior, or conflicts. [`I3`]

**Observation**: The profile schema permits role, department, intake, template, hook, and default-skill data, but it does not define a pack list, core-version range, gate requirements, or dependency lock. The profile-inheritance guide says one-level inheritance is merged; the inspected active loader contains no inheritance-resolution path and returns the selected JSON object directly. [`I2`]

**Inference**: Renaming either existing profiles or team templates to “packs” would create a false assurance. The missing contract is not cosmetic; it is the mechanism that would prevent a domain extension from silently changing execution posture or becoming non-reproducible.

**Confidence**: high; direct shape and implementation comparison.

### Finding 3: The defensible model is an invariant base plus supplemental profiles, not mutually exclusive organizational products

**Observation**: NIST describes SSDF Community Profiles as enhanced baselines for a particular use case that supplement the SSDF and are intended to be used in conjunction with it. NIST’s AI RMF defines governance as cross-cutting and uses profiles to tailor implementation to a setting, requirements, risk tolerance, and resources. [`E1`, `E2`, `E3`]

**Inference**: Construct should preserve an invariant control plane and let packs add domain-specific workflows and evidence requirements. An R&D, marketing, operations, or research pack must not be a replacement “edition” that chooses its own safety baseline. The pack should state what it adds to the base contract and why, not restate or weaken the base.

**Confidence**: high; the cited standards are directly analogous to a base-plus-profile design. This is an architectural inference, not a claim that NIST specifies Construct packs.

### Finding 4: A pack must have verifiable identity, complete dependency provenance, and fail-closed activation

**Observation**: SLSA provenance records top-level inputs, resolved dependencies, builder identity, and useful byproducts; it recommends placing configuration in verified input artifacts where possible. OPA bundles namespace policy/data, validate contents, and can require signatures whose payload file set and hashes must match before activation; failed verification retains the currently active bundle. [`E4`, `E5`]

**Inference**: A Construct pack should be identified by immutable `{id, version, digest}`, signed by an approved publisher key, and resolved into a lockfile that records its source, digest, dependency graph, core compatibility range, and activation decision. It should fail closed on an unknown signer, digest mismatch, unsatisfied dependency, conflict, unsupported core API, missing mandatory certification evidence, or attempted control-plane override.

**Confidence**: high for the source observations; medium for exact Construct fields because no Construct pack specification exists.

### Finding 5: Existing gate health is not yet a sufficient foundation for delegated extensibility

**Observation**: `construct gates:audit` on 2026-06-24 reported `review` as required by `main` branch protection but absent from the discovered CI jobs, producing one critical gap. [`I3`; command output recorded in this session]

**Inference**: Pack work must not start by adding loaders or a marketplace. First, the project needs a clean and regression-tested gate audit, otherwise a new “pack certification passed” claim would sit above an already known enforcement discrepancy.

**Confidence**: high for the observed audit result; it is time-sensitive and must be rerun before any design approval.

## Architecture options

| Option | What it means | Gate posture | Decision |
|---|---|---|---|
| A. Profiles only | Add curated/custom profiles and team templates for each organization type. | Existing controls remain global, but no composition, pack provenance, or lifecycle contract exists. | Reject as the long-term model; retain as compatibility input. |
| B. Executable plugin packs | Allow packs to ship arbitrary runtime code, prompts, tools, roles, and gates. | Highest blast radius; the current plugin registry is integration-focused and cannot establish trust, isolation, or revocation for this. | Reject for initial scope. |
| C. Governed declarative capability packs | Keep an invariant substrate; packs contribute schema-validated, signed declarative overlays compiled into one effective policy and verification plan. | Controls are evaluated by the substrate, not delegated to pack code. Provenance and conflict checks can fail closed. | Recommended for a staged design investigation. |

## Recommended target shape: governed declarative capability packs

### 1. The invariant substrate

The substrate must remain owned by Construct core and must not be removable, shadowable, or weakened by a pack:

- policy evaluation and the default-deny rule;
- human approval capture and enforcement;
- immutable audit and execution-provenance records;
- capability registry, schema validation, dependency resolution, and conflict detection;
- gate compiler, certification runner, and release decision;
- trusted publisher-key policy, signing verification, revocation, and rollback;
- global safety, secret, documentation, test, and supply-chain gates;
- the pack lifecycle state machine: inspect, resolve, activate, suspend, revoke, remove.

For permissions, the effective decision should be an intersection: a core denial always wins; a pack can add a required approval or a stricter constraint, but it cannot grant an action denied by core. A new permission requires a core-owned capability declaration and explicit human approval policy.

### 2. What a pack may declare in the first version

A first version should be data-only. It may declare:

- a bounded domain/workflow vocabulary and intake classifications;
- reusable role overlays that name existing core role capabilities, decision rights, required handoffs, escalation conditions, and artifacts;
- workflow stages and artifact contracts;
- additive policy constraints, approval requirements, and rate/cost budgets;
- deterministic gates and the fixtures that prove normal and adversarial behavior;
- documentation templates, evidence requirements, and pack-specific retention rules;
- compatibility range and explicit dependencies on other packs.

It must not ship arbitrary executable code, directly register a tool, provide credentials, override a core gate, relax an approval, replace a core role fence, or mutate another pack’s namespace. Those are future proposals that need their own threat model and an execution-isolation design.

### 3. Minimum manifest and activation evidence

The design investigation should test a manifest with, at minimum:

```text
identity:        id, version, publisher, digest, signature
compatibility:   construct API range, schema version, runtime requirements
composition:     dependencies, conflicts, ordering rules, namespace roots
declarations:    workflows, role overlays, artifacts, policy additions, gates
governance:      accountable owner, decision rights, escalation, review cadence
evidence:        certification scenarios, expected controls, provenance inputs
lifecycle:       support window, deprecation/revocation policy, migration path
```

At activation, core must produce an immutable effective-configuration record that includes the complete resolved pack graph, signatures/digests, applicable core and pack gates, approved exceptions, runner identity, and verdict. The record must distinguish planned work from executed work, matching the repository’s existing workflow-provenance rule. [`I3`, `E4`]

### 4. Execution levels

These levels are a proposed Construct control model, not an observed standard:

| Level | Permitted activity | Required evidence | Promotion rule |
|---|---|---|---|
| 0 — Inspect | Read manifest and evidence only. | Signature/digest and schema validation. | No activation. |
| 1 — Plan | Compile an effective configuration with no external writes. | Conflict, policy, and provenance checks. | Human accepts the plan. |
| 2 — Sandbox | Run fixtures against isolated local state and synthetic inputs. | Normal and adversarial certification pass. | Pack is eligible for supervised use. |
| 3 — Supervised | Perform real work through the broker; protected actions require approval. | Per-action trace, approval, and output-gate evidence. | Measured outcomes meet pack thresholds. |
| 4 — Delegated | Allow narrowly scoped autonomous execution. | Stable Level-3 evidence, explicit owner, rollback/revocation test, and recurring evaluation. | Core governance approves the delegation. |

No organization pack starts above Level 2. A pack that lacks evidence stays inspectable but inactive.

### 5. Human-equivalent organization contract

A pack should model work design, not simulate an entire department. For each declared role or workflow it needs an accountable owner, decision rights, forbidden decisions, handoff targets, escalation trigger, artifact/evidence expected, and approval threshold. This keeps “marketing pack” or “R&D pack” from becoming a vague list of personas. Actual role rosters should follow the existing profile lifecycle’s required discovery and validation evidence rather than being guessed. [`I1`]

## Counter-evidence and risks

1. **Packs may be needless abstraction.** The existing profile lifecycle can support multiple curated and custom organizations. If discovery shows that one organization profile at a time is sufficient and composition, provenance, and independent lifecycle management are unnecessary, improving profiles is cheaper and safer. This flips the recommendation away from packs.
2. **The documented profile inheritance contract is not present in the inspected active loader.** This means composition must be proven by tests before it is used as a foundation; documentation alone is not sufficient. [`I2`]
3. **Policy signing alone is not execution isolation.** OPA demonstrates signed policy activation, not safe execution of arbitrary third-party code. This is why executable packs are excluded from the first version. [`E5`]
4. **Gate audit is currently critical.** The observed `review` context mismatch must be repaired or explicitly explained before a pack certification claim is credible. [`I3`]
5. **Organizational labels are not requirements.** “R&D,” “marketing,” and other pack names do not establish their workflows, authority boundaries, or evidence needs. Each candidate requires the profile-lifecycle discovery and validation evidence already prescribed by this repository. [`I1`]

## Confidence summary

**Overall: medium-high.** The repository evidence is direct and the external sources support the central design principles: preserve a base control framework, tailor through supplemental profiles, prove provenance, and fail closed on invalid policy artifacts. The uncertain part is product demand and the exact pack taxonomy; no local evidence demonstrates which pack capabilities are required or whether composition will be used often enough to justify the platform cost.

## Gaps

- No evidence of user demand, adoption frequency, or organization-specific workflows for an R&D, marketing, or other pack.
- No selected distribution channel, publisher trust model, credential model, or revocation service.
- No measured performance/cost impact of compiling multiple overlays or running per-pack certification.
- No threat model for executable third-party extensions; the recommendation explicitly excludes them.
- The `review` branch-protection/CI mismatch needs a fresh audit and a root-cause investigation.

## Recommendation

**Proceed only with a decision-quality prototype of Option C; do not build a general plugin marketplace or create named organization packs yet.** The next work should prove the contract on one deliberately small, internal-only capability pack, not select an R&D or marketing pack.

Before implementation, all of the following must be true:

1. `construct gates:audit` has no critical gaps, including the current `review` mismatch.
2. A short user-research brief establishes one real workflow to model, its accountable owner, decision rights, handoffs, risk level, and success evidence.
3. A written pack schema and resolver prove: signature/digest verification, version compatibility, namespace conflict failure, dependency lock, core-deny precedence, and non-bypassability of core gates.
4. The prototype remains declarative and uses synthetic fixtures to prove normal and adversarial behavior at Levels 0–2.
5. An ADR compares retaining profiles, governed packs, and executable plugins against those measured results.

**Flip conditions**: reject or defer packs if discovery shows single-profile selection is sufficient, if a clean core-gate baseline cannot be maintained, or if the requested extension requires arbitrary code before a credible isolation/identity design exists.

## Open questions

1. Which observed workflow, if any, has enough repeated demand to become the first pilot?
2. Should packs be project-local only initially, or may they be shared across repositories? The latter changes signing, update, and revocation requirements.
3. Which core actions are permanently non-delegable, regardless of pack certification?
4. What evidence threshold, observation window, and rollback test are required to move a pack from supervised to delegated execution?
5. Is a multi-pack project allowed to select more than one organization profile, or should profiles remain a single compatibility layer while packs compose beneath them?

## References

1. National Institute of Standards and Technology. (2026, accessed June 24). *Secure Software Development Framework project*. https://csrc.nist.gov/projects/ssdf
2. Tabassi, E. (2023). *Artificial Intelligence Risk Management Framework (AI RMF 1.0), NIST AI 100-1*. https://doi.org/10.6028/NIST.AI.100-1
3. National Institute of Standards and Technology. (2024). *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile, NIST AI 600-1*. https://doi.org/10.6028/NIST.AI.600-1
4. SLSA. (2026, accessed June 24). *Build: Provenance*. https://slsa.dev/spec/draft/build-provenance
5. Open Policy Agent. (2026, accessed June 24). *Bundles*. https://www.openpolicyagent.org/docs/management-bundles
