# decision-framing — recorded run 2 (2026-08-20, Sonnet tier)

Run conditions, stated so the record is checkable: this run exists to answer
a specific portability question — does the skill hold its floor on a
Sonnet-class model, one capability tier below the model that authored it?
The producing agent ran on Sonnet, was given a copy of `SKILL.md` outside
the repository as its only method reference, explicit instruction not to
read this repository, and no web access — the requester's paragraph was its
only source. The task was real: whether `skills/` should ship inside the
npm package or stay git-only, a live packaging question this repository had
open. The deliverable below is verbatim as produced; nothing was edited.

The one-line verdict for the use ledger: the pre-mortem gate materially
weakened the bare recommendation and forced a named control into it (a
one-line installer pointer in the npm README / CLI hint), and the do-nothing
baseline won on the merits — both gate-shaped events the falsification test
counts. The deliverable also held the marker discipline on a claim the
requester did not supply (npm publish immutability, marked as inference /
[unverified]), which is the templates-over-judgment floor behaving as
designed on the lower tier.

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading of this
run). The recommendation's verdict is `proposed`: the decider had not seen
it when the record was produced.

---

Decision record and framing — skills/ directory: npm package or git-only

## 1. Scope check

A real choice exists between distribution channels, it will be built into the package's public contract, and reversing a wrong call has real cost (published npm versions are immutable once out; consumer expectations form around whatever ships). The method applies; not standing down.

## 2. Frame

**The decision, as a choice:** Should the `skills/` directory ship inside the npm package (delivered by `npm install` alongside the CLI/kernel), or stay distributed only through the git-based channels (copy-paste and the `npx skills add <owner>/<repo>` installer)?

**Decider:** Gerald (stated explicitly: "I decide; nobody else needs consulting"). Consulted: no one — no external or team input sought or required. [cite: requester]

**Reversibility class: costly to reverse.** Not one-way — a files-field entry can be added or removed in a later release — but not free either: once a version ships with `skills/` bundled, npm publishes are immutable (you cannot unpublish or edit a published tarball; you can only publish a new version). Consumers who came to depend on npm-delivered skills (build scripts, doc links, other tooling reading `node_modules/<pkg>/skills/`) would break on the next release that drops the directory. Reversing costs a deprecation cycle, not a config flip. [inference from stated facts, npm's publish-immutability behavior — standard, unverified against this specific package's registry settings — `[unverified]`]

**Do-nothing baseline:** `skills/` stays git-only. The two existing channels — copy-paste (the proven floor) and the git-as-registry installer, verified working against this repo — continue unchanged. [cite: requester] Nothing breaks, nothing is gained. Skills keep iterating at their own pace; npm releases stay untouched by skill edits. The cost of do-nothing is purely opportunity cost: npm-only consumers who never leave the CLI workflow may never discover the skills exist, unless something else (docs, CLI output) points them there.

**Constraints (falsifiable, disqualifying):**
- None of the requester's stated facts function as a hard constraint in the classic sense (nothing here is described as a hard requirement with a pass/fail line — e.g., no stated deadline, no stated platform limitation). This decision is governed by preferences, not constraints. Noted explicitly so the two lists aren't blurred.

**Preferences (weights, not walls) — as stated by the requester:** [cite: requester]
- Do not couple the skills' iteration cadence to npm release discipline.
- Do not confuse the npm package's contract (what `npm install` is understood to deliver).
- Do not stand up a third distribution channel nobody asked for.

These three preferences are strongly held but are still weights: an option that trades against one of them isn't automatically disqualified, it has to earn the trade.

## 3. Options, honestly generated

**Stay git-only (do-nothing baseline)** — Keep exactly the current setup: copy-paste of the single SKILL.md file as the proven floor, and the git-as-registry installer (`npx skills add <owner>/<repo>`) as the maintained path, which already versions skills by git ref. [cite: requester] The npm package continues to ship only bin, dist, and schemas, unchanged. Skills release the moment a file is edited and merged; npm releases stay a separate, deliberate cadence with no coupling at all.

**Ship `skills/` inside the npm package** — Add a `files` entry so `skills/` is included in the published tarball; every `npm install` of the CLI/kernel now also delivers the skills docs on disk, discoverable via `node_modules/<pkg>/skills/` or a CLI subcommand that points at them. Consumers who only ever touch npm — which, per the requester, is most of the CLI/kernel audience minus the broader skills audience — get the skills without needing to know the git installer exists. [cite: requester]

**Hybrid: package ships a version-pinned snapshot, git remains canonical** — The npm package bundles whatever `skills/` looked like as of that release (frozen at publish time), documented as "snapshot, may be stale — see the git installer for latest." Git-as-registry stays the live, fast-iterating source of truth; npm carries a lagging mirror for discoverability. Real option, developed to the same depth as the others, but it is the option the framer does not favor: it namesakes itself as a compromise while actually creating the third channel the requester explicitly wants to avoid (npm-snapshot, copy-paste, git-installer — three, not two), and it inherits the coupling problem it was meant to dodge, because the snapshot's currency becomes an implicit npm-release concern the moment anyone notices it's stale.

**Disqualified for completeness — publish skills as a separate npm package (`@construct/skills` or similar):** removed not by a hard constraint but by the requester's own stated preference against a third channel — a separate package is, functionally, a third distribution surface with its own release cadence to maintain, which is precisely what was ruled out. Listed so a later reader doesn't wonder whether it was considered.

## 4. Trade-off discipline

| Criterion | Stay git-only | Ship in npm package | Hybrid snapshot |
|---|---|---|---|
| Cadence coupling | None — skill edits ship the moment they merge to git, independent of npm's release rhythm. [cite: requester constraint on cadence] | Every skill edit becomes, implicitly, part of "what ships in the next npm release" — either it waits for a release to reach npm consumers, or it forces more frequent releases. Directly trades against the requester's first stated preference. | Same coupling problem as "ship in npm," deferred rather than avoided: the snapshot goes stale the moment a skill changes, and someone has to decide when a re-sync is worth a release. |
| Package contract clarity | Unchanged — `npm install` continues to mean "you get bin, dist, schemas." No new expectation created. | New expectation created: "npm install also gives you method docs." Requires a files-field entry and, implicitly, documentation of what's included and why. `[inference]` | Worse than either pole: the contract now says "you get skills, but maybe not the current ones" — a harder thing to document honestly than either "yes" or "no." |
| Channel count | Two channels, as today: copy-paste, git installer. [cite: requester] | Three channels in practice: copy-paste, git installer, npm bundle — even though the requester frames it as "skills inside the existing package," it is a third *distribution surface* with its own drift risk (bundled copy vs. git HEAD). | Three channels, same count as above, with the added failure mode of visible staleness. |
| Reach / discoverability | Skills discoverable only to people who find the repo or already use the git installer; npm-only CLI users may never see them. | Every CLI/kernel npm consumer gets skills for free, no extra step — directly serves the CLI-installer subset of the audience. Does not help the broader, non-npm-installing audience the requester names as the actual target market for skills. [cite: requester] | Partial version of the same benefit, undermined by staleness once it sets in. |
| Effort / maintenance cost | Zero — no change. | Small one-time cost (files-field entry) `[cite: requester]`, plus an ongoing, less visible cost: every future skill PR now has an implicit "does this need a release" question attached to it that didn't exist before. | Higher than either: needs a defined re-sync policy (on every release? on every skill merge? manual?) that doesn't currently exist and isn't free to invent. |
| Reversibility | N/A — it's the baseline. | Costly to reverse per §2: dropping it later after consumers depend on it means a deprecation cycle, not a silent removal. | Same cost to reverse as "ship in npm," plus the added complication of explaining why a previously-bundled feature is going away. |

No load-bearing numeric threshold is used anywhere in this table — every row is a stated mechanism, not an invented cutoff.

## 5. Recommendation

**Recommendation: stay git-only — do not add `skills/` to the npm package's files field; keep copy-paste and the git-as-registry installer as the two channels.**

This is the do-nothing option, and it wins here because it is the only option that satisfies all three of the requester's stated preferences simultaneously rather than trading one against another: it doesn't couple cadence, it doesn't touch the package's contract, and it doesn't add a channel. Both alternatives buy discoverability for the npm-installing subset of users at the direct cost of at least one, usually two, of those stated preferences — and the requester's own framing ("skills' audience is broader... most will never npm-install") suggests that subset is not where skills adoption is supposed to come from anyway. [cite: requester]

### Strongest objection, stated in its own terms

*"You're optimizing for a purity concern (cadence, contract cleanliness) at the direct expense of the audience you already have in hand. Every person who runs `npm install` on your CLI is a warm lead for the skills — they've already decided to trust your tooling — and right now they get nothing unless they separately learn that a git installer exists and go run it. The 'files-field entry' cost you're worried about is one line; it is not the coupling risk you're describing. You can bump the package's patch version whenever a skill changes without that implying anything about the CLI/kernel's own compatibility — semver on this package doesn't have to mean 'skills changed' the way it means 'API changed,' because skills aren't part of the code surface. You're treating a documentation-adjacent asset as if it carries the same release discipline as the kernel, and that's a stricter rule than the situation needs. Meanwhile the git installer, however well it works, is an extra step that a meaningful fraction of your actual npm-installing users will simply never take — not because they don't want the skills, but because they never learn the second command exists."*

This objection is real and not fully answered by the recommendation as stated — see the pre-mortem below, which weakens the pure "do nothing" recommendation into "do nothing, plus one cheap control."

### What would change the answer

- A measured signal that npm-installing users are asking for skills and not finding them (support questions, issue-tracker requests, or usage data showing the git installer is invoked far less often than the npm package itself is installed) would favor revisiting toward "ship in npm" or at minimum a stronger in-package pointer.
- If the skills' edit cadence slows to roughly npm-release frequency on its own (i.e., the coupling cost the recommendation is protecting against turns out to be near-zero in practice), the main argument against bundling weakens and the decision should be reopened with that evidence in hand.

## 6. Pre-mortem

**Failure story:** Six months out, adoption data (or its absence) shows the skills are barely used by anyone who came in through `npm install`. Nobody complained loudly — they just never left the CLI workflow, never ran the second command, and quietly did without. Eventually this gets noticed, and the fix that happens is exactly "ship skills in the npm package" — but now done reactively, under time pressure, without the deliberate contract language this decision record would have written up front, producing a messier version of Option B than a calm decision would have.

**Early signal:** Low or zero observed usage of the git-as-registry installer relative to npm install counts, or direct requests ("where are the skills?") arriving through support/issue channels from people who only ever touched the npm package.

**Cheap mitigation available now:** Add a one-line pointer — in the npm package's README and/or a `construct doctor`/CLI startup hint — naming the git installer command and where skills live. This costs nothing structurally (no files-field change, no coupling, no new channel) and directly answers the strongest objection's discoverability complaint without paying any of Option B's costs.

**This did materially weaken the recommendation.** The pure "stay git-only, do nothing else" version is not what should be proposed. Revising §5's verdict accordingly: recommend staying git-only *with* the documentation-pointer control, not as a bare do-nothing.

## 7. Decision record

```
Decision record
- Decision:          Should skills/ ship inside the npm package (via a files-field
                      entry, delivered by npm install), or stay distributed only
                      through the git channels (copy-paste + npx skills add
                      installer)?
- Decider:           Gerald | Consulted: none (stated: "I decide; nobody else
                      needs consulting")
- Reversibility:     costly to reverse — npm publishes are immutable once out;
                      dropping a previously-bundled directory after consumers
                      depend on it requires a deprecation cycle, not a silent
                      removal [inference, npm publish-immutability behavior
                      unverified against this project's registry settings]
- Do-nothing:        skills/ stays git-only; copy-paste and the git-as-registry
                      installer continue unchanged; npm package ships only bin,
                      dist, schemas as today
- Options considered:
    Stay git-only (do-nothing) — no package change, two channels as today — recommended (with one control, see below)
    Ship skills/ in the npm package — files-field entry, bundled at every npm install — viable, trades against all three stated preferences
    Hybrid version-pinned snapshot — npm carries a lagging mirror, git stays canonical — viable but weakest: recreates the third-channel problem it was meant to avoid, plus a staleness failure mode
    Separate skills npm package (e.g. @construct/skills) — disqualified by preference: is itself the third channel the requester explicitly ruled out
- Recommendation:    Stay git-only; do not add skills/ to the npm package's files
                      field. Add one cheap control: a one-line pointer in the
                      npm package's README (and/or CLI startup hint) naming the
                      git-as-registry installer command and where skills live,
                      so npm-only consumers can find them without the package
                      itself bundling them.
- Verdict:           proposed — Gerald has not yet confirmed; this record states
                      the recommendation for his decision, not an accepted outcome
- Consequences accepted: npm-only CLI/kernel consumers who never run the
                      installer and never read the pointer will not discover
                      the skills through the package itself; that reach gap is
                      accepted in exchange for zero cadence coupling, an
                      unchanged package contract, and no third channel
- Strongest objection: bundling costs one files-field line and correctly-scoped
                      semver need not imply cadence coupling at all — the
                      recommendation may be over-weighting a coupling risk that
                      is cheaper to manage than assumed (full text in §5)
- Revisit when:      support/issue signals show npm-only users asking for
                      skills and not finding them, or usage data shows the git
                      installer is invoked far less than the npm package is
                      installed; or the skills' edit cadence naturally slows
                      to near npm-release frequency, undercutting the coupling
                      concern this recommendation leans on
```

## 8. Closing gates

1. Framed as a choice — §2, one-sentence decision, decider, reversibility class with reasoning, do-nothing baseline all present.
2. Constraints separated — §2: no hard constraints found in the requester's material (stated explicitly), three preferences listed and labeled as weights, not walls.
3. Rivals real — §3: three developed options plus the do-nothing baseline; the hybrid option is the one the framer does not favor and is argued as a real candidate before being weighed against; one option (separate package) listed as disqualified with its reason.
4. Consequences concrete — §4: table with six checkable criteria; every requester-sourced claim marked `[cite: requester]`; every inference beyond the requester's paragraph marked `[inference]` or `[unverified]`; no invented numeric thresholds anywhere.
5. One recommendation — §5: single recommendation stated first, addressed to Gerald, verdict field uses one of the four allowed values (`proposed`).
6. Strongest objection — §5, own heading, stated in the advocate's own terms, not paraphrased into weakness.
7. Pre-mortem — §6: specific failure story, its early signal, and an explicit statement that it weakened the recommendation (it did — see §6 and the revised §5/§7).
8. Record complete — §7: every line filled; none marked `not established`.

## 9. Verification record

```
Verification record
- Framed as a choice:   answered — see §2
- Constraints separated: answered — see §2 (no hard constraints found; three
                         preferences listed and labeled as such)
- Rivals real:          answered — see §3
- Consequences concrete: answered — see §4 (table); citations and inference
                         labels applied throughout §2–§4
- One recommendation:   answered — see §5
- Strongest objection:  answered — see §5, "Strongest objection" subheading
- Pre-mortem:           answered — see §6 | weakened the recommendation: yes
                         (added the README/CLI pointer control; recommendation
                         is no longer bare do-nothing)
- Record complete:      answered — see §7
```
