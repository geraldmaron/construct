---
title: MailParser vs. hand-rolled MIME parser — benchmark and decision
description: Correctness and performance comparison of the mailparser npm package against lib/document-extract.mjs's hand-rolled RFC 5322/MIME parser on a 7-fixture email corpus, applying ADR-0097's delegation rubric to name adopt-and-migrate vs retain-custom-with-fixes.
intake: none
---

# MailParser vs. hand-rolled MIME parser — benchmark and decision

**Bead:** `construct-tsyfe.2.6` · **Date:** 2026-07-17 · **Branch:** `worktree-agent-a7af668b0ee248288` (fast-forwarded onto `feat/fable5-bead-program@8d52c560`, which includes ADR-0097)

**Depends on:** `construct-4uxq0.13.6` (ADR-0001 amendment) — **closed**, landed as ADR-0097 (`docs/decisions/adr/0097-capability-delegation-rubric.md`, commit `dcbc2cf5`). The decision below is unconditional, not gated on a still-open amendment.

**No-fabrication note:** every number below comes from `scripts/benchmarks/mailparser-vs-hand-rolled.mjs` run against `tests/fixtures/email-mime/` on this machine (Node v25.9.0, darwin), or from `npm view`/`npm install` output captured in this session. Re-run the harness to reproduce.

## Scope confirmation (execution prompt step 1)

Re-read `lib/document-extract.mjs` in full before benchmarking. The bead's problem statement still matches current code:

- `parseRfc5322Headers` at line 200, `parseContentType` at 227, `splitMultipart` at 247, `decodeTransferEncoded` at 267, `walkMimeForPlainText` at 280, `extractEmlMessage` at 353 — unchanged.
- The "intentionally minimal" comment sits at lines 348-352 (bead cited 350-352; the block starts at 348), stating no RFC 2047 decoding, no nested `message/rfc822` traversal.
- `EMAIL_DOCUMENT_EXTS` (line 76) includes `.msg`; both `.eml` and `.msg` route through the same `extractEml` call (line 552 in the current file, bead cited 551 — one line drifted, same call).
- `extractEmlMessage` (line 358) still does an unconditional `readFileSync(filePath, 'utf8')` regardless of extension. Confirmed live: feeding a synthetic OLE-signature binary through `extractDocumentText(...)` with a `.msg` extension returns `{ extractionMethod: 'eml', skipped: undefined, characters: 516 }` — no error, no skip marker, just 516 characters of replacement-character garbage.

No update to the bead's problem statement needed.

## Corpus

`tests/fixtures/email-mime/` (7 files, self-authored, no downloaded content):

| file | scenario |
|---|---|
| `01-plain-text.eml` | single-part `text/plain`, ASCII headers — baseline |
| `02-html-only.eml` | single-part `text/html`, no plain alternative |
| `03-multipart-alternative.eml` | `multipart/alternative`: plain + html |
| `04-multipart-attachment.eml` | `multipart/mixed`: plain body + base64 CSV attachment |
| `05-encoded-header-subject.eml` | RFC 2047 `=?UTF-8?B?...?=` in Subject and From display name |
| `06-nested-forward.eml` | `multipart/mixed` containing a `message/rfc822` forwarded part |
| `07-synthetic-ole.msg` | 8-byte CFBF magic signature (`D0 CF 11 E0 A1 B1 1A E1`) + non-UTF8 filler bytes, standing in for a real Outlook `.msg` — self-authored, not a downloaded proprietary file |

## Harness

`scripts/benchmarks/mailparser-vs-hand-rolled.mjs` (prototype-only, not wired into CI or shipped). Calls `extractDocumentText()` from `lib/document-extract.mjs` and `simpleParser()` from `mailparser` against every fixture, prints a correctness table, then times 200 repeated passes over the corpus with both parsers. Run:

```
npm install --no-save mailparser   # never persisted to package.json
node scripts/benchmarks/mailparser-vs-hand-rolled.mjs
```

## Correctness results

| scenario | hand-rolled (current) | mailparser | gap closed? |
|---|---|---|---|
| plain text | subject/from/body all correct | subject/from/body all correct | parity |
| multipart/alternative | correctly prefers plain part | correctly prefers plain part | parity |
| multipart + attachment | attachment filename `report.csv` enumerated correctly | attachment filename `report.csv` enumerated correctly | parity |
| HTML-only body | body text empty; reports `droppedInfo: html-part:1` | recovers readable text via built-in html-to-text: `"Hello Bob,\n\nHere is your weekly digest [https://example.com/digest]."` | **yes** — bonus finding, not in the original problem statement |
| RFC 2047 encoded Subject/From | left as raw `=?UTF-8?B?...?=` / `=?UTF-8?B?...?=` — undecoded | decoded correctly: `"École: café project — résumé attached"`, `"Renée Dupont <renee@example.com>"` | **yes** — the documented gap |
| nested `message/rfc822` forward | dropped entirely: `attachments: []`, `droppedInfo: []` — zero signal that content was lost | surfaced as an attachment (`contentType: "message/rfc822"`, raw bytes preserved, 233 bytes); re-parsing that buffer with `simpleParser` recovers the nested subject (`"Original: budget approval"`) and body (`"Approved, go ahead with the Q3 budget.\n"`) | **partially** — mailparser does not auto-flatten nested messages, but exposes the raw sub-message so one recursive `simpleParser` call recovers it; hand-rolled has no equivalent path at any effort level |
| `.msg` (synthetic OLE binary) | silently "succeeds": 516 characters of replacement-character garbage, no error, no skip marker | silently returns empty/null fields (no header/body separator found, no crash) | **no** — mailparser is an RFC 5322/MIME text parser; it does not parse OLE/CFBF containers. `.msg` support needs a dedicated OLE-aware library (e.g. `msgreader`), a decision outside this benchmark's scope |

Both parsers are non-crashing and non-throwing across all 7 fixtures, including the deliberately malformed `.msg` binary — neither fails loud on that input today.

## Performance results

200 iterations over the 7-fixture corpus (1,400 parses per parser), single Node process:

| parser | total ms | ms/parse |
|---|---|---|
| hand-rolled | 24.8 | 0.0177 |
| mailparser | 594.5 | 0.4246 |

mailparser measured at roughly 24x the per-parse cost of the hand-rolled regex/string-split path on this corpus. In absolute terms that is under half a millisecond per message (simpleParser is async and non-blocking), which is not disqualifying for the ingest daemon's per-email throughput; it is the honest lifecycle-cost line item the ADR-0097 rubric asks for, not zero cost.

## ADR-0097 rubric application

Class citation: MIME/RFC message parsing is one of ADR-0097's four pre-evaluated delegation classes — "delegable... the current implementation already documents its own gaps" — so this section validates the specific library choice, not whether the class is delegable.

1. **Install footprint** — low. Isolated clean install (`npm install mailparser` in an empty temp project): 28 total packages, 5.7 MB on disk, zero `.node` native binaries, zero `binding.gyp` files, zero `postinstall` scripts across the tree, `npm audit` reports 0 vulnerabilities.
2. **Maintenance burden transferred** — favorable. Retires roughly 238 LOC of hand-rolled MIME/RFC 5322 parsing (`lib/document-extract.mjs` lines 196-433: header folding, Content-Type/boundary parsing, multipart splitting, transfer-decoding, the MIME walker, and `extractEmlMessage` itself) in exchange for a dependency published under the Nodemailer org (`andris`), last released 2026-07-05 — 12 days before this benchmark.
3. **Security surface** — real, and the reason correctness matters here: this parser runs on external, attacker-influenced input (email bodies/headers from outside the trust boundary), exactly the case ADR-0097 weighs heavily. No crash or hang was observed across 1,400 parses of the 7 fixtures, including the malformed-binary fixture.
4. **Replaceability** — good. Every current caller reaches the hand-rolled parser through a single internal entry point (`extractEml` → `extractDocumentText`/`extractEmlMessage` in `lib/document-extract.mjs`); no caller touches `parseRfc5322Headers`/`splitMultipart`/etc. directly, so a library swap is contained to that one file plus its exported surface.
5. **Evidence bar** — met without waiting for a defect count. The current implementation's own header already documents its gaps in the running code ("intentionally minimal... does not decode RFC 2047... does not chase nested message/rfc822"), and this benchmark adds a directly observed, previously undocumented third gap: silent full-content loss on HTML-only bodies is disclosed via `droppedInfo`, but the nested-forward silent drop carries no `droppedInfo` entry at all — worse than the parser's own html/image handling.

## Decision

**adopt-and-migrate**

Rationale: mailparser fixes both documented gaps within the scope a MIME/RFC-5322 parser can address (RFC 2047 decoding directly; nested `message/rfc822` via one recursive `simpleParser` call the migration bead must add explicitly, since mailparser does not auto-flatten it), adds a correctness win the original problem statement didn't ask for (HTML-only body recovery), carries a light, native-binary-free, actively maintained dependency footprint, and is reachable through the single internal seam `lib/document-extract.mjs` already funnels callers through. The ~24x per-parse slowdown is real but sub-millisecond and does not change the recommendation.

Explicit carve-out: `.msg`/OLE support is **not** delivered by mailparser and is not resolved by this decision. The downstream migration bead (`construct-tsyfe.2.7`) must separately decide between a dedicated OLE-aware library (e.g. `msgreader`) or making the `.msg` path fail loud (reject with a typed error) instead of today's silent mis-parse — either is an improvement over the current silent garbling, but neither is "adopt mailparser" by itself.

This bead adds no runtime dependency. `mailparser` was installed only via `npm install --no-save mailparser` to run this prototype benchmark; `package.json`/`package-lock.json` are unchanged (verified: `git diff --stat package.json package-lock.json` is empty). Adding `mailparser` as an actual `lib/` runtime dependency, wiring it into `document-extract.mjs`, deciding the nested-message recursion depth/limits, and resolving the `.msg` question are in scope for `construct-tsyfe.2.7`, which should cite this document and ADR-0097's rubric directly rather than re-benchmarking.
