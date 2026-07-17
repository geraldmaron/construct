---
intake: none
intake_rationale: ratchet decision from the core-dependency-policy test (tests/core-dependency-policy.test.mjs) recording that mailparser is sanctioned for RFC 5322/MIME email parsing only; intake-independent by construction.
last_verified_at: 2026-07-17
verified_by: construct · core-dependency policy test promoted mailparser to SANCTIONED with this ADR landing
---

# ADR 0098: mailparser as a sanctioned core dep (RFC 5322/MIME email parsing only)

**Date:** 2026-07-17
**Status:** Accepted
**Deciders:** Construct·Engineer
**Extends:** [ADR 0001](0001-zero-npm-core.md) (zero npm core), applies [ADR 0097](0097-capability-delegation-rubric.md)'s MIME/RFC message parsing delegation class

---

## Context

`lib/document-extract.mjs`'s hand-rolled RFC 5322/MIME parser (`parseRfc5322Headers`, `parseContentType`, `splitMultipart`, `decodeTransferEncoded`, `walkMimeForPlainText`, `extractEmlMessage`) is documented in its own source as "intentionally minimal": no RFC 2047 encoded-word header decoding, no nested `message/rfc822` envelope traversal, and `.msg` (OLE/CFBF) input was silently mis-decoded as garbled UTF-8 text rather than rejected.

`construct-tsyfe.2.6` benchmarked `mailparser` against the hand-rolled parser on a 7-fixture corpus (`tests/fixtures/email-mime/`), applying ADR-0097's MIME/RFC message parsing delegation class rubric. Full methodology and results: `docs/notes/research/2026-07-mailparser-benchmark/decision.md`. Summary of the findings that bear on this ADR's three required questions:

1. **What in-tree code does it replace?** `lib/document-extract.mjs` lines 196-433 (roughly 238 LOC): header folding, Content-Type/boundary parsing, multipart splitting, transfer-decoding, the MIME walker, and `extractEmlMessage` itself.
2. **What is the maintenance cost of keeping the in-tree version vs. adopting the library?** The in-tree parser has two open, previously-undocumented-until-this-benchmark correctness gaps beyond what its own doc comment already named: HTML-only bodies are dropped to empty text with only a `droppedInfo` marker (mailparser recovers readable text via a built-in html-to-text fallback), and a nested `message/rfc822` forward is dropped with zero signal at all — not even a `droppedInfo` entry, which is worse than the parser's own image/HTML handling. Fixing both in-tree would mean hand-implementing RFC 2047 decoding, recursive envelope parsing, and an HTML-to-text fallback — exactly the "shallow, well-audited, high-maintenance-cost-to-hand-roll" profile ADR-0097's MIME/RFC class was pre-cleared for.
3. **What is the security surface?** `mailparser` is published under the Nodemailer org (`andris`), last released 2026-07-05 (12 days before the benchmark). An isolated clean install (`npm install mailparser` in an empty temp project) pulled 28 total packages, 5.7 MB on disk, zero `.node` native binaries, zero `binding.gyp` files, zero `postinstall` scripts, and `npm audit` reported 0 vulnerabilities. This parser runs on external, attacker-influenced input (email bodies/headers crossing the trust boundary) — exactly the case ADR-0097 weighs heavily — and no crash or hang was observed across 1,400 parses of the 7-fixture corpus, including a deliberately malformed synthetic `.msg` binary.

Performance: `mailparser` measured at roughly 24x the hand-rolled parser's per-parse cost (0.42ms vs 0.018ms over 1,400 parses), still sub-millisecond and not disqualifying for the ingest daemon's per-email throughput.

Explicit carve-out inherited from the benchmark: `mailparser` does not parse `.msg`/OLE compound-file containers at all — neither this ADR nor `construct-tsyfe.2.7`'s migration adds an OLE-aware dependency. `.msg` input now fails loud with a typed `MSG_OLE_UNSUPPORTED` error instead of being silently mis-decoded; a dedicated OLE reader remains a separate, deferred decision.

## Decision

`mailparser` is sanctioned for **RFC 5322/MIME email parsing only**. It is added to the `SANCTIONED` allowlist of `tests/core-dependency-policy.test.mjs`.

Permitted use:

- Parsing `.eml`/RFC 5322 message bytes via `simpleParser` (`lib/document-extract.mjs`'s `extractEmlMessageAsync`/`extractEmlAsync`), including recursive re-parsing of a nested `message/rfc822` attachment's raw bytes to recover its own envelope.
- Reading the parsed result's headers, body text/HTML, and attachment metadata (filename, content type, size, raw content buffer) for hand-off to `lib/extractors/shared/attachment-policy.mjs`'s size/count/filename/zip-bomb policy.

Out of scope:

- `.msg`/OLE compound-file parsing. `mailparser` does not implement this and none of its OLE-adjacent behavior is relied upon; `.msg` input is rejected with a typed error, not routed through this dependency.
- Any use outside the email-ingestion path (`lib/document-extract.mjs`, and by extension `lib/document-ingest.mjs`'s consumption of its output). A new use case for MIME/RFC 5322 parsing elsewhere in the codebase should cite this ADR's rubric application rather than re-litigating the delegation class, but still needs its own explicit call-site review.

## Rationale

Construct retains ownership of attachment policy, quarantine, provenance, and trust-boundary enforcement around whatever `mailparser` extracts (per `docs/notes/research/2026-07-mailparser-benchmark/decision.md`'s framing, echoed in ADR-0097's rubric) — `lib/extractors/shared/attachment-policy.mjs` is in-tree, dependency-free, and is the actual security control (size/count limits, filename sanitization, zip-bomb ratio heuristic). `mailparser` is scoped narrowly to the parsing step it is good at: RFC 5322/MIME structure, encoded-word header decoding, and multipart/nested-envelope traversal, all shallow and well-specified enough that a maintained, actively-released library is the right lifecycle-cost trade over continuing to hand-roll them, per ADR-0097's MIME/RFC message parsing verdict.

## Rejected alternatives

- **Retain-custom-with-fixes** (hand-implement RFC 2047 decoding, nested-message traversal, and either real `.msg`/OLE support or a fail-loud `.msg` rejection in the existing hand-rolled parser). Rejected by the named benchmark decision: the correctness gaps this would close are exactly the profile ADR-0097's MIME/RFC class was pre-cleared to delegate, and the fail-loud `.msg` improvement is captured either way (this migration adds it regardless of which library owns MIME parsing).
- **A different MIME parsing library.** Not evaluated head-to-head against `mailparser` in this benchmark; `mailparser` met the bar on every dimension the rubric scores (install footprint, maintenance burden transferred, security surface, replaceability, evidence bar) with no disqualifying finding, so a second candidate was not benchmarked. Revisit if `mailparser`'s maintenance status changes materially.

## Consequences

- The core-dependency-policy test (`tests/core-dependency-policy.test.mjs`) adds `mailparser` to `SANCTIONED`. The ratchet still fails on any new unaccounted dependency.
- `lib/document-extract.mjs`'s async email path (`extractEmlMessageAsync`/`extractEmlAsync`, consumed by `extractDocumentTextAsync` and `extractDocumentTextNodeNative`) is backed by `mailparser`. The legacy sync `extractEmlMessage`/`extractEml` hand-rolled parser is retained, unmigrated, for `lib/distill.mjs`'s synchronous file sampler — the one caller that cannot await — and is not removed by this ADR (a separate, gated removal bead follows once a regression corpus exists).
- Future expansion of `mailparser` usage outside the email-ingestion path, or adoption of an OLE-aware `.msg` parser, requires its own ADR or an explicit scope note here — the current allowlist entry is narrow on purpose.
- Upgrades to the `mailparser` 3.x line follow the standard release-gate path (release-and-deploy runbook).
