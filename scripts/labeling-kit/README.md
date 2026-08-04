# Labeling kit (construct-2jb.3)

Establishes whether the project's 0.15 miss target is reachable at all, by
measuring how much two-to-three careful humans disagree with each other on
the same 30+ outcomes, independently. See `bd show construct-2jb.3` for the
full spec, and `RESEARCH-DECISIONS.md` §2 for why this question exists.

This kit builds sheets and computes statistics. **It does not, and must
never, produce labels itself** — see the warning at the top of
`compute-alpha.mjs` and `CODER-INSTRUCTIONS.md`. Every corpus this project
has is single-author; recruiting 2-3 human labelers is the fix, and an agent
or model standing in for one of them recreates the exact circularity
`construct-gsf` identified, with a model as the author.

## Steps for Gerald

1. **Recruit 2-3 labelers.** They should not be the corpus author (you) — or
   if one of them is, that should be a known limitation you note when
   reporting the result, not silently absorbed.

2. **Generate the sheets**, one per labeler, using their names (or any
   consistent, non-identifying handle):

   ```bash
   node scripts/labeling-kit/generate-sheets.mjs alice bob carol
   ```

   This writes `scripts/labeling-kit/sheets/alice.json`,
   `.../bob.json`, `.../carol.json`, and a `manifest.json` recording
   provenance. All three sheets cover the exact same 34 outcomes (drawn from
   `held-out-outcomes.json` and `fresh-outcomes.json` — never
   `labeled-outcomes.json`, which shares an author with the domain catalog),
   in an independently shuffled order per coder, with `expect`/`category`
   stripped so no one can see anyone's prior answer.

3. **Send each coder their own sheet and `CODER-INSTRUCTIONS.md`.** Tell them
   explicitly not to discuss the task with each other — the instructions say
   this too, but it's worth saying again in person/chat, since it's the part
   most likely to get casually violated ("hey, quick question about outcome
   12...").

4. **Collect the completed sheets** and drop them into
   `scripts/labeling-kit/returned/`, keeping the filename `<coder-name>.json`
   (matching what they were sent — the coder name becomes their id in the
   alpha computation).

5. **Compute alpha and the floor:**

   ```bash
   node scripts/labeling-kit/compute-alpha.mjs
   ```

   This refuses to run with fewer than 2 returned sheets, and refuses to
   fabricate any input — it only ever reads what's actually in
   `returned/`. It prints:
   - Krippendorff's alpha (MASI distance, the multi-label-appropriate
     metric — this is the number that answers the acceptance criteria) and,
     for reference, the stricter exact-match nominal alpha.
   - The implied Bayes error floor, derived from observed disagreement under
     an explicitly stated model (documented in the script) — not a bare
     number.
   - A verdict: whether 0.15 sits above or below that floor.

6. **Record the result** in `RESEARCH-DECISIONS.md` §2 (currently marked
   "not measurable with current data — pending"), citing the coder count,
   the alpha value, the floor, and the verdict. Close `construct-2jb.3` only
   after that's written down — the bead stays open until real coder sheets
   have actually been returned and measured; a kit that could theoretically
   run is not the same as a study that ran.

## What's here

| file | purpose |
|---|---|
| `generate-sheets.mjs` | builds blind per-coder sheets from the non-circular corpora |
| `compute-alpha.mjs` | reads `returned/*.json`, computes alpha + the floor, prints the verdict |
| `CODER-INSTRUCTIONS.md` | given to each labeler |
| `sheets/` | generated sheets to send out (gitignored — regenerate, don't hand-edit) |
| `returned/` | drop completed coder sheets here (gitignored except this README's placeholder) |

The alpha math itself lives in `src/kernel/metrics/krippendorff.ts`, tested
in `tests/kernel/metrics/krippendorff.test.ts` against two published worked
examples (cited in the test file) — not against numbers this project made up.
