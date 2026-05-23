<!--
Project PR template: required structure. Every section below stays in the
description. CI fails the PR if a required section is missing or all gate
boxes are unchecked. Replace <...> placeholders; do not delete the headings.
-->

## Summary

<one or two sentences explaining what the change does and why>

## Beads issue

Refs: `construct-<XXX>` <!-- required for any non-trivial change; use `none - trivial` only for typo/comment-only diffs -->

## Doc updates included

Tick what was updated in this same change. Tick `n/a` only when the concern genuinely did not change. Code-only PRs that should have updated docs but did not are incomplete.

- [ ] `CHANGELOG.md` - entry added (or `n/a`: <reason>)
- [ ] `docs/concepts/architecture.md` - runtime shape, contracts, or boundaries (or `n/a`)
- [ ] `docs/README.md` - docs surface or maintenance contract (or `n/a`)
- [ ] `.cx/context.md` / `.cx/context.json` - active work, decisions, assumptions (or `n/a`)
- [ ] `plan.md` - local working plan reflects completed work (local-only, gitignored)

## Local gates (paste evidence below or attest)

All four must pass locally before push. CI is a backstop, not the primary gate.

- [ ] `npm test` - 0 failed
- [ ] `node bin/construct lint:comments` - 0 errors AND 0 warnings
- [ ] `node bin/construct docs:verify` - all checks passed, no warnings
- [ ] `node bin/construct docs:update --check` - no drift

Shortcut: `npm run release:check`.

## Test plan

<bulleted list of what was verified, with concrete commands or steps>

## Risks / rollback

<what could go wrong, and how to undo this change if it does>
