# ADR-0097: Governed capability-delegation rubric — amends ADR-0001's exception path

- **Date**: 2026-07-17
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Amends**: ADR-0001 (`docs/decisions/adr/0001-zero-npm-core.md`) — replaces its single "write a new ADR" exception path with a named rubric and delegation classes; does not repeal ADR-0001's core-zone restriction or its zero-supply-chain-risk goal.
- **Resolves**: `construct-4uxq0.13.6` — the missing decision procedure blocking every Fable 5 program bead that proposes adopting a runtime npm library in `lib/`/`bin/`.

## Problem

ADR-0001 restricts `lib/` and `bin/` to Node built-ins plus three declared exceptions, with a single exception path: write a new ADR answering three questions (what does it replace, what's the maintenance-cost tradeoff, what's the security surface — `docs/guides/reference/dependencies.md`). That path works for a single, isolated adoption decision, but it has no shared vocabulary for comparing "hand-roll it" against "delegate it," no lifecycle-cost model beyond the three questions, and no named classes of commodity mechanics — so each candidate re-litigates the zero-dep philosophy from scratch rather than applying a consistent standard.

The Fable 5 program's founding premise (`construct-tsyfe` epic) is that Construct should delegate mature commodity mechanics when delegation lowers total lifecycle cost, while continuing to own differentiated product semantics outright. Four concrete hand-rolled implementations already exist that a rubric-driven review might reclassify:

- Markdown/HTML block parsing (`lib/rich-document.mjs:218-511,776-851`)
- MIME/RFC 5322 message parsing (`lib/document-extract.mjs:200-433`, explicitly "intentionally minimal": no RFC 2047, no nested `message/rfc822`)
- Hand-rolled JSON-Schema-subset validation, duplicated across five modules (`lib/config/schema.mjs`, `lib/flows/schema.mjs`, `lib/providers/instance-config.mjs`, `lib/registry/custom-schema.mjs`, `lib/specialists/schema.mjs`)
- Graph visualization rendering (no library today; `lib/graph/store.mjs` has no interactive rendering layer)

Without a shared rubric, eleven downstream beads across the program (schema-validation adoption, MIME-parser benchmarking, RichDocument-parser prototyping, Cytoscape/Excalidraw evaluation, Ladle evaluation, dependency-budget policy, promptfoo adoption, and zod's own disposition) either stall re-litigating the same question, or drift into ungoverned ad hoc decisions — the exact failure mode the audit already found once: `deps/intent.json`'s `zod` entry claimed an active validation purpose it never fulfilled (declared, never imported; corrected by `construct-4uxq0.9.17`).

## Decision

ADR-0001's core-zone restriction and zero-supply-chain-risk goal for the **installed runtime spine** stand unchanged. What changes is the exception path: instead of a bare "write a new ADR," a delegation candidate is evaluated against the rubric below, and the result is recorded in that candidate's own ADR (which still must exist — this does not remove the ADR requirement, it gives the ADR author a structured basis instead of a blank page).

### 1. Lifecycle-cost rubric

Every delegation candidate answers five dimensions, each with a stated verdict, not just a paragraph of prose:

1. **Install footprint** — added transitive dependency count, any native binary, any postinstall/build step. A dependency with zero native binaries and a shallow transitive tree scores better than one that pulls in a build toolchain.
2. **Maintenance burden transferred** — LOC removed from `lib/` versus the defect/CVE exposure taken on. Cite the actual LOC being retired (per `docs/guides/reference/in-tree-implementations.md`'s existing per-component tracking) and the library's own defect/release cadence.
3. **Security surface** — does the library parse untrusted input? Does it run inside a trust boundary (a doc/diagram imported from outside the repo, a value from an external API)? A library parsing only repo-authored, semi-trusted content scores better than one parsing arbitrary external input.
4. **Replaceability** — is the library called through an internal interface/adapter Construct already owns (or will own), so swapping it later is a contained change, not a rewrite? Direct, unabstracted calls scattered across many files score worse.
5. **Evidence bar** — does `docs/guides/reference/in-tree-implementations.md`'s existing promotion trigger (3+ defects in 6 months on the in-tree component) already fire for this candidate, or is the adoption speculative/pre-emptive? A live, cited defect history scores higher confidence than a hypothetical future problem.

A candidate ADR states a verdict for each dimension — "low" / "medium" / "high" cost or risk, with the evidence behind it — not merely "we considered this."

### 2. Named delegation classes

The rubric is pre-applied, at the class level, to the four commodity mechanics this program already knows it will touch. A candidate ADR in one of these classes cites the class's standing verdict below and only needs to justify the *specific library choice* within it, not re-argue whether the class itself is delegable:

- **Markdown/HTML parsing** — delegable. Untrusted-input exposure is real (parsing content from imported docs), maintenance burden of a correct CommonMark/GFM-compatible parser is high, and mature libraries (`unified`/`remark`/`rehype`, `mdast`/`hast`) are widely used with shallow, well-audited trees. Construct retains ownership of citations, source references, dropped-information reporting, and diagram-block extraction as product-specific layers on top.
- **MIME/RFC message parsing** — delegable. RFC 5322/2047 compliance (encoded words, nested `message/rfc822`, character-set edge cases) is exactly the kind of correctness surface a small in-house implementation predictably under-serves over time, and the current implementation already documents its own gaps. Construct retains ownership of attachment policy, quarantine, provenance, and trust-boundary enforcement around whatever the parser extracts.
- **Schema validation** — delegable, with a caveat: five separate hand-rolled validators is itself the defect (duplicated logic, five places to fix a validation bug), independent of whether any one of them individually "works." A single validation library used consistently is lower lifecycle cost than five divergent implementations even before considering the library's own maintenance burden.
- **Graph/diagram visualization rendering** — delegable for the *rendering* layer only. Construct's graph *model* (`lib/graph/store.mjs`'s schema, node/edge semantics, provenance) is differentiated product semantics and is never delegated; only the pixels-on-screen rendering of that model to a human is commodity mechanics a library can own.

A class listed here is a strong prior, not an unconditional pass — a candidate ADR can still find that a specific library in one of these classes fails the rubric (native binary, thin maintenance, poor security posture) and recommend against it or against adoption *right now*.

### 3. What never delegates, regardless of rubric score

Differentiated product semantics stay Construct-owned even if a library exists and would score well: the graph model and its edge/node semantics, the certification-tier ladder, Oracle's invariant registry and verdict vocabulary, contract definitions and their postconditions, and policy/authorization/approval logic. These encode Construct's own product judgment, not commodity mechanics a generic library could express — delegating them would mean outsourcing the decision the product exists to make.

### 4. The gate this ADR creates

Every bead in the Fable 5 program proposing a new runtime npm dependency in `lib/`/`bin/` depends on this ADR (referenced in bead text as `slug:adr-0001-amendment`) and must apply the rubric explicitly in its own Decision section — citing which of the five dimensions and, where applicable, which named class — rather than merely citing this ADR's existence as blanket permission.

## Rejected alternatives

- **Leave ADR-0001 as-is; each bead writes its own from-scratch ADR.** Rejected — reproduces the no-rubric problem this ADR exists to fix, on every single bead.
- **Repeal ADR-0001 outright.** Rejected — the zero-supply-chain-risk goal for the installed CLI spine remains valid (enterprise/air-gapped installs are still a real constraint per ADR-0001's own Context), only the decision procedure was missing, not the underlying goal.
- **Build a mechanically-enforced scoring tool before allowing any delegation decision.** Rejected as a precondition — worth having eventually (tracked separately as a dependency-budget bead), but blocking eleven already-queued beads on tooling that doesn't exist yet would recreate the same stall this ADR is meant to resolve. The rubric is usable by a human/agent author today; automation can check conformance later.

## Consequences

- Positive: the eleven beads currently blocked on `slug:adr-0001-amendment` can proceed, each citing this rubric instead of re-deriving one.
- Positive: the four named delegation classes give a consistent, evidence-anchored starting point instead of five independent re-litigations of the same markdown/MIME/schema/graph questions.
- Negative: a rubric is not a formula — "low/medium/high" verdicts still require judgment, and a future author could game the rubric by asserting favorable verdicts without real evidence. Mitigated by requiring cited evidence (LOC counts, defect history, transitive-dependency counts) per dimension, not just a label.
- Follow-on: individual delegation decisions (zod's adopt-or-remove disposition, the RichDocument parser prototype, the schema-validation library selection, Cytoscape/Excalidraw evaluation) are separate downstream beads that consume this rubric — this ADR does not itself adopt or remove any dependency.

## Amendment to ADR-0001

`docs/decisions/adr/0001-zero-npm-core.md`'s "Exception path" section is superseded by this ADR's rubric and delegation classes; see that file's own "amended" cross-reference.
