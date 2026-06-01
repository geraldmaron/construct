<!--
rules/common/no-fabrication.md: canonical anti-fabrication policy for Construct.

Defines the trust contract between operators and the system: outputs stick to
source, gaps stay visible, and confidence reflects evidence. Applies to every
specialist, every artifact, and every summary — intake processing, document
evaluation, knowledge writing, plan drafting, review verdicts, handoffs.

Sibling rules: research.md (evidence hierarchy), framing.md (execution
artifacts are not sources), comments.md (banned voice patterns).
-->
# No-Fabrication Policy

Fabrication is the single largest threat to trust in an agent system. A persona that invents a customer quote, sharpens a vague signal into a confident assertion, or papers over a gap with plausible-sounding prose corrupts every artifact downstream. This rule applies to **every output** Construct produces: intake summaries, classification rationales, PRDs, ADRs, RFCs, knowledge notes, handoffs, review verdicts, plan entries, beads issues, MCP tool responses, dashboard text.

## 1. Stick to source

- Every load-bearing claim must trace to a source the reader can re-verify. Cite with `[source: path#anchor]`, `[source: intake-<id>]`, `[source: bd-<id>]`, `[source: <commit-sha>]`, or a fetched URL with the date the fetch happened.
- If a fact is not in the source you have access to, write `unknown` or `[unverified]`. Do not paper over the gap with prose that sounds confident.
- Never invent: customer names, quotes, ticket IDs, commit hashes, percentages, dates, file paths, function names, API surfaces, dependency names, version numbers.

## 2. Preserve ambiguity

- A vague signal stays vague in the artifact. If the intake says "users are frustrated with the dashboard," the PRD says "users are frustrated with the dashboard [source: intake-xxx]" — not "users want sub-200ms p95 dashboard latency."
- When a source is ambiguous, list the possible interpretations and tag the chosen reading as inference, not observation.
- Do not promote inference to observation. `X happened` requires evidence the event happened. `X likely means Y` requires the inference to be marked as such.

## 3. Distinguish observation from inference

- Observation: directly verifiable from the source. Format: bare statement with citation.
- Inference: a conclusion drawn from one or more observations. Format: prefixed with `inference:` or `[inferred]`, and the supporting observations must be cited.
- Speculation (no supporting observation): not allowed in artifacts. If you must raise a hypothesis, write it as a question, not an assertion.

## 4. Calibrate confidence honestly

- Confidence in artifacts and observation records reflects evidence strength, not authorial conviction. Single-source claims, secondary sources, and inferred conclusions get lower confidence than primary-source observations.
- Words that smuggle confidence without evidence — `clearly`, `obviously`, `undoubtedly`, `definitely`, `certainly`, `surely` — are banned from artifact bodies. Replace with an explicit citation or remove.
- Quantitative claims (`30% faster`, `5x improvement`, `90th percentile latency`) require an inline source. Hand-wave percentages are fabrication.

## 5. Don't mind-read users or customers

- `Users want X`, `customers expect Y`, `everyone agrees Z` require a citation to the source where the user or customer said so (interview transcript, support ticket, survey, observed behavior). Without the citation, the claim is fabrication.
- Speculative product-vision language is allowed only in clearly-marked hypothesis or alternative sections, never in observation or requirements sections.

## 6. Surface uncertainty as a question, not an assertion

- When you don't know, ask. A persona that doesn't know whether a regression touched the auth flow asks for the diff before claiming it did. A reviewer who can't tell if a test covers a branch asks for the coverage report.
- "I don't have access to X" is a valid output. Pretending to have access is fabrication.

## 7. Embellishment is fabrication

- Adding plausible-but-unverified detail to a summary, classification rationale, or handoff is fabrication, even when the additions feel innocuous.
- The intake classifier's `rationale` field lists the exact keywords matched. Downstream personas must not embellish the rationale into a richer narrative the classifier did not produce.
- Session summaries derive from observable session artifacts (context, observations, commits). Do not include events the transcript does not record.

## 8. When in doubt, say less

- A shorter, accurate artifact beats a longer artifact padded with unverified plausibility.
- Sections that lack source material should be omitted, not filled with speculation. An ADR without a "Rejected alternatives" section because no alternatives were considered is better than an ADR with invented alternatives.

## Enforcement

- `lib/comment-lint.mjs` enforces a subset of these patterns on artifact paths (`docs/prd/**`, `docs/adr/**`, `docs/rfc/**`, `docs/research/**`, `.cx/knowledge/**`, `.cx/handoffs/**`, `.cx/research/**`). PostToolUse warns; `npm run lint:comments`, `construct lint:comments`, and the release gate block.
- `specialists/contracts.json` postconditions check structural requirements (mandatory sections, intake traceability, citation density). `lib/contracts/validate.mjs#validateHandoff` blocks handoffs that fail validation; binary postconditions in `lib/specialists/postconditions.mjs` block rubber-stamp reviews, post-hoc threat models, symptom-only fixes, stale-doc PRs, and post-hoc accessibility. Enforcement is hard-default `block`.
- `construct intake done <id> --output=<path>` stamps `intake_id`, `intake_confidence`, and `intake_rationale` into the artifact's frontmatter so every intake-derived artifact carries verifiable provenance.

## Bypass

There is no bypass. If a check is wrong, fix the check (`rules/common/no-fabrication.md`, the pattern bank in `lib/comment-lint.mjs`, or the contract postcondition). Do not work around the gate.
