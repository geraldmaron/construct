# Construct Strategy

Rewritten from scratch 2026-08-03 as a ground-up rebirth in a fresh repository (the predecessor, `construct-legacy`, is archived read-only). The code is a rewrite and not a continuation; the published identity is deliberately continuous. The npm package is `@geraldmaron/construct` — the predecessor's — and the version lineage continues past its `2.1.1` as `3.0.0-alpha.0`. The `construct` CLI command name is unchanged, as it always was.

Amended 2026-08-04 (construct-3fr), replacing the original decision to publish `@geraldmaron/construct-engine` starting at `0.0.0`. Three things decided it. A separate package bought a clean lineage that was mostly cosmetic — the predecessor's 48 published versions stay public either way, since `construct-legacy` is archived rather than deleted — while costing a second name to explain permanently. It also cost the release itself: the repository's npm token is scoped to `@geraldmaron/construct`, and npm answers `E404` when a token may not create a package, so the first alpha was blocked on minting a new credential for a name that existed only to keep the two apart. And `0.x` turned out to be the weaker way to say what it was saying. `npm publish` moves the `latest` tag to whatever is published unless told otherwise, so `0.0.0` on a package whose `latest` is `2.1.1` would have made a from-scratch rewrite the default install for everyone already there. A prerelease published under `--tag alpha` cannot move `latest` at all: the promise that nothing is stable until the Phase 5 second-user gate passes is now enforced by the registry rather than implied by a number. `latest` stays on the predecessor until that gate passes and `3.0.0` is promoted deliberately.

What this does not do is erase anything. The predecessor's published versions cannot be unpublished — npm allows it within 72 hours, and afterwards only for a package with no dependents, under 300 weekly downloads, and a single maintainer, none of which hold here — so they remain visible and will be deprecated with a pointer to the rewrite rather than removed. Decisions from here forward live in two places only: this file (direction) and the tracker (work). There is no decision-record bureaucracy. Changing a numbered commitment below requires editing that section — the diff is the drift record; it does not accrete as an exception elsewhere.

## North star

Point at an outcome and an invisible, learning staff fills in the roles you didn't know you needed. The user thinks about outcomes. They never think about legal, program management, or process, and they are never ambushed by a domain they didn't know existed.

## The end-state user experience

A user states an outcome, not a task: "I want to launch a paid beta to EU users next month."

1. **The system infers the invisible roles.** It decomposes the outcome and detects the domains it implicates (privacy law, commerce and tax, program sequencing, product scoping) without the user naming any of them.
2. **Work happens in the background; only decisions surface.** The user gets a short decision inbox containing only calls that are genuinely theirs to make. Everything else gets done and filed.
3. **Deliverables arrive finished and traceable.** Every load-bearing claim traces to a source the reader can re-verify, or is explicitly marked `[unverified]`. Nothing is invented.
4. **Invocation is invisible; accountability never is.** The user does not need to know to ask for a role, but they always see what was done in its name: a work log of what was reviewed, what was flagged, and what needs a licensed human.
5. **The behavioral test of success:** across a full project, the user never types a role name and never manages a process.

The audience is non-technical operators, reached through an outcome-in/decisions-out surface. The builder dogfoods the loop on real outcomes (including non-software ones — see Program shape) while the surface is built.

## Architecture commitments

**1. Host-independent by adapter, never by rebuild.** Execution rides whatever agent host is present: OpenCode (first-class), Claude Agent SDK, Claude Code, or a direct API loop, behind one adapter interface (`execute(role, task, tools) → deliverable`). MCP is the tool-independence layer. Construct never builds its own agent runtime, memory engine, or tool broker in competition with the platforms.

**2. Playbook and lessons: growth by densification, not accumulation.** Shared operational method (how to decompose, verify, escalate, finish deliverables) is the playbook. Learning accretes as lessons: immutable, citation-carrying strata. A new lesson supersedes older lessons; it never rewrites or deletes them. Provenance always survives.

**3. Roles are lenses with thick domain corpora.** A role is a framing and risk posture over the shared playbook, plus a real domain corpus of its own. Placement rule: domain-agnostic method goes to the playbook; doctrine goes to the role. Boilerplate duplicated across role prompts is playbook material that was mis-filed.

**4. Every role has a learning loop: research → distill → operationalize.** Distillations become lessons only after passing the admission gate.

**5. Lesson admission is risk-weighted.** Low-risk domain lessons auto-admit after an adversarial verification pass. High-risk domains (legal doctrine above all) require explicit human approval before a lesson goes operational.

**6. Lessons default to workspace scope; cross-workspace promotion is explicit.** *(Amended from the original per-user cross-workspace default, 2026-08-03, after adversarial review found the original design made client A's confidential facts part of client B's prompts as the happy path, not an edge case.)* A lesson belongs to the workspace it was produced in. Promoting a lesson to serve the user across all their workspaces is a user decision per lesson, permitted only for technique/process lessons — source quotes and facts are stripped before promotion. A workspace carries a consent tier: whether it may consume globally-promoted lessons at all (client and confidential work default to no). A lesson whose citation originates from an ingested external document can never auto-admit, regardless of risk tier — it always lands in human review, because verification by another LLM reading the same attacker-authored text cannot be trusted to catch injected instructions.

**7. Prompts may evolve, through the same gate.** A lesson may propose an amendment to a role's operating prompt. Amendments pass the same risk-weighted admission gate and must show non-regression on the eval suite before adoption. There is no ungated self-modification.

**8. Improvement is proven by evals, not vibes.** Past outcomes become fixed scenario evals. A candidate lesson (corpus or prompt) re-runs the relevant suite and must not regress to be admitted. Below the data-volume threshold where a suite is statistically meaningful (see Program shape, Phase 3), prompt changes are eyeball-reviewed and labeled as such — an ungrounded eval gate is worse than an honest manual one.

**9. The risk heat map is alive, and it governs three things.** Heat is inferred from outcome context, learned from history and incidents, and overridable by the user. Heat governs: which roles engage, how strict their gates run, and retention policy. Rare-but-critical knowledge in hot domains never auto-compacts.

**10. Briefs declare; a dispatcher satisfies.** A brief specifies what a task needs: inputs, tool capabilities, verification postconditions. One dispatcher resolves those requirements against available tools (MCP connectors included) and roles. Briefs do not orchestrate themselves.

**11. Cross-domain conflicts surface as user decisions.** When one role says wait and another says ship, the system frames the tradeoff with both sides cited and puts it in the decision inbox. No hidden precedence order, no heat-map auto-arbitration on judgment calls.

**12. Legal operates as issue-spot, draft, escalate — named "issue-spotter," never "analyst" or "lawyer."** It detects implications the user missed, drafts with annotated reasoning labeled template-for-review on the deliverable itself, and routes what needs a licensed human to a licensed human via a concrete jurisdiction-aware referral package, not a disclaimer. It declares covered jurisdictions and refuses or flags outside them. It stays dogfood-only until a licensed attorney has reviewed its seed corpus and boundary behaviors — self-sufficiency is earned by evidence, not asserted at ship time. Silent legal is a defect, not a feature.

**13. Adversarial challenge is a contract, not a courtesy.** Every brief may name challenges it must satisfy before a deliverable promotes past `draft`: a documented strongest objection on load-bearing decisions, a pre-mortem on plans, a citation or `[unverified]` tag on every claim, a legal issue-spot pass on heat-flagged deliverables, a scope diff against the brief. Deterministic structural checks run always and free; a second-role substantive pass runs only where the brief's heat warrants it. Waivers are the user's alone, per deliverable, per challenge, and are logged — never a global off-switch.

**14. Completion state is kernel-owned, never a tool a role can call on itself.** `draft → challenged → final` is a dispatcher-owned transition triggered by recorded verdicts. A role holds a capability token scoped to its own run and task; it can submit drafts and append to the work log, and nothing else. This exists because an ungated write surface lets a role under completion pressure mark its own challenge passed — verified as a live failure mode in the predecessor.

**15. No-fabrication remains the trust kernel.** It was the strongest differentiated asset in the 2026-08-03 competitive audit and it is load-bearing for everything above: lessons, work logs, deliverables, evals.

**16. Construct is the first organization Construct monitors.** The system maintains a generated, never-hand-edited self-model (what subsystems and packs exist, what actually runs, per the work log). Every tracker item cites the commitment or phase-exit it serves; work without lineage is a decision — amend this document or drop the work — not silent scope creep. This is the direct countermeasure to the predecessor's drift through five unstated strategic pivots.

## What carries over from the predecessor

Harvested as libraries with their tests, ported behind an explicit sterile test discipline, with no CLI or repo assumptions: outcome classification and routing, no-fabrication enforcement, brief postcondition validation, the deliverable completion ladder, the multi-host sync seam, the extraction ladder (Docling as a probe-gated rung, never required), and the tracker model — on a new SQLite-backed substrate rather than the predecessor's dolt-locked one. The design-language and deliverable templates carry over; the marketing-voice regex policing does not.

## What is killed

Named explicitly so it stays dead: team and enterprise deployment modes, workspace presets as a product surface, the parallel-platform ambition (own runtime, own registry-as-product), decorative role metadata, the ADR/RFC/PRD documentation system, and any daemon that runs when nothing asked it to — designed state is nothing running.

## Program shape

Phases gate on evidence, not calendar. The full work graph with acceptance criteria lives in the tracker, each item citing the commitment or phase it serves (commitment 16).

- **Phase 0 — Bootstrap and guardrails.** Sterile test contract, packaged-install smoke, parity lints (no absolute paths, glossary), a minimal fail-open hook set, the tracker initialized.
- **Phase 1 — Kernel harvest and predecessor cleanup.** The only backward obligation: a `cleanup` command that removes every trace the predecessor left, verified against a fixture home built from a real predecessor install. Ships in the first `0.x` alpha.
- **Phase 2 — Spine.** Outcome → implication map → dispatch → host adapter → deliverable, work log, decision inbox. A bounded run coordinator (not an agent pool — that is enterprise cosplay at this scale) makes concurrent role execution crash-safe and cost-bounded. Dogfooded by building this rebirth itself, with an explicit quota: of the first ten outcomes run through the spine, at least four are non-engineering and at least two are legal- or compliance-flavored, so the implication map is not tuned solely to the one distribution its author needs least. One external person runs one real outcome at the end of this phase and every phase after.
- **Phase 3 — Lessons and challenges.** The lesson store, admission gate, and challenge contracts ship with only the machinery today's data volume can support — retention automation, learned heat baselines, and eval-gated prompt evolution are each deferred behind a written data-volume trigger, not built speculatively.
- **Phase 4 — Pack breadth and the model matrix.** All role packs (program manager, technical program manager, analyst, compliance, legal issue-spotter, a thin engineering set) reach real depth. The model matrix is deliberately staggered rather than fully tuned on day one: two families (Claude and one open-weight family) are tuned and eval-gated; every other family runs but is labeled best-effort until pulled into tuning by real use, with degradation notes recorded in the work log every time.
- **Phase 5 — Surface and second-user gate.** No new roles, hosts, or platform investment until three to five external users have each run a real outcome end to end without typing a role name.

## Named risks

1. **The implication map underdelivers.** Then the whole vision is a routing demo. Mitigation: it is Phase 2 and measured — a labeled outcome set with a pre-agreed miss-rate target, not assumed.
2. **Solo bandwidth against the schedule this program actually requires.** All packs at real depth before first release is the long pole; it is accepted with eyes open because it is what the outcome promises, offset by staggering the model matrix and gating legal/compliance packs to dogfood-only until attorney review, so the heaviest external-facing risk lands after the heaviest external-facing evidence.
3. **Legal and regulatory exposure.** Mitigation: issue-spotter naming, template-for-review labeling on every artifact, jurisdiction declarations with refusal outside them, attorney review before any external release, and a real referral package as the escalation artifact — not a disclaimer.
4. **Homebrew-runtime creep.** Independence pressure quietly turning into a second agent runtime. Mitigation: commitment 1 is a veto, and any work item that reimplements a host capability gets challenged by name.
5. **Lesson poisoning and doctrine rot.** Mitigation: workspace scoping by default, a provenance ceiling that routes any corpus-derived lesson to human review regardless of risk tier, admission gates, and append-only rollback.
6. **Eval and matrix cost outrunning a solo maintainer.** Mitigation: tiered evals (deterministic on every change, LLM-judged only at release gates), a hard budget cap enforced in CI, and a staggered rather than fully-tuned model matrix.
7. **The system drifting the way its predecessor did.** Mitigation: commitment 16 — a generated self-model, commitment-lineage checks on all new work, and a standing self-outcome that keeps this rebirth honest against this document.

## Ground truth this rewrite stands on

Adversarial review of 2026-08-03 (two independent technical and feasibility passes) found and closed three critical defects in the original design before any code shipped: an MCP write surface a role could use to certify its own work, a lesson-admission path vulnerable to prompt injection from ingested documents, and a cross-workspace lesson default that was a confidentiality breach by construction. All three are reflected as amendments above, not as known issues carried forward. The predecessor reached 4 GitHub stars and roughly 782 npm downloads a week while roughly sixty percent of its pull requests were self-inflicted maintenance; this rewrite's discipline exists because that number is the strongest available evidence for what to change.
