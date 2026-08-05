# Fixture organization harness

A fixture organization with planted ground truth, scoring grounded synthesis.
This harness gates rung acceptance for the grounded-organizational-reasoning
arc: a rung is not accepted on the strength of its unit tests alone, but on a
scored run over this corpus.

## What is in here

- `corpus/` — what the system under test is given, and nothing else:
  - `strategy.md` — the org's strategy document
  - `prd-progressive-sync-deletion.md` — a PRD
  - `rfc-001-sync-impersonation.md`, `rfc-002-manifest-hydrator.md` — two RFCs
  - `tickets/T-*.md` — 16 tracker tickets
  - `notes/note-1.md`, `notes/note-2.md` — two brain-dump notes (the
    team-notes-drop scenario stimulus)
- `answer-key.json` — the planted ground truth: three cross-references, one
  PRD-vs-strategy conflict, two risks inferable only by combining sources, and
  the notes-drop expectations (which tickets propagation proposals must hit,
  what the memory deltas must contain). Recorded before any run; never edited
  to fit one.
- `PROVENANCE.md` — where every base document came from and exactly what was
  edited in. The base corpus is real public material precisely so that the
  corpus and the system it measures do not share an author; only the plants
  are this project's edits, and each one is listed.
- `runs/` — scored run outputs land here, one JSON per run.
- `raw/` — the fetched originals, kept so every plant is auditable as a diff.

## Running and scoring

1. Hand `corpus/` to the system under test as its declared sources (tickets as
   the tracker, docs as the docs system, notes through the note-drop door).
2. Record the run's output in the shape documented at the top of
   `scripts/score-org-harness.mjs`, into `runs/<date>-<label>.json`.
3. Score it:

   ```bash
   node scripts/score-org-harness.mjs fixtures/org-harness/runs/<file>.json
   ```

Gates map to rungs: rung 0 is provenance validity (no fabricated citations,
no uncited claims), rung 1 is the planted cross-references, rung 2 is the
combined-source risks plus the uses-sources-rather-than-lists-them ratio,
rung 3 is the drift conflict and the notes-drop loop. The scorer exits
non-zero if any rung fails.

The answer key also carries `roleFindings`: per-role expected findings (PM,
TPM, analyst, compliance, legal, thin engineering) over the same corpus. The
scorer reports role coverage as advisory — it shows which role lenses saw and
which were blind, but never gates a rung. Those labels are recommendations
awaiting human acceptance.

A run produced by the same model family that authored the plants carries the
correlated-error caveat: an observed pass is an upper bound on what an
independent run would score. The caveat travels with any number quoted from
such a run.

Gerald reviews scored runs in place of an external tester, with the same
recorded honesty as prior phase closes: the score is the floor, the review is
the acceptance.
