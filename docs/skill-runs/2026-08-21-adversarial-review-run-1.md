# adversarial-review — recorded run 1 (2026-08-21, Sonnet tier)

Run conditions: naked-file test, first dogfood run, and cross-tier floor
test in one. Sonnet-tier producing agent, skill file outside the repository
as its only method reference, repository forbidden, no web. The artifact
under review was real and already accepted: the skills-distribution
decision record (stay git-only, README-pointer control), which the decider
had accepted and whose control was already implemented. The reviewer was an
independent instance sharing the framer's model family, disclosed per the
skill's self-review rule. The deliverable below is verbatim as produced;
nothing was edited.

The one-line verdict for the use ledger — and the first direct evidence on
hypothesis H1 (does a standalone challenge catch what embedded gates
miss): yes. The original decision run's own pre-mortem had already forced
the README pointer; this review found past it. Verdict: accepted with
controls, with two serious findings the embedded gates did not produce —
the README-only pointer is structurally invisible to automated and
sandboxed evaluators (the likeliest first-contact path for agent-host
operators), and the audience-composition premise the recommendation leans
on lives in chat context rather than in the record itself — plus the
observation that the accepted revisit trigger references usage data nobody
currently collects, making it dead text as written.

Disposition of the three controls the review requires (recorded here so
the review's consequences are traceable): (1) machine-discoverable
pointer — adopted, implemented as the installer command in the npm
package description; (2) the audience assumption pulled into the record —
adopted as a dated tracker note on the epic, since run records are
verbatim and never edited; (3) the revisit trigger rewritten to something
measurable — adopted as the same note: the trigger becomes a periodic
manual check of npm download counts against installer-run evidence, until
real instrumentation exists.

Producing model: Sonnet (same family as the framer of the artifact under
review; the correlated-error caveat travels with any same-family judged
reading — noted, and partially mitigated by the review's own disclosure
gate, which existed for exactly this).

---

Verdict: Accepted with controls

Steelman: This is a solo-developer distribution decision made under genuine constraint tension (npm semver cadence vs. git-native skill iteration speed), correctly identifies that the disqualified "separate package" option is definitionally the third channel the owner ruled out, names a concrete, checked control (the README pointer) rather than a hand-wave, and states a falsifiable revisit trigger set instead of leaving the decision unrevisited indefinitely.

1. Strongest failure mode [severity: serious]
Failure: An agent host operator evaluates the CLI by running `npm install <pkg>` in a sandboxed or network-restricted CI/agent environment (common for host conformance testing — the record itself references an `npm ci` pattern and pinned-host probing culture), inspects the installed package tree, finds no `skills/`, concludes the CLI ships no skills, and never runs `npx skills add` because the environment either can't reach git or the evaluator has no reason to try a second command for a capability the package appeared not to have. The README pointer is invisible in this path because nobody reads READMEs during automated evaluation — they read `package.json` and `node_modules`.
Evidence: The record's own "consequences accepted" line only covers "npm-only consumers who never run the installer and never read the pointer" as a discovery-cost issue, but frames it as a soft awareness gap. It does not distinguish a human who could still stumble onto the README from an automated/sandboxed evaluator for whom the README is structurally unreachable. That's a different, harder failure mode than the one the record priced in.
Smallest fix: Name the automated-evaluator case explicitly in "consequences accepted," and/or make the pointer machine-discoverable too (e.g., a `skills` key or comment in `package.json`, not just prose in `README.md`), since the record's control targets human readers only.

2. Best alternative not chosen — under-argued rejection [severity: minor]
The strongest form of "ship skills/ in the package" isn't "bundle at every install" (which the record correctly weighs against cadence coupling) — it's "bundle as an optional/peer install path" or "postinstall script that offers to fetch skills," which wouldn't force cadence coupling since it could pull from git at install time rather than freezing a snapshot. The record's options list conflates "in the files field" with "the only way to bundle," collapsing a spectrum into two poles (fully git-only vs. fully npm-frozen) and skipping the middle option that might resolve the actual named preference (no cadence coupling) without the discovery gap. This isn't fatal since the "hybrid version-pinned snapshot" option gestures at a hybrid, but it's evaluated only as a stale mirror, not as a live-fetch-on-install design.
Smallest fix: Add one line noting a live-fetch/postinstall variant was considered and why it's rejected (extra install-time network dependency, more moving parts than a solo maintainer wants) — currently it's simply absent, not argued against.

3. Load-bearing-claims audit
- "npm publishes are immutable once out" — the record itself flags this `[inference, unverified against this project's registry settings]`. Correctly disclosed as unsupported, not silently assumed. Fine as-is; this is the record doing its own audit correctly.
- "the git installer was verified working against the repo" — supplied in the requester's additional context, not in the record itself. The record's own text carries no verification claim for the installer's functioning; it should, since the entire recommendation rests on the installer being a viable substitute channel. This is a claim the decision depends on that lives outside the artifact under review.
- "most [users] will never npm-install the CLI" — supplied only in additional context, not stated or sourced in the record. The record's "Do-nothing" and "Recommendation" sections implicitly lean on this (why else would git-only be low-cost?) but the decision record itself never states or grounds it — it's audience-composition speculation with no usage data cited, and the record's own "revisit when" clause admits as much ("usage data shows...").
Unsupported and undisclosed within the artifact: the audience-composition premise. Disclosed-but-unverified within the artifact: publish immutability. Verified but external to the artifact: installer functioning.
Smallest fix: Pull the audience-composition premise into the record itself as a stated, flagged assumption (matching the immutability line's own inference-tagging pattern), since it's currently load-bearing but only visible to a reader with access to the chat context, not to a reader of the record alone.

4. Assumption inversion
- Invert "skill edit cadence stays faster than npm release frequency": if this becomes false (skills stabilize, releases become rare), the record's own revisit trigger catches it — this one is well-instrumented.
- Invert "npm-only consumers are rare/tolerable to lose": if false (most future adoption actually arrives via npm, e.g. because the CLI gets embedded in other npm-based agent tooling), the failure is silent — nothing in the CLI or the package signals a skills capability exists, and the revisit trigger ("support/issue signals") requires someone to first notice the gap and then file a report, which under-counts by construction (silent churn — people who shrug and move to a competing tool don't file issues). This is the same gap as finding 1, viewed from the assumption side rather than the failure-mode side.
- Invert "a one-line README pointer is sufficient discovery": if false, the record has no fallback control and no measurement of pointer effectiveness (no analytics on installer invocation rate is mentioned as currently collected — the revisit trigger references "usage data" as if it already exists, but nothing in the record establishes that invocation is actually being measured).
Smallest fix for the last: confirm (or add as an action item) that installer invocation is actually instrumented, since the revisit trigger is dead text if the metric it depends on isn't collected.

5. Who bears the cost
The cost of being wrong (discovery failure) lands on prospective users evaluating the tool for the first time — the exact population with the least context and the lowest tolerance for friction, and the population an early-stage solo project can least afford to lose silently. The decider (project owner) bears none of this cost directly and finds out only indirectly, via the lagging, self-admittedly noisy signal of "support/issue signals" or install-vs-invoke usage data — both of which require the lost user to have already stuck around long enough to be counted, which is precisely who's least likely to stick around after a discovery failure. This is a legitimate absent-party cost the record itself partially acknowledges ("consequences accepted") but under-weights relative to who's actually exposed.

6. Five-minute hostile expert
An npm-ecosystem-literate reviewer's first check: does `npm view <pkg> files` (or inspecting `package.json`'s `files` array) show anything hinting at skills, and is there a `postinstall` or `prepare` hint? The record's control lives entirely in README prose, which is the single weakest discovery surface in the npm ecosystem — READMEs are rendered on the npm registry page (so a browsing human might see it) but are invisible to anything programmatic, and registry README rendering itself is not guaranteed to survive markdown-to-HTML edge cases. A stronger, still-cheap control a hostile expert would ask for: a one-line `"description"` field mention or a documented `bin` subcommand output (e.g., `<cli> --help` printing the skills-install hint) — CLI stdout is a surface actually read by the audience (agent-host operators scripting against a CLI) in a way a registry README is not.

Findings summary: 0 fatal, 2 serious (findings 1, and the compounding assumption-inversion restatement of it in §4), 1 minor (finding 2), plus one audit gap (finding 3) that is serious in effect because it hides a load-bearing premise from the record's own reader.

Recommendation is directionally sound — git-only is very likely the right call for a solo maintainer's stated preferences — but the control as specified (README-only) is under-built for the actual risk, which is concentrated in automated/first-contact discovery paths a README cannot reach, not in casual human browsing.

Controls required to hold the accept:
1. Add a machine-discoverable pointer, not only human-readable prose — minimally, a comment or field in `package.json` (e.g., an unused-but-inspectable `"skills"` key, or a line in `"description"`) and/or the CLI's own `--help` output naming the installer command.
2. Pull the audience-composition assumption ("most users won't npm-install") into the record itself as a flagged, dated assumption, matching how the immutability claim is already flagged — currently it exists only in chat context outside the artifact.
3. Confirm (or add as a task) that installer-invocation usage data is actually being collected before relying on it as a revisit trigger; otherwise change the trigger to something currently measurable (e.g., a periodic manual check of npm download counts vs. GitHub clone/installer-run counts, if even that exists).

Verification record
- Steelman stated:    answered — see opening paragraph
- All six run:        answered — findings from: 1 (failure mode), 3 (claims audit), 4 (assumption inversion), 5 (cost-bearer), 6 (hostile expert); clean: 2 (alternative was considered, only under-argued — minor)
- Findings concrete:  answered — 3 findings: 0 fatal, 2 serious, 1 minor
- One verdict:        answered — accepted with controls
- Self-review:        answered — independent instance, same model family as the framer, no shared session state; disclosed per the requester's context and the skill's self-review rule
- No improvement drift: answered — breakage only; the three controls listed are the smallest fixes required to retire the serious findings, not general polish suggestions
