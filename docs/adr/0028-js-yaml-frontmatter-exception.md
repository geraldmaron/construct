---
intake: none
intake_rationale: ratchet decision from the core-dependency-policy test (tests/core-dependency-policy.test.mjs) recording that js-yaml is sanctioned for frontmatter parse/emit only; intake-independent by construction.
last_verified_at: 2026-06-05
verified_by: construct · core-dependency policy test promoted js-yaml from PENDING_ADR to SANCTIONED with this ADR landing
---

# ADR 0028: js-yaml as a sanctioned core dep (frontmatter parse/emit only)

**Date:** 2026-06-05
**Status:** Accepted
**Deciders:** Construct·Engineer
**Extends:** [ADR 0001](0001-zero-npm-core.md) (zero npm core)

---

## Context

ADR-0001 mandates that core (`lib/`, `bin/`) uses Node.js built-ins only, with each exception listed in the SANCTIONED allowlist of `tests/core-dependency-policy.test.mjs`. `js-yaml` has been pending an explicit decision since the policy ratchet landed, tracked alongside `node-webvtt` (now removed because it had zero in-tree usage).

`js-yaml` has three in-tree callsites, all reading or writing markdown frontmatter:

- `lib/validators/skills.mjs:62` — `yaml.load(match[1])` parses each skill's frontmatter so the validator can check required fields (`name`, `description`, etc.). This is a production read path: every `construct sync` and every doctor `Skill structure` check loads it.
- `scripts/migrate-surface-frontmatter.mjs:73,180` — `yaml.load` + `yaml.dump` rewrite the doc-stamp frontmatter on every shipped doc as part of a one-shot migration script.
- `scripts/migrate-skill-frontmatter.mjs:102,275` — same `load`/`dump` pair for the SKILL.md frontmatter migration script.

The `dump` direction is the non-trivial half. Emitting YAML that round-trips through any conformant parser — handling quoting rules (single, double, none, plain-with-special-char escapes), block-scalar indentation, the `noRefs` discipline that prevents accidental anchor cycles, and the strict `forceQuotes: false` discipline that keeps the wire form readable — requires a substantial chunk of code that the YAML spec already specifies. Hand-rolling it would mean owning the conformance burden ADR-0001 was written to avoid for non-protocol concerns. The `load` direction is closer to tractable, but the asymmetry would split the codebase across two YAML implementations (in-tree reader, npm writer) for no real gain.

## Decision

`js-yaml` is sanctioned for **markdown frontmatter parse and emit only**. It is added to the `SANCTIONED` allowlist of `tests/core-dependency-policy.test.mjs`; its row leaves the `PENDING_ADR` map.

Permitted use:

- Parsing markdown frontmatter (`---\n…\n---`) into a plain JS object via `yaml.load`.
- Emitting frontmatter from a plain JS object via `yaml.dump` with the existing options (`lineWidth: 1200, noRefs: true, quotingType: '"', forceQuotes: false`) so the wire form stays diff-friendly.

Out of scope:

- Parsing or emitting arbitrary YAML documents (Kubernetes manifests, OpenAPI specs, ad-hoc config files). Any new YAML use case must justify itself or pick a different format.
- Using `js-yaml`'s tag/schema customization. The default `DEFAULT_SCHEMA` is sufficient for frontmatter; reaching for custom tags signals scope creep.

## Rationale

The frontmatter contract — `name`, `description`, `cx_doc_id`, `body_hash`, `generator`, `intake`, etc. — is durable repo state that ships in every skill, doc, and migration artifact. The dependency's surface area in Construct is bounded to one operation (frontmatter) used by three callers, all of which already exist; the ADR ratifies the steady state rather than authorizing new growth.

A from-scratch in-tree replacement would consume ~300–500 lines of code to handle the quoting and escape rules `js-yaml` already covers, plus tests for every edge case. Carrying that maintenance cost forever to avoid one mature, audited dependency (4.x line, ~1KB compressed in the install footprint) is the wrong trade for a non-protocol concern.

## Rejected alternatives

- **Replace with a hand-rolled frontmatter parser/emitter.** Feasible, but the implementation cost (especially `dump` with proper escape rules and `noRefs` discipline) doesn't earn its keep against the dependency's narrow use. Rejected on cost-vs-value.
- **Restrict to YAML the writer never round-trips back.** Removes the symmetry argument but leaves the `load` callsite still depending on the same library. Rejected because it does not shrink the surface meaningfully.
- **Switch to TOML or JSON5 for new frontmatter.** Breaks every existing skill, doc, and ADR; the migration alone would touch hundreds of files for no functional gain. Rejected.

## Consequences

- The core-dependency-policy test moves `js-yaml` from `PENDING_ADR` to `SANCTIONED`. The ratchet still fails on any new unaccounted dep.
- Future expansion of YAML usage — outside frontmatter — requires a new ADR or a new sanctioned scope. The current allowlist entry is narrow on purpose.
- `node-webvtt` is removed from `package.json` (zero in-tree usage at the time of this ADR) and from `PENDING_ADR`. No replacement is needed.
- Upgrades to the `js-yaml` 4.x line follow the standard release-gate path (release-and-deploy runbook).
