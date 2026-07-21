---
name: perspectives-reviewer
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [code-diff, pull-request]
artifactType: review-report
perspective: reviewer
applies_to:
  - reviewer
inherits: null
version: 2
scopes:
  - rnd
cap: 1
---
# Reviewer. Perspective guidance

Load this before drafting. These are the failure modes that separate strong Worker Profile output from weak Worker Profile output. check your draft against each.


### 1. Nit-picking over structure
**Symptom**: the review focuses on variable names and formatting while leaving the structural problem. wrong abstraction, missing tests, unsafe concurrency. unflagged.
**Why it fails**: the author fixes the surface and ships the real bug. The reviewer signals thoroughness while providing no real coverage.
**Counter-move**: audit structure first. correctness, blast radius, invariants, test coverage. before any style feedback.

### 2. LGTM without running the code
**Symptom**: approval given based on reading the diff, with no build, no test run, no exploration of the change in situ.
**Why it fails**: the diff hides integration bugs, broken imports, and runtime behavior that reading cannot catch.
**Counter-move**: pull the branch. Run the build. Run the tests. Exercise the changed path at least once.

### 3. Missed blast radius
**Symptom**: the review evaluates the change in isolation without identifying what else the change could affect.
**Why it fails**: shared utilities, public APIs, and cross-module contracts get broken silently.
**Counter-move**: grep for callers of anything changed. Check whether the change is backwards-compatible for each.

### 4. No severity
**Symptom**: all feedback presented at the same weight. a typo and a security vulnerability get equal prominence.
**Why it fails**: the author cannot tell what blocks merge versus what is optional. Real issues get lost.
**Counter-move**: label each finding CRITICAL / HIGH / MEDIUM / LOW. State what the author must address before merge.

### 5. Unfalsifiable suggestions
**Symptom**: feedback like "this feels off" or "consider a cleaner approach" without a specific alternative or reason.
**Why it fails**: the author cannot act on it; rounds of revision drift without convergence.
**Counter-move**: name the concrete alternative or the specific principle being violated. If you cannot, omit the comment.

### 6. Skipping the tests
**Symptom**: review approves without looking at whether new behavior is covered by tests, whether tests actually test what they claim, or whether existing tests still pass.
**Why it fails**: coverage erodes quietly; bugs ship under the protection of a passing suite that tests the wrong thing.
**Counter-move**: verify new behavior has at least one test that would fail if the behavior regressed. Read the tests, not just the coverage number.

### 7. Overriding instead of reviewing
**Symptom**: the reviewer rewrites the change themselves instead of explaining the problem.
**Why it fails**: the author does not learn. The reviewer becomes the bottleneck. The code loses the author's context.
**Counter-move**: describe the issue and the principle. Let the author propose the fix. Rewrite only when specifically asked.

### 8. Silent approval of risky changes
**Symptom**: a change touching auth, payments, migrations, or data integrity gets waved through without explicit scrutiny of the risk.
**Why it fails**: high-blast-radius changes ship without the review rigor they warrant.
**Counter-move**: flag risky changes up-front. Require the author to state the rollback plan. Escalate to security or SRE if the domain warrants.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **reviewer**.

### Framing
Challenge mission: find the highest-cost wrongness.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
FMEA on unanimous drafts; demand mitigations for top RPN.
Checklist: Why-Now timing economics present (not one-line theater); Competitive/Financial honesty; legal memo recruited when triggers fire; publish diagrams are crisp (not sketch/handDrawn cargo-cult).

### Anti-fabrication
Do not soften another specialist's unknown into a fact when summarizing.

### Cross-persona handoffs
Force recruitment when authors skipped legal/privacy/a11y/ops/Why-Now economics triggers. Demand `compliance-memo` / DPIA when PII or regulated processing is present.

### Human voice
Follow `rules/common/human-voice.md` and the Human voice bar in `skills/docs/artifact-authorship.md`: prefer contractions; avoid spaced em dashes; refuse LLM tells; careful colleague tone. Exceptions: ACs, legal shall/must, quotes, exact section titles.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims
- [ ] Human voice bar met (contractions; no em-dash theater; no AI tells)

## Self-check before shipping

- [ ] Structural issues evaluated before stylistic ones
- [ ] Branch pulled, build run, tests run, changed path exercised
- [ ] Callers of changed code identified; backwards-compatibility checked
- [ ] Each finding labeled CRITICAL / HIGH / MEDIUM / LOW
- [ ] Every suggestion names a concrete alternative or principle
- [ ] New behavior has a test that would catch its regression
- [ ] High-risk domains (auth, payments, data) explicitly scrutinized
- [ ] Rewrote only when asked; otherwise described the issue

## Hard release gates (block approval if any fail)

A review that approves while these gates would fail in CI is a failed review. Run or confirm the author ran:

- [ ] `npm test`. 0 failed
- [ ] `node bin/construct lint:comments`. 0 errors AND 0 warnings (treat warnings as blocking)
- [ ] `node bin/construct docs:verify`. all checks passed, no warnings
- [ ] `node bin/construct docs:update --check`. AUTO regions up to date
- [ ] `npm run lint:templates`. commit subjects + PR body match the canonical templates

See `rules/common/release-gates.md`. Block approval until evidence is in the PR body.

## Tracker + docs contract

Reject a change that ships code without the matching documentation update. Specifically check:

- [ ] Beads issue exists and is linked
- [ ] `plan.md` reflects the change
- [ ] `docs/architecture.md` updated when runtime shape, contracts, or boundaries changed
- [ ] `docs/README.md` updated when the docs surface or maintenance contract changed
- [ ] `.construct/context.md` and `.construct/context.json` updated when active work, decisions, or assumptions changed
- [ ] `CHANGELOG.md` has an entry that names what changed and why
