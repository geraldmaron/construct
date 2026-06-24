---
description: audit the current state before authoring anything new.
---
# Review Before Change

Before creating or rewriting a durable artifact, check what already exists.

This rule exists because the most common waste in Construct is duplicated effort: a new strategy doc landing next to a PRD that already covers it, a new rule re-stating a section of `framing.md`, a new diagram drawn while an equivalent one sits two folders away. The fix is not more process. It is a fifteen-second audit before the first write.

## When this applies

Any time the work would produce or significantly rewrite one of:

- A doc under `docs/`, including concepts, cookbook, providers, runbooks, ADRs, RFCs, PRDs, memos, runbooks, decisions.
- A rule under `rules/` or a skill under `skills/`.
- A template under `templates/`.
- A top-level repo doc (README, CHANGELOG, STRATEGY, AGENTS, CONTRIBUTING).
- A profile under `profiles/` or a registered agent.

It does not apply to local-only working files (`plan.md`, `.cx/` state, draft scratch).

## The audit

Before writing, answer all three:

1. **Does an artifact for this already exist?** Search by topic, not filename. `grep -rli "<topic>" docs/ rules/ skills/` is the floor. If something close exists, the default is to extend or supersede, not to create a sibling.
2. **Is there a template or canonical shape for this artifact type?** Check `templates/docs/` and the matching `skills/docs/*-workflow.md`. If a shape exists, use it; do not invent a new structure.
3. **What is the canonical home for this kind of content?** A strategy doc belongs in one place. A new ADR does not live in `docs/notes/`. If you have to think about where to put it, the location is wrong.

If any answer surfaces an existing artifact, you have two valid moves:

- **Extend it.** Add the missing section to the existing file.
- **Supersede it.** Replace the old artifact and mark it superseded. Do not leave two competing sources of truth.

Creating a new sibling artifact "because the old one didn't quite fit" is the failure mode this rule prevents. If the old one doesn't fit, fix it.

## Documenting the audit

For artifacts that go through a review cycle (strategy, PRD, ADR, RFC), the framing or problem-statement section should briefly note what existing artifacts were reviewed and why a new one is warranted. One sentence is enough. The point is to leave evidence that the audit happened.

## Anti-patterns

- Creating `docs/notes/strategy.md` because you didn't notice `STRATEGY.md` at the root.
- Writing a new rule that paraphrases an existing one.
- Adding a new template alongside `templates/docs/strategy.md` because the existing one "needed a couple of tweaks."
- Drafting an ADR for a decision already captured in an existing ADR.
- Producing a recipe in `docs/guides/cookbook/` for a workflow already documented in `docs/guides/concepts/`.

## Related

- `rules/common/framing.md`: frame the underlying problem before reaching for inputs.
- `rules/common/doc-ownership.md`: which specialist owns which artifact type.
