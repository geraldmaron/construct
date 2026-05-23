# Style

Voice, punctuation, and structure rules for everything in this repo.

## Voice

Construct is an open source project I started to learn. Docs should sound like a person wrote them.

- Short sentences. One idea per sentence.
- No marketing voice. No words like "robust", "powerful", "enterprise-grade", "best-in-class".
- Acknowledge limits. If something is partial, say so. If it might break, say so.
- Refer to the project as a project, not a product.
- The README opens with a personal note. Other docs do not need to, but they should not contradict it.

## Punctuation

- **No em-dashes** in user-facing markdown. Use a period, comma, or colon instead. Enforced by `npm run lint:prose`.
- Plain ASCII quotes are fine. Smart quotes only where they already appear and edits would create churn.
- Lists prefer hyphens, not bullets or asterisks.
- Code spans use single backticks. Code blocks declare a language.

## Structure

- A doc starts with a one-line description of what it is for.
- Sections answer questions a reader would ask in order. Avoid headings that exist only because the template demands them.
- Auto-generated regions stay inside `<!-- AUTO:... -->` markers and are owned by `lib/auto-docs.mjs`. Do not edit by hand.
- Cross-link to the canonical doc. Do not paraphrase the canonical content somewhere else.

## PR descriptions and commit messages

A PR description tells the reviewer what the change does and how to evaluate it. Nothing else.

- Describe the change, not the process. "Adds a Stop hook that writes session summaries" is in scope. "Personal voice rewrite" or "tone now matches the rest of the project" is meta-commentary that belongs in a chat log, not the PR.
- Lead with what users see. The first bullet should be a behavior or capability, not a refactor.
- Skip the writing rationale. Do not explain why you chose a tone, why a section was reframed, or why phrasing was changed. If the diff is the rationale, the diff speaks for itself.
- Skip self-congratulation. No "validated end-to-end", "fully tested", "battle-tested". State the test plan; let the reviewer decide.
- Risks and rollback get one short bullet each. If the section needs more, the PR is probably too big.
- Out of scope gets called out explicitly. A reader should never have to guess what was deferred.

Commit messages follow the same rule. The subject line is what the commit does. The body is what changed and why a future reader needs to know. Tone, framing, and author commentary belong in neither.

## What this project does not do

- We do not ship docs that overclaim.
- We do not use marketing voice. The project is a side project that grew.
- We do not let a doc drift. If a code change makes a doc wrong, the same PR fixes the doc.

## Tooling

`npm run lint:prose` is the prose gate (em-dashes, banned patterns). Default scope is changed files; pass `--all` to scan everything. The full PR gate list lives in `CONTRIBUTING.md` § "Before opening a PR"; do not duplicate it here.

## Exceptions

- `CHANGELOG.md` historical entries keep their em-dashes because rewriting history is lying. New entries must follow the rules.
- `CLAUDE.md` and `AGENTS.md` are AI operating instructions. They are intentionally formal and are exempt from the voice rules. The punctuation rule still applies where reasonable.
- One-off exceptions for a single file go in `.proseignore` with a load-bearing reason next to the path.

## When in doubt

Read the README. The opening note is the tone of the project. Match it.
