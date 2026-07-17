# DISPOSABLE PROTOTYPE -- construct-tsyfe.3.2

This directory is scratch harness code for one bead's decision, not shipped production code.
It exists to answer one question: does the `unified`/`remark`/`rehype` ecosystem produce a
higher-fidelity round trip than `lib/rich-document.mjs`'s hand-rolled parsers, at an acceptable
install/perf cost?

It depends on four throwaway `devDependencies` (`rehype-parse`, `rehype-stringify`,
`rehype-sanitize`, `hast-util-to-html`) added to the root `package.json` for this prototype
only. See `docs/notes/research/decision-input/richdocument-unified-prototype.md` for the
decision this produced and whether those dependencies were kept.

**Nothing here is imported by `lib/` or `bin/`.** If you are reading this after
construct-tsyfe.3.2 closed and the decision was "retain," this directory and the four
devDependencies above should already be gone -- file a bug if they aren't. If the decision was
"adopt," this directory still isn't wired into production; that migration is
construct-tsyfe.3.3's job.

## Contents

- `unified-adapter.mjs` -- maps `mdast`/`hast` trees onto the *same* RichDocument IR
  `lib/rich-document.mjs` defines (reuses its `make*` factories directly, so the two pipelines
  produce directly comparable output), using `remark-parse`/`remark-gfm`/`remark-stringify` for
  the markdown side and `rehype-parse`/`rehype-sanitize`/`rehype-stringify` for the HTML side.
- `run-fidelity.mjs` -- round-trips every fixture in `tests/fixtures/rich-document-corpus/`
  through both the hand-rolled pipeline and the unified pipeline (markdown -> RichDocument ->
  markdown, and HTML -> RichDocument -> HTML) and reports a per-fixture fidelity table.
- `run-loadtest.mjs` -- assembles larger synthetic documents from the same corpus and times/
  measures both pipelines at realistic sizes.

## Running

```
node scripts/prototypes/richdocument-unified/run-fidelity.mjs
node scripts/prototypes/richdocument-unified/run-loadtest.mjs
```

Both are read-only against the fixtures directory and write nothing outside the OS temp dir.
