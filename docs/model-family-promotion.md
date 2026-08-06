# How a model family moves from best-effort to tuned

`src/hosts/tuning.ts` holds the tuned list; everything else runs labeled
best-effort with a degradation note per dispatch. This document is the gate a
family passes to move up, written down so promotion is a procedure rather than
one session's memory.

## The criteria

A family is promoted when, on a named model of that family, all three hold:

1. **Contract floor.** `scripts/probe-model-contract.mjs` records the namer
   and densifier contracts clean (or repaired) on every trial — no
   fell-through. Artifact in `fixtures/model-floors/`, dated.
2. **Dispatch-shape depth.** The org-harness passes **all four rungs** on the
   per-lens dispatch shape (`--lens` / `--notes` composed via
   `scripts/compose-org-harness-run.mjs`), scored by
   `scripts/score-org-harness.mjs` against the pre-committed answer key, with
   both distractors clean. Run and score artifacts in
   `fixtures/org-harness/runs/`.
3. **Stability.** The pass repeats: the same shape lands the awareness plants
   at a stated rate over repeated runs (the tuned family's record states 5/5
   and 4/5 for its two plants), and the rate travels with the claim wherever
   the depth is quoted.

## The procedure

1. Probe the contract floor; commit the artifact.
2. Run the harness per lens plus the notes pass, compose, score; commit run
   and score files. Hosted families run through the same runner
   (`--endpoint openrouter`) so the prompt is byte-identical.
3. Repeat the harness run until a stability rate can be stated.
4. Append the family to `TUNED_FAMILIES` with the evidence location and the
   date; never backdate, never widen a match pattern past what was measured.
5. State the result in the CHANGELOG under the release that ships it.

## What a failure means

A family that misses a rung stays best-effort, and the recorded run is the
evidence — the answer key is never widened to fit a run, and prompts are only
changed in ways measured against the tuned family first. A hosted free-tier
model that cannot be reached (rate limit, delisting) is recorded `unmeasured`,
not failed: the free catalogs churn monthly, which is exactly why every
artifact here is dated and per-model, and why no result is ever generalized to
"the free tier".

## Record so far (2026-08-06)

- `claude` — tuned 2026-08-05 (clean-context lens runs, all rungs).
- `qwen3.6:35b` (local) — contract clean; harness FAIL on the composed
  dispatch shape (X1, R2 missed; distractors clean). Stays best-effort.
- `qwen3.5:4b` (local) — namer below floor even with the corrective retry;
  densifier clean. Not a promotion candidate.
- `gpt-oss:20b` (local) — contract clean on every trial; the namer floor on
  this hardware sits between 4b and 20b. Harness run not yet attempted.
- `nvidia/nemotron-3-super-120b-a12b:free` (OpenRouter) — contract clean on
  every trial; harness **FAIL** on the composed dispatch shape. The first
  score charged it with two fabricated citations; that was the scorer's
  false accusation (real documents cited by unique basename — a format
  violation, not invention), fixed and rescored the same day: rung 0 now
  passes with the shortening reported. The remaining misses are the bar
  itself, on the same byte-identical prompt the tuned family passes: X1 and
  R1 are genuinely absent (R1's near claim cites the right pair but states a
  different mechanism), R2's substance appears twice but never with the
  two-document pair that proves the synthesis, and four of six awareness
  plants miss. Distractors clean. Stays best-effort on depth, correctly.
