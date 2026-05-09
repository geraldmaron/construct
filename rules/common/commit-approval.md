<!--
rules/common/commit-approval.md — conversational approval rule for mutating git operations.

Behavioral rule, not a hook. The agent asks and waits for a yes; the user
replies in chat. Infrastructure stays out of the way.
-->
# Commit Approval

Construct does not commit, push, or merge without the user explicitly saying yes in the current conversation.

## The rule

Before running any of these Bash tool calls:

- `git commit`
- `git push`
- `gh pr merge`

The agent must:

1. **State the working branch** so the user sees the scope.
2. **State what's about to happen** — the commit message for a commit, the target refspec for a push, the PR number for a merge.
3. **Ask for confirmation** and wait for a yes before executing.

A yes from the user in chat is the approval. No marker file, no CLI command, no special syntax.

## Exceptions

- **The user explicitly tells the agent to run the whole sequence** ("commit, push, and merge when ready"). That single yes covers the batch.
- **Read-only git operations** (`git status`, `git log`, `git diff`, `git fetch`, `git branch`, `git show`) don't need approval.

## Why this is a rule, not a hook

A hook that blocked every commit turned out to be over-restrictive — it required a separate command invocation to write a marker file each time, which added friction without much safety beyond the agent just following the rule. The agent is the one producing commit messages; asking in chat is the right interface.

If the agent ever commits without asking, that's a correctness bug. Surface it in the session and raise a follow-up to catch the regression.
