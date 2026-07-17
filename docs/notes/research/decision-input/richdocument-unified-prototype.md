---
intake: none
intake_rationale: Prototype/benchmark decision-input for construct-tsyfe.3.2; evidence is this repo's own code plus a disposable local prototype run against a corpus pulled from this repo's own docs, not external sources.
---

# Research Brief: unified/remark/rehype vs. hand-rolled RichDocument parsers — adopt or retain

- **Date**: 2026-07-17
- **Bead**: construct-tsyfe.3.2
- **Status**: complete
- **Applies**: ADR-0097 (`docs/decisions/adr/0097-capability-delegation-rubric.md`), which pre-classifies "Markdown/HTML parsing" as a delegable class. This brief does not re-derive that class verdict; it answers the two questions the class verdict leaves open — does the specific library choice (`unified`/`remark`/`rehype`) hold up under measurement, and does the current hand-rolled implementation's actual behavior support delegating now.
- **No-fabrication note**: every number below is either read directly from a cited file:line in this repo or produced by the prototype harness committed alongside this brief (`scripts/prototypes/richdocument-unified/`), re-runnable via `node scripts/prototypes/richdocument-unified/run-fidelity.mjs` and `run-loadtest.mjs` after `npm install -D rehype-parse rehype-stringify rehype-sanitize hast-util-to-html` (these four are not committed as dependencies — see Non-goals below).

## Question

Should `lib/rich-document.mjs`'s hand-rolled Markdown block parser + inline tokenizer (`:218-511`) and HTML tag-tree parser (`:776-851`), plus `lib/rich-document-export.mjs`'s hand-rolled `richDocumentToMarkdown` serializer (`:91-165`), be replaced by a pipeline built on `unified`/`remark`/`rehype` (plus `rehype-sanitize`), or retained and fixed in place?

## Method

1. Re-read `lib/rich-document.mjs` in full (854 lines) and `lib/rich-document-export.mjs` in full (300 lines) to confirm the hand-rolled parsers' actual current behavior, not an assumption about them.
2. Confirmed via `grep` that `unified`/`remark`/`rehype`/`mdast`/`hast` core packages are not a `dependencies` or `devDependencies` entry of the root `package.json` — `remark-gfm` is a devDependency of the `apps/docs` workspace only (a Next.js docs-site build), unrelated to the `lib/`/`bin/` runtime this bead concerns.
3. Built a disposable prototype (`scripts/prototypes/richdocument-unified/unified-adapter.mjs`) that maps `mdast`/`hast` trees onto the *same* RichDocument IR `lib/rich-document.mjs` defines, reusing its `make*` factories directly so both pipelines produce directly comparable output for the same input.
4. Pulled a 5-file, 778-line corpus directly from this repo's own `docs/decisions/adr/` and `README.md` into `tests/fixtures/rich-document-corpus/` (real content, not synthetic) covering headings, nested lists, GFM tables, fenced code, blockquotes, links, bold/italic/inline-code marks, a genuine thematic break, and (in `README.md`) emoji and image badges.
5. Ran three measurements against that corpus: round-trip fidelity (`run-fidelity.mjs`), load/perf at three sizes (`run-loadtest.mjs`), and install-footprint delta (measured in a scratch `/tmp` install, see Finding 4).

## Findings

### Finding 1 — Both pipelines are internally round-trip-stable; the unified pipeline surfaces structural loss the hand-rolled one currently hides

Every fixture round-tripped markdown→RichDocument→markdown→RichDocument and RichDocument→HTML→RichDocument at 100% text fidelity (token-level Dice similarity) for **both** engines — neither pipeline loses visible text on its own round trip. Cross-engine text agreement (do the two engines extract the same visible text from the same source at all) was 100% on 3/5 fixtures and 99.7% on the other 2. [source: `node scripts/prototypes/richdocument-unified/run-fidelity.mjs` against `tests/fixtures/rich-document-corpus/`, run 2026-07-17]

But block-type inventories diverge in a way the text-fidelity score doesn't capture:

| Fixture | droppedInfo (hand / unified) | list (hand / unified) |
|---|---|---|
| `adr-0001-zero-npm-core.md` | 0 / 1 | 5 / 5 |
| `adr-0029-install-scopes-and-hook-budgets.md` | 0 / 0 | **17 / 10** |
| `adr-0073-richdocument-ir-html-canonical-surface.md` | 0 / 2 | 7 / 7 |
| `readme.md` | 0 / 5 | 1 / 1 |

`lib/rich-document.mjs` has no handling for a mid-document thematic break (`---`) or a raw HTML block — both fall through `parseBlockAt`'s generic paragraph-text capture (`:394-405`, `isBlockStart` at `:408-412` matches neither), so the divider/HTML is silently absorbed as literal paragraph text with **zero** accounting. The unified pipeline correctly recognizes both as distinct node types it cannot map onto the RichDocument schema (which has no divider/rule Block type) and reports them as explicit `droppedInfo` blocks instead — the "silently produce incorrect structure with no upstream fix" failure mode this bead's own Problem statement names, reproduced directly: `readme.md` alone has 5 structural elements the hand-rolled reader drops with no signal at all.

The `adr-0029` list-count divergence (17 vs. 10) is a second, independent finding: the hand-rolled `parseList` (`:436-483`)'s indentation-sensitive continuation-line heuristic fragments what CommonMark treats as one nested list into multiple sibling list blocks on this real document. Root-causing the exact heuristic bug is out of this bead's scope (prototype/benchmark only, no production changes), but it is a second concrete, reproducible correctness gap the unified pipeline does not share.

### Finding 2 — A real, reproducible security gap: `javascript:` href survives the hand-rolled HTML round trip unsanitized

`htmlToRichDocument`'s `runsFromNodes` (`:749-754`) reads an anchor's `href` attribute verbatim into `Run.href` with no scheme check, and `richDocumentToHtml`'s `runToHtml` (`:626`) writes it straight back out. A probe HTML fragment containing `<a href="javascript:alert(1)">click</a>` round-trips through `htmlToRichDocument` → `richDocumentToHtml` with the `javascript:` URI **intact** (`hand.javascriptHrefSurvived: true` in the harness's JSON output). The same fragment through `htmlToRichDocumentUnified` (`rehype-parse` + `rehype-sanitize` with a schema extended for `data-cx-*`/`section`/`figure`) comes out with the href stripped (`unified.javascriptHrefSurvived: false`).

A `<script>` tag and an `onerror=` attribute do **not** survive either pipeline, but for different reasons worth distinguishing: the hand-rolled parser's safety here is incidental (its `blockFromNode`/`runsFromNodes` switch statements only read a fixed allowlist of tag names and attribute keys, so anything outside that list is silently dropped as a side effect, not a deliberate sanitization pass), while `rehype-sanitize` denies it by an explicit, maintained allowlist schema. This matters directly per ADR-0097's own citation of `packages/cx-ui/components/mermaid.tsx`'s unsanitized-`innerHTML` pattern and ADR-0073's framing of RichDocument HTML as "the canonical rendered surface": `htmlToRichDocument`'s own file comment states it "only needs to invert HTML this module itself produces... not arbitrary third-party HTML" — true today (nothing in production feeds external HTML into it yet, per the parent epic's "purely additive, nothing wired" status), but the extraction-provider contracts already landing in this program (`construct-tsyfe.2.1`) are the on-ramp for exactly that untrusted input, so this is a real, not hypothetical, forward-looking gap.

### Finding 3 — Performance: unified is consistently ~15-18x slower in wall time at every tested size

Full parse + serialize + HTML-round-trip timings (median of 30/15/6 runs; corpus concatenated 1x/25x/125x to build realistic bundle sizes):

| Size | Bytes | Hand-rolled (median ms) | Unified (median ms) | Ratio |
|---|---|---|---|---|
| 1x | 84,121 | 2.17 | 43.13 | 19.9x |
| 25x | 2,103,073 | 78.31 | 1,371.11 | 17.5x |
| 125x | 10,515,373 | 1,180.99 | 13,694.75 | 11.6x |

Both scale roughly linearly with input size; the unified pipeline carries a consistent large constant-factor overhead rather than degrading non-linearly. Heap-delta numbers from the same runs are noisy (occasional negative deltas from GC timing between samples) and are not reported as a reliable signal — wall time is.

In context: per the parent epic (`construct-tsyfe.3`)'s own verified current state, RichDocument parsing is not on a hot request path today — production ingest writes plain markdown and production export never calls `exportRichDocument` (test/certification-only). At single-document scale (tens of KB, one ADR or PRD), unified's absolute cost is single-digit-to-tens of milliseconds — negligible for a human-triggered export/ingest action. At the 10MB bundle extreme the ~13.7s absolute cost is real and worth a monitoring note for whichever bead first wires bulk/batch RichDocument processing, but it is not disqualifying for the documented current usage pattern.

### Finding 4 — Install footprint: shallow, no native binaries, no install-lifecycle scripts

Two numbers, because this repo's existing `apps/docs` devDependency tree (via `remark-gfm`) already hoists most of the unified/remark core into the shared `node_modules` — a benefit a standalone install of the published `@geraldmaron/construct` CLI would **not** get, since `apps/docs` is not in `package.json`'s `files` list:

- **Marginal, in this repo, right now**: adding `rehype-parse`, `rehype-stringify`, `rehype-sanitize`, `hast-util-to-html` as devDependencies added exactly 14 packages (`entities`, `hast-util-from-html`, `hast-util-from-parse5`, `hast-util-parse-selector`, `hast-util-sanitize`, `hast-util-to-html`, `hastscript`, `html-void-elements`, `parse5`, `rehype-parse`, `rehype-sanitize`, `rehype-stringify`, `vfile-location`, `web-namespaces`), ~2.3MB on disk.
- **Full standalone cost for a real production adoption** (measured via a scratch `/tmp` package installing only `unified`, `remark-parse`, `remark-gfm`, `remark-stringify`, `remark-rehype`, `rehype-parse`, `rehype-stringify`, `rehype-sanitize` as fresh `dependencies`, no hoisting help): **95 transitive packages, 8.6MB on disk**. Checked every one of the 95 package.json files for `preinstall`/`install`/`postinstall` scripts: **zero**. No native (`.node`) binaries anywhere in the tree.

95 packages is a real, non-trivial number, but the shape (pure JS, no build step, no native compilation) matches ADR-0097's own pre-classification of this delegation class ("mature libraries... are widely used with shallow, well-audited trees").

## Decision

**Adopt** — replace `lib/rich-document.mjs`'s hand-rolled Markdown/HTML parsers and `lib/rich-document-export.mjs`'s markdown serializer with a `unified`/`remark`/`rehype` (+ `rehype-sanitize`) pipeline, subject to the ADR-0001 amendment this bead already depends on (`construct-4uxq0.13.6` / ADR-0097, closed). Applying ADR-0097's rubric explicitly:

1. **Install footprint — medium.** 95 transitive packages / 8.6MB for a real standalone adoption (not the 14/2.3MB this repo's own docs-site hoisting makes it look like). Favorable shape: zero native binaries, zero install-lifecycle scripts across all 95 (Finding 4).
2. **Maintenance burden transferred — high.** ~974 hand-maintained lines (`lib/rich-document.mjs:218-511,776-851` + `lib/rich-document-export.mjs:91-165`) carrying two reproduced correctness gaps this prototype measured directly (silent thematic-break/raw-HTML loss, list-fragmentation divergence — Finding 1), not hypothetical ones, against a library with continuous upstream maintenance and CommonMark/GFM conformance testing neither this repo nor this bead has to build.
3. **Security surface — high, and confirmed, not asserted.** RichDocument HTML is ADR-0073's canonical rendered surface; `htmlToRichDocument` has a real, reproduced `javascript:`-href leak (Finding 2) that `rehype-sanitize` closes with a maintained, explicit schema rather than an accidental narrow allowlist.
4. **Replaceability — low risk (favorable).** Every caller already goes through `lib/rich-document.mjs`'s four named exports (`markdownToRichDocument`, `richDocumentToHtml`, `htmlToRichDocument`) and `lib/rich-document-export.mjs`'s `richDocumentToMarkdown` — this prototype's own adapter proves the internals are swappable behind those signatures without touching a single call site.
5. **Evidence bar — met by measurement, not by a live defect/CVE history.** No bug-tracker history exists for a component that isn't wired into production yet (per the parent epic's own "purely additive" status), so this is necessarily forward-looking — but ADR-0097 already pre-clears the class specifically so this bead doesn't have to re-argue that from zero, and this bead's own measurements (Findings 1–2) supply concrete, reproduced evidence rather than a hypothetical one.

Performance (Finding 3, ~15-18x wall-time overhead) is the real cost and is not waved away: it should be an explicit monitoring item for `construct-tsyfe.3.3` (the migration bead), particularly if RichDocument is ever wired to a bulk/batch multi-document path rather than the current per-document export/ingest usage.

## Non-goals honored

- No production code changed. `lib/rich-document.mjs` and `lib/rich-document-export.mjs` are unmodified by this bead.
- The four throwaway devDependencies used to run this prototype (`rehype-parse`, `rehype-stringify`, `rehype-sanitize`, `hast-util-to-html`) are **not** committed to `package.json` — installing the real, final dependency set (likely `unified`, `remark-parse`, `remark-gfm`, `remark-stringify`, `remark-rehype`, `rehype-parse`, `rehype-stringify`, `rehype-sanitize`, or whatever subset `construct-tsyfe.3.3` lands on after its own design pass) is that migration bead's job, not this one's.
- `scripts/prototypes/richdocument-unified/` is scratch, marked disposable in its own README and every file header, not imported by `lib/` or `bin/`. It is left in place (rather than deleted) because it is directly reusable by `construct-tsyfe.3.3`, and because `tests/fixtures/rich-document-corpus/` — the fixtures it exercises — must persist per this bead's own Tests requirement.

## Evidence for construct-tsyfe.3.3 (the migration bead)

- Reuse `tests/fixtures/rich-document-corpus/` as the base regression corpus regardless of how the migration is sequenced.
- `scripts/prototypes/richdocument-unified/unified-adapter.mjs` is a working reference mapping of mdast/hast onto the current RichDocument IR — treat it as a starting point, not a finished adapter (it hand-walks hast/mdast trees rather than using `remark-rehype`'s own mdast→hast conversion, specifically so the HTML side stays on RichDocument's exact existing `data-cx-*` shape for this comparison; the migration bead should re-evaluate whether that's still the right call once it owns the production adapter).
- Carry Finding 1's two reproduced correctness gaps (thematic-break/raw-HTML silent loss, list fragmentation) and Finding 2's `javascript:`-href leak into the migration's own before/after regression cases — they are concrete defects to close, not just "the old code was hand-rolled."
- Track Finding 3's performance delta against whatever RichDocument's actual call pattern turns out to be once `construct-tsyfe.3.4`/`.3.5` wire it into production ingest/export.
