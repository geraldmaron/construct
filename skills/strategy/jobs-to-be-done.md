---
name: strategy-jobs-to-be-done
description: "Use when: user research needs to uncover the job a user is hiring a product to do — the underlying progress they seek — rather than feature requests or stated preferences."
inputs: [user-signals-or-interviews]
artifactType: jtbd-summary
---
# Jobs To Be Done

Use this skill when user research needs to surface the underlying job a user is trying to get done, not the features they ask for.

Users describe solutions ("add a dark mode"); the job is the progress they're trying to make and the context that triggers it. Building to stated features without the job produces local optima nobody hires.

## Steps

1. **Anchor on a real episode**, not a hypothetical. "Tell me about the last time you…" — recent, specific, remembered.
2. **Trace the timeline**: the trigger (what changed that made them act), the struggle with the current approach, what they tried, and the outcome they were after.
3. **Separate the job from the solution.** "I want X feature" → ask "what would X let you do that you can't now?" Keep climbing until you reach a stable goal that doesn't reference your product.
4. **Capture the forces**: push (problems with the status quo), pull (attraction of a new way), and anxieties/habits that hold them back. Adoption is decided by these four forces.
5. **Watch for non-consumption**: people who have the job but use nothing, or a manual workaround — often the clearest signal of the job.
6. **State the job** as `When <situation>, I want to <motivation>, so I can <expected outcome>` — sourced to the episodes, not invented.

## Output shape

```
## Job statement(s)
- When <situation>, I want to <motivation>, so I can <outcome> — evidence: <episode refs>

## Forces
- push: … · pull: … · anxiety: … · habit: …

## Non-consumption / workarounds observed
```

## Verification bar

- Each job statement traces to a specific recounted episode, not a generalization or an assumption about "users".
- Solution language ("add X") is climbed back to the underlying job, not recorded as the job.
- Forces and non-consumption come from what was observed/said, labeled where inferred.
