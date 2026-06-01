---
description: conversational approval rule for mutating git operations.
---
# Commit Approval

Construct does not commit, push, or merge without the user explicitly saying yes in the current conversation.

## The rule

Before running any of these Bash tool calls:

- `git commit` (including `git commit --amend`)
- `git push`
- `gh pr merge`

The agent must:

1. **State the working branch** so the user sees the scope.
2. **Show the proposed action verbatim**: for a commit, the full proposed message (subject and body) formatted exactly as it will appear in `git log`. For a push, the target refspec. For a merge, the PR number and merge mode (`--squash`, `--rebase`, etc.).
3. **Ask for confirmation** and wait for a yes before executing.

A yes from the user in chat is the approval. No marker file, no CLI command, no special syntax.

The standard proposal format for a commit:

```
Branch: <name>
Proposed commit message:

  type(scope): subject

  Optional body explaining the why.

Run `git commit`?
```

Then stop and wait.

## Exceptions

- **The user explicitly tells the agent to run a defined sequence** ("commit, push, and merge when ready"). That single yes covers the named batch: but only the actions named, in the order named. A new commit triggered later (e.g. by a CI fix or follow-up edit) is its own approval gate.
- **Read-only git operations** (`git status`, `git log`, `git diff`, `git fetch`, `git branch`, `git show`) don't need approval.

A "yes" from earlier in the session does NOT carry forward to subsequent commits. Each new commit message must be shown and approved.

## Why this is a rule, not a hook

A hook that blocked every commit turned out to be over-restrictive: it required a separate command invocation to write a marker file each time, which added friction without much safety beyond the agent just following the rule. The agent is the one producing commit messages; asking in chat is the right interface.

If the agent ever commits without asking, that's a correctness bug. Surface it in the session and raise a follow-up to catch the regression.
