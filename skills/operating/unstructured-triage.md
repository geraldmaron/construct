---
name: operating-unstructured-triage
description: "Use when: a brain-dump, rough notes, or free-form input has no clear type and needs to be structured into intents, candidate work items, and open questions before routing."
inputs: [unstructured-text]
artifactType: triage-summary
---
# Unstructured Triage

Use this skill when free-form input — a brain-dump, rough notes, a stream of thoughts — arrives with no clear type and the classifier returned low confidence or `unknown`.

The goal is not to force a classification. It is to extract the latent intents and candidate work items so a human (or a follow-up workflow) can decide what, if anything, to act on. Inventing structure that isn't there is the failure mode.

## Steps

1. **Read for intent, not form.** Separate the few actionable signals from thinking-out-loud.
2. **Extract candidate work items** — each as a one-line `{ intent, possibleType }` where `possibleType` is your best guess at the taxonomy (bug, requirement, research, memo, …) or `unclear`.
3. **Extract open questions and unknowns** explicitly — these are usually the point of a brain-dump.
4. **Note what is missing** to act: a brain-dump rarely has enough to execute. Name the clarifications a human would need.
5. **Do not assign owners or due dates** unless the text states them.
6. **Recommend a next step**, not a commitment: "clarify X", "split into N items", or "discard — no actionable signal".

## Output shape

```
## Read
<2–4 sentence neutral summary of what this seems to be>

## Candidate items
- <intent> — possibleType: <type|unclear>

## Open questions
- <question>

## To act, we'd need
- <missing information>

## Recommended next step
<clarify | split | route to <type> | discard>
```

## Verification bar

- Candidate items reflect intents actually present in the text; nothing is fabricated to look productive.
- Confidence stays low where the input is genuinely vague — the output says so rather than manufacturing certainty.
- No owners, dates, or decisions are asserted unless the input states them.
