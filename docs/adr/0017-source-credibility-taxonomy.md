<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0017: Source credibility taxonomy — claim-relative class, community signal, and Admiralty grading

- **Date**: 2026-06-03
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none

<!-- Owning specialist: cx-researcher. Part of the template & prompt research-grade remediation (epic construct-7zrh). -->

## Problem

Construct's research policy classifies every source as internal, primary, secondary, or tertiary, and treats forums and community posts as tertiary — "for discovery only, never as evidence." That rule is correct for factual claims and wrong for a whole class of research the system actually does. When the question is "do developers experience friction with X" or "is there demand for Y," the community thread *is* the evidence; routing it to tertiary forces the researcher to either discard the only available signal or quietly cite it against policy. The policy also collapses all of a source's trustworthiness into a single class label, so a researcher cannot record that a usually-reliable source carried an uncorroborated claim. Both gaps push toward the failure the no-fabrication rule exists to prevent: confident claims resting on unstated-quality evidence.

## Context

`rules/common/research.md` is otherwise strong — recency discipline, domain starting points, URL verification, a two-source rule, and `high/medium/low` confidence labels. The fix must extend it, not replace it. Two established ideas apply directly: a source's class depends on how it is used (a first-hand account is a primary source for the attitude it expresses), and source trustworthiness has two independent axes — the source's track record and the specific claim's corroboration — as formalized by the NATO Admiralty Code. This ADR sits in the research-grade remediation program (epic construct-7zrh) and is the basis the research templates and the cx-researcher prompt build on.

## Decision

Source class is **relative to the claim**: community and forum content (Reddit, Stack Overflow, Hacker News, Discord, GitHub Discussions) is admissible **primary** evidence for sentiment, demand, friction, and adoption-experience claims under an explicit admissibility checklist, and remains tertiary for factual, version, security, pricing, and compatibility claims. Every source additionally carries an **Admiralty grade** — reliability `A`–`F` × information credibility `1`–`6`, recorded together (e.g. `B2`) — which maps onto the existing confidence labels. A per-domain community starting-points catalog (`rules/common/research-sources.md`) names where to look for community signal.

## Rationale

Classifying by claim matches how primary sources are actually defined — context determines whether a text is primary or secondary ([primary-source definition](https://en.wikipedia.org/wiki/Primary_source)) — and lets the system use community signal honestly instead of discarding or smuggling it. The two-axis Admiralty grade ([NATO Admiralty Code](https://en.wikipedia.org/wiki/Admiralty_code)) captures what a single class label cannot: that a reliable source can carry an uncorroborated claim and an unreliable one can carry a confirmed fact. Mapping the grade onto `high/medium/low` keeps the existing confidence vocabulary while making the basis for it explicit and checkable. The admissibility checklist (corroboration, recency, engagement, claim-is-about-experience) is what separates signal from a single anonymous post.

## Rejected alternatives

- **Keep forums strictly tertiary.** Rejected: it makes sentiment and demand research impossible to source honestly, and the community thread is the genuine primary record of an expressed attitude. The risk it guards against — citing a forum for a fact — is handled instead by claim-relative classing, which keeps community content tertiary for factual claims.
- **A single richer class label (e.g. add a "community" class).** Rejected: trustworthiness is two-dimensional. A flat label still cannot distinguish a usually-reliable source's shaky claim from a confirmed one, which is exactly the conflation that lets confidence inflate.
- **Adopt the Admiralty grade only, drop class.** Rejected: class answers "primary vs derived for this claim," which the grade does not; the two are complementary and both are cheap to record.

## Consequences

Researchers now record two extra fields per source (the `A`–`F` and `1`–`6` grades) and must state which claim a community source supports. The research templates' sources tables gain `Reliability` and `Credibility` columns, and the cx-researcher prompt teaches the claim-relative rule. Confidence claims become auditable — `high` is reserved for `A1`/`A2`/`B1` — so an inflated confidence is now visible rather than buried. The community catalog must be kept current, which the research policy's verification rule already requires for any load-bearing citation.

## Reversibility

Two-way door. The taxonomy is additive policy plus two template columns; reverting restores the prior 4-tier model with no data loss. Revisit if the grade proves too heavy in practice (it can be collapsed to class-plus-confidence) or if a future evaluation shows community signal is never load-bearing for Construct's domains.

## References

- NATO Admiralty Code — https://en.wikipedia.org/wiki/Admiralty_code
- Primary source (context determines class) — https://en.wikipedia.org/wiki/Primary_source
- `rules/common/research.md` (§2 claim-relative classing, §4 metadata, §10 community + grading), `rules/common/research-sources.md`
- ADR-0015 (hybrid architecture; enforce-don't-assert), epic construct-7zrh
