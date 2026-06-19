<!-- provenance: best-practices audit for bead construct-l9sk; authored on staging branch; verification commands and SHAs in-line. -->
# Best-Practices Audit — Shipped Work (tool-invisibility guardrail + 11-branch staging integration)

**Bead**: construct-l9sk · **Branch audited**: `staging` · **HEAD**: `ad664be` (PR #220 merge commit) · **Date**: 2026-06-04
**Scope**: (A) tool-invisibility guardrail `d71edce`; (B) 11-branch `-X ours` staging integration `4317e1e` → staging HEAD `ad664be`; (C) process concerns (admin-bypass CI, docker-autostart revert).
**Method**: git forensics (log/show/diff, signature-file + symbol presence on HEAD), live `lintFile` edge-case probes, `gh pr checks`. No code changed.

---

## VERIFIED-GOOD

1. **Tool-invisibility wiring is complete and survives on HEAD.** Shared guidance reaches every specialist (`specialists/registry.json:1514` sharedGuidance entry), persona references the rule (`personas/construct.md:67`), policy inventory registers it (`specialists/policy-inventory.json` id `tool-invisibility`, mode `deterministic-85`), and the rule file exists (`rules/common/tool-invisibility.md`). `d71edce` lands AFTER the integration `4317e1e` in ancestry, so nothing clobbered it.
2. **Self-repo skip is correct.** `isConstructSelfRepo` (`lib/comment-lint.mjs:76`) reads `package.json` name `@geraldmaron/construct`, memoized per `rootDir`. Verified: Construct's own deliverables are not flagged; a `my-app` deliverable is. Matches rule §3.
3. **Deliverable scoping is sensible.** `DELIVERABLE_LEAK_GLOBS` (`lib/comment-lint.mjs:60`) covers `docs/**/*.md` + `.cx/{research,knowledge,handoffs}/` + `.cx/strategy.md`; README and non-deliverable paths are not scanned (verified via probe).
4. **HTML-comment, frontmatter, and lang-tagged code-fence skips work.** Provenance in `<!-- … -->` (single- and multi-line), YAML frontmatter, and ```js fences are correctly skipped while real leaks after a closed fence are still flagged. Table-cell leaks ARE caught — the exact surface of the original incident (`tests/tool-invisibility.test.mjs:47`).
5. **No skip vars introduced.** `git show d71edce | grep CONSTRUCT_(SKIP|ALLOW|QUIET)_` → none. `tests/hooks/no-skip-vars.test.mjs` passes (43 cases). `CONSTRUCT_ARTIFACT_LINT_MODE` is a severity selector documented in the rule, not a gate-skip.
6. **Comment-convention compliant.** `lintFile` over `lib/comment-lint.mjs`, `tests/tool-invisibility.test.mjs`, `rules/common/tool-invisibility.md` → 0 errors / 0 warnings. New code uses only section-context blocks; no inline trailing or narrative comments.
7. **Test suite green.** `tests/tool-invisibility.test.mjs` 11/11 pass (prose leak, table-cell leak, self-repo skip, HTML-comment skip, clean deliverable, non-deliverable path, block-mode routing, + 4 wiring guards).
8. **(B) Zero net-new deliverable files dropped.** All 71 net-new files added across the integrated branches are present on HEAD `ad664be` (orchestration-daemon-api, enforcement-durability, research-grade phase-c/d/remediation, toolchain-pinning, ingest extraction/strategy, mcp-server-meaningful). present=71 missing=0.
9. **(B) orchestration-daemon-api fully wired.** ACP server registered `bin/construct:5170`; `orchestration_run`/`orchestration_status` tools wired `lib/mcp/server.mjs:1180,1293-1294`; ADRs present (`docs/adr/0022-orchestration-daemon-api.md`, `docs/adr/0023-acp-agent.md`). ADR-first discipline honored.
10. **(B) toolchain-pinning hunks landed in modified files.** `.tool-versions` present; CI references `node-version-file: .tool-versions` 6× on HEAD; `packageManager` pin present in `package.json` — these are exactly the modified-file hunks `-X ours` could have dropped; they did not.
11. **(B) ingest + mcp signatures landed and wired.** `lib/ingest/provider-extract.mjs`, `lib/ingest/strategy.mjs` present and imported in `lib/document-ingest.mjs:33` and `lib/embedded-contract/ingest.mjs:20`; functional test `tests/functional/ingest-strategy.functional.test.mjs` present (multi-component requirement satisfied); `tests/mcp-server-identity.test.mjs` present.
12. **(B) research-grade content relocated, not lost.** Admiralty-scale grading, primary/secondary/tertiary classes, community-as-primary rule, and `A1/A2/B1` confidence mapping all present on HEAD across 8 files (`rules/common/research.md`, `research-sources.md`, `specialists/prompts/cx-researcher.md`, + 5 templates). The branch's inline version was superseded by the prompt-density refactor (`1c3e1c9`) which moved detail into `rules/common/research.md` §2 and `get_template("research-brief")`. Re-applying the branch would REGRESS the refactor. CONFIRMS prior session.
13. **(C1) HEAD is CI-verified.** PR #220 `mergeCommit.oid = ad664be` = current staging HEAD. All 11 checks PASS: ci-required, dashboard build, CVE audit, detect-changes, lint suite, live LLM, postgres+pgvector, retrieval evals, review, secret scanning, test (node 22). The earlier admin-bypass concern is resolved at the current HEAD.
14. **(C2) docker-autostart bug fully reverted in setup.** No `autoStart`/`tryStartDockerDaemon`/`startDockerDaemon` references in `lib/setup.mjs` on HEAD. The exported `detectDockerCompose` (`lib/setup.mjs:305`) is the canonical path (used `:349`, `:573`); diff vs `main` for `setup.mjs` is a schema-migration refactor only, unrelated to docker autostart. The legitimate autostart feature lives in `lib/service-manager.mjs:444` with documented opt-out — that is correct and out of scope of the bug.

---

## CONCERNS

### C-1 — [HIGH] `CX_ROLE_LEAK` regex over-matches: false positives on real `cx-*` package/product names
**Evidence**: `lib/comment-lint.mjs:325` — `const CX_ROLE_LEAK = /\bcx-[a-z][a-z0-9-]*\b/;`. The pattern is open-ended, not anchored to the 28 real role ids in `specialists/registry.json`. Probe results in a `my-app` deliverable (`docs/*.md`): `cx-oracle` (the widely-documented Oracle DB driver for Python), `cx-pro`, `cx-ray` ALL flagged as tool-identity leaks. A consuming project that documents `cx-oracle` in `docs/` gets a spurious leak warning on every such line.
**Failure scenario**: a Python-shop user runs the release gate (`CONSTRUCT_ARTIFACT_LINT_MODE=block`) with `cx-oracle` in their architecture doc → build fails on a false positive with no legitimate fix except editing prose that is correct. The rule file claims "near-zero false positives" (`rules/common/tool-invisibility.md:33`); this claim is not met for projects whose vocabulary includes `cx-`-prefixed identifiers.
**Why it matters**: block mode is the release gate. A false positive there is a hard stop on correct user content.

### C-2 — [MEDIUM] Tilde (`~~~`) and indented (4-space) code fences are not skipped → false positives inside legitimate code blocks
**Evidence**: `lib/comment-lint.mjs:337` — fence detection is `/^```/` only. Probe: a `cx-product-manager` token inside a `~~~ … ~~~` fence (CommonMark-valid) is flagged (line scanned, not skipped). Same for a 4-space-indented code block. The ```js (backtick, lang-tagged) case is handled; tilde and indented are not.
**Failure scenario**: a deliverable that shows an example config/command inside a `~~~` block containing a `cx-*` token is flagged as a leak even though it is code, not prose.
**Why it matters**: lower frequency than C-1 (tilde fences are less common than backtick), but same false-positive class on the release gate.

### C-3 — [MEDIUM] Unclosed code fence silently masks all subsequent leaks (false negative)
**Evidence**: `lib/comment-lint.mjs:337-338` toggles `inFence` on every ```` ``` ```` line and `continue`s while `inFence`. Probe: a document with an opening ```` ``` ```` that is never closed causes every later line — including a real `cx-product-manager` leak — to be skipped (`t5.md`: 0 warnings where 1 was expected). The state never resets per-document section.
**Failure scenario**: a malformed/truncated deliverable with an unbalanced fence lets a genuine tool-identity leak ship undetected. This is the more dangerous direction — the backstop fails open.
**Why it matters**: the guardrail's whole job is to catch leaks; an unbalanced fence defeats it silently.

### C-4 — [MEDIUM] Test-coverage gap: edge cases in C-1/C-2/C-3 are untested
**Evidence**: `tests/tool-invisibility.test.mjs` covers prose, table-cell, self-repo, HTML-comment, clean, non-deliverable, block-mode (7 behavior cases). It does NOT cover: open-ended-regex false positives (`cx-oracle`), tilde/indented fences, inline backtick code, or unclosed-fence false negatives. The exact failure modes in C-1..C-3 would not be caught by the current suite — they pass today and would keep passing after a regression.
**Why it matters**: the suite gives false confidence that fence/false-positive handling is robust.

### C-5 — [LOW] Duplicate `## Output format` heading in `specialists/prompts/cx-researcher.md`
**Evidence**: `ad664be:specialists/prompts/cx-researcher.md:69` and `:75` both read `## Output format` (two adjacent sections). Surfaced during the research-grade content forensics. PRE-EXISTING from the prompt-density refactor `1c3e1c9`, NOT caused by the `-X ours` integration. This is a generated prompt; the duplication is cosmetic but ships in a specialist's instructions.
**Why it matters**: minor authoring defect in a shipped prompt; low risk, easy fix, worth a one-line cleanup.

### C-6 — [LOW / process] `-X ours` is a fragile integration strategy; this round it cost three CI breakages
**Evidence**: per bead notes + commit history `56ff8f4` (package-lock long@5.3.2 drift broke `npm ci`), `00cb456` (ci.yml duplicate `needs`/`if` keys → 0s workflow fail), `ce3a9dc` (duplicate object keys `roleSelection` in `lib/config/schema.mjs`, `engineer` in `lib/orchestration-policy.mjs`). These were the real casualties — all CI-infra, all caught and fixed before the HEAD that passed. No source content was lost (Section B), but the strategy silently produced broken-but-syntactically-plausible merges that only a full CI run surfaced.
**Why it matters**: the failure mode is "looks merged, is subtly broken." Caught this time by CI; the dependency on CI as the safety net is the concern, not a current defect.

---

## REMEDIATION RECOMMENDATIONS (priority order)

1. **(C-1, HIGH) Anchor `CX_ROLE_LEAK` to the real role-id set.** Build the alternation from `specialists/registry.json` ids (28 of them) at module load: `new RegExp('\\bcx-(?:' + ids.join('|') + ')\\b')`. This eliminates `cx-oracle`/`cx-pro`/`cx-ray` false positives entirely while still catching every real role id. Add a registry-drift guard so a new specialist auto-extends the pattern. This also makes the rule file's "near-zero false positives" claim true.
2. **(C-2 + C-3, MEDIUM) Harden fence handling.** Recognize `~~~` fences (and ideally indented code blocks) in the fence toggle; and treat an unclosed fence defensively — either reset `inFence` at document end and re-scan, or (simpler) do not let an unterminated fence suppress scanning (e.g. only honor a fence that has a matching close). Failing open on leaks is the wrong default for a backstop.
3. **(C-4, MEDIUM) Add regression tests** for: `cx-oracle`/`cx-pro` NOT flagged (post-anchor), tilde-fence skip, indented-code-block skip, and unclosed-fence still-flags-after. These lock in fixes 1-2 and close the false-confidence gap.
4. **(C-5, LOW) De-dup the `## Output format` heading** in the `cx-researcher` source prompt and re-run `construct sync`; verify other density-refactored prompts don't share the duplication.
5. **(C-6, LOW/process) Stop using `-X ours` for multi-branch integration.** Prefer a real merge (resolve conflicts deliberately) or sequential PRs. If a throwaway integration branch is needed for "test this version," keep it OFF protected `staging` and never admin-bypass — run CI on the integration branch first. The eight-check gate (CONTRIBUTING.md) should be the entry condition to `staging`, not the post-hoc cleanup.

---

## DISPOSITION

- **Section A**: guardrail is correct on the happy path and well-wired; the deterministic backstop has real false-positive (C-1, C-2) and one false-negative (C-3) gaps that should be fixed before relying on block mode in consuming projects.
- **Section B**: REFUTE the worry / CONFIRM the prior conclusion — `-X ours` dropped NO intended source content. All 71 net-new files, all sampled modified-file hunks, and all distinctive symbols are present on HEAD `ad664be`. The single non-build "delta" (cx-researcher.md) is staging being the newer post-refactor version. The only real casualties were three CI-infra breakages, all already fixed.
- **Section C**: both process concerns RESOLVED at current HEAD — C1 (HEAD = PR #220 merge, 11/11 checks pass) and C2 (setup.mjs clean, autostart reverted).

Top fix to act on first: **C-1 (anchor the regex)** — it is the only HIGH and it directly undermines the release gate for a class of real users.
