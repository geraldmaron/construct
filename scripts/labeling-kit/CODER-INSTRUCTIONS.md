# Labeling instructions (construct-2jb.3)

Thank you for doing this. It should take under an hour.

## What this is for

We route each outcome a user types ("hire a contractor in Poland", "add a
raffle for early signups") to a small set of domains — privacy, contracts,
security, and so on — so the right expertise gets pulled in automatically.
We want to know how much two careful people, working alone, disagree about
which domains a given outcome touches. That disagreement rate is a floor: no
automated system can be more accurate than the rate at which humans agree
with each other on the same judgment.

## What you have

A file named `<your-name>.json` containing:

- `catalog`: the list of domains you can choose from, each with a one-line
  description of what it covers.
- `outcomes`: a list of short outcome descriptions, each with a `labels`
  field currently set to `null`.

## What to do

For each outcome, read it and decide which domains (zero or more) it
implicates, using only the `catalog` descriptions as your guide — not your
own intuition about what a "domain" usually means, not any keyword list, and
not this project's code. Judge as a competent, careful person would, from the
plain English of the outcome and the plain English of the domain's concern.

Set `labels` to an array of the matching domain names (the `domain` field
from the catalog, e.g. `"privacy"`, `"employment"`), or `[]` if none apply.
Never leave `labels` as `null` — every outcome needs an explicit answer, even
if that answer is "none of these."

Example:

```json
{
  "sheetPosition": 1,
  "id": "held-out:h9",
  "outcome": "Start charging our European customers in euros instead of dollars",
  "labels": ["commerce-tax"]
}
```

An outcome can have more than one label if it genuinely touches more than one
domain — don't force a single answer, and don't pad the list to hedge either.

## Rules

1. **Work alone.** Do not discuss any outcome, your reasoning, or your
   answers with the other coders, before, during, or after. Do not compare
   notes. The whole point of this exercise is to measure what independent
   judgment looks like — a conversation between coders would erase the thing
   we're trying to measure.
2. **Don't look at the project's source code, tests, or the other corpora**
   while labeling. Judge from the catalog descriptions in your sheet and the
   outcome text alone.
3. **Don't skip outcomes.** Every one needs a `labels` answer, even an empty
   one.
4. **Work at your own pace**, but try to do all outcomes in one or two
   sittings rather than spread across weeks — that keeps your own judgment
   consistent across the sheet.
5. Trust your first honest read. There's no "correct" answer we're checking
   you against; the point is to see where two honest readings land.

## When you're done

Save your file (keep the filename `<your-name>.json`) and send it back to
Gerald. Do not rename it to something identifying which "round" or "attempt"
it was — one file per coder, final answer.
