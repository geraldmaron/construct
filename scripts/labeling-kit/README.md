# Labeling kit (construct-2jb.3)

Establishes whether the project's 0.15 miss target is reachable at all, by
measuring how much two-to-three careful humans disagree with each other on
the same 30+ outcomes, independently. See `bd show construct-2jb.3` for the
full spec, and `RESEARCH-DECISIONS.md` §2 for why this question exists.

This kit builds sheets and computes statistics. **It does not, and must
never, produce labels itself** — see the warning at the top of
`compute-alpha.mjs` and `CODER-INSTRUCTIONS.md`. Every corpus this project
has is single-author; independent labelers are the fix, and a script that
fills in its own inputs recreates the exact circularity `construct-gsf`
identified.

## Protocol rewrite, 2026-08-04 — read this before the section below it

The requirement here was never *humanness*. Re-read what the study is for: no
classifier can be scored below the rate at which the ground truth contradicts
itself. The property being demanded is **independence from the catalog author**.
Humans were named because, when this kit was written, recruiting people was the
only known way to get errors uncorrelated with the catalog's.

**Stage 1 — model coders. Satisfiable without a human, and satisfied.** Two
coders from *different model families*, at least one of which had no hand in
authoring the catalog, labeled the same 34 outcomes blind. Result: Krippendorff's
α = 0.7627 (MASI), bootstrap 95% CI [0.6317, 0.8857]. Cross-family agreement is a
measurable proxy for independence with an honest ceiling.

The ceiling is permanent and travels with every Stage 1 number: both coders are
LLMs with overlapping pretraining, so **observed α is an upper bound on true
independent agreement and the derived floor is a lower bound.** Stage 1
establishes that the labeling task *has a stable answer*. It does **not**
establish the human annotation floor. Quoting it as one is a misquote.

**Stage 2 — human labels, and they do not come from this kit.** They come from
run-derived verdicts (`construct-2jb.13`, shipped): every real run is a labeling
event, where the user sees which domains surfaced, dismisses the wrong ones, and
is ambushed by the missed ones. Those labels beat a sheet coded in a room on
every axis that matters — multi-author instead of one person, drawn from the
deployed distribution instead of an author's imagination, carrying **negative**
labels (an explicit dismissal is not the same as an author never thinking of a
domain), and unspent per catalog version rather than burned on first use. Filed
as `construct-3ft`, blocked on real runs existing.

**So: do not block this study on finding a human to code a sheet.** Coding
`sheets/<name>.json` by hand is still worth doing — it raises *n* and adds a
genuinely independent column — but it is a nice-to-have, not a gate.

## Method change, 2026-08-04 (Gerald's direction, accepted with controls)

*Superseded in part by the protocol rewrite above: the "Gerald is the second
coder" step is no longer a gate. The isolation rules below still bind every
coder, model or human.*

The study runs **LLM-as-judge instead of recruited human labelers**. An
Fable/Opus-class coder labels one sheet in a fresh, isolated session —
`CODER-INSTRUCTIONS.md` applies to an LLM coder unchanged, including "do not
look at the project's source code" — and Gerald is the second coder, either
labeling independently or reviewing-and-amending. Alpha is computed between
the two sets exactly as originally designed.

**The limitation travels with every number this kit produces** (commitment
15): an LLM coder drawn from the family that authored the domain catalog has
errors correlated with it. Observed alpha is therefore an **upper** bound on
true independent agreement, and the derived error floor is a **lower** bound.
Any quote of these figures that drops this caveat is misreporting them.

This supersedes the recruit-2-3-humans step below; steps 2 and 4-6 are
unchanged.

## Steps for Gerald

1. ~~**Recruit 2-3 labelers.**~~ Superseded by the method change above. The
   coder set is one LLM coder in a fresh session plus Gerald. If Gerald is
   also the corpus author, that is a known limitation to note when reporting
   the result, not to absorb silently.

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
