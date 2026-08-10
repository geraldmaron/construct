# The broad fixture organization

A second fixture organization, built to test one specific explanation for a
result the first one produced.

## The question this harness exists to answer

Measured over `../org-harness`, role plants do not isolate the role that owns
them: asked different questions over the same material, the lenses return the
same findings and name the same mechanisms, and an independent judge pass
confirmed the collisions are real rather than an artifact of shared vocabulary.
Three explanations for that were tested and rejected — keyword brittleness,
unbounded per-role output, and badly keyed plants.

What was left untested is the material. The original corpus is 22 documents
from a single project's sync and hydration work, thematically narrow enough
that every role reading it may be forced onto the same few salient tensions.

This corpus spans concerns that do not share a subject: the terms the
organization sells work under, how it prices and bills, how it hires and
staffs, who holds access to which accounts, and what happens when delivery goes
wrong. If plants isolate here and collide there, convergence is a property of
narrow material and the depth claim is recoverable per corpus. If they collide
here too, role differentiation does not produce differentiated findings, and
that is a fact about the premise rather than about any corpus.

## What it answered (2026-08-10)

Breadth is not the explanation. Both corpora were swept in one sitting on one
family (`claude-sonnet-5` through `claude -p`, eleven lenses each, clean
context), and the plants collide here as they collide there:

| | this corpus | `../org-harness` |
| --- | --- | --- |
| owner lens found its own plant | 1/10 | 5/10 |
| plants established as discriminating | 0/10 | 1/10 |
| plants no lens found at all | 6/10 | 4/10 |

Read the two judged matrices together, never the broad one alone: this corpus
was the harder of the two to find anything in, so it carries less evidence, and
the pair licenses "breadth did not rescue discrimination" rather than anything
about breadth making it worse. Full write-up, including why the finding survives
the judge's own lack of independence, is `RESEARCH-DECISIONS.md` §14.

## What is in here

- `corpus/` — what the system under test is given, and nothing else. See
  `PROVENANCE.md` for every document's origin, licence, and retrieval commit.
- `answer-key.json` — the planted ground truth, in the same shape the scorer
  reads for the original harness. Recorded before any run; never edited to fit
  one.
- `raw/` — the fetched originals, kept so every plant is auditable as a diff.
- `runs/` — scored run outputs land here, one JSON per dispatch.

## Running and scoring

Every tool takes the harness or corpus as a flag, so nothing here is a second
copy of the original's tooling:

```bash
node scripts/run-org-harness-ollama.mjs --model qwen3.6:35b \
  --harness fixtures/org-harness-broad --lens compliance \
  --out fixtures/org-harness-broad/runs/<date>-compliance-<label>.json

node scripts/score-org-harness.mjs --harness fixtures/org-harness-broad \
  fixtures/org-harness-broad/runs/<file>.json

node scripts/check-plant-discrimination.mjs --suite <label> \
  --runs fixtures/org-harness-broad/runs
```

## The rules this harness inherits

The original harness's recorded discipline applies here unchanged, because the
comparison is worthless if the two are graded differently:

- A key is never edited after seeing a run. A plant that fails is retired and
  recorded as failed, not re-keyed to exclude whatever collided with it.
- Discrimination is a property of a sweep, not of a run: every lens dispatched
  once over a fixed corpus on a fixed family, then asked of each plant which
  lenses earned it.
- A credited claim must state the planted mechanism to count, judged
  separately from the structural match.
- Hits and misses are enumerated. At single-digit run counts there are no rate
  claims.
- A run produced by the same model family that authored the plants carries the
  correlated-error caveat wherever its numbers are quoted.
