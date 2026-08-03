# Construct Strategy

Rewritten from scratch 2026-08-03. This document replaces all prior strategy, ADRs, and RFCs, which were deleted the same day. Decisions from here forward live in two places only: this file (direction) and the beads tracker (work). There is no decision-record bureaucracy.

## North star

Point at an outcome and an invisible, learning staff fills in the roles you didn't know you needed. The user thinks about outcomes. They never think about legal, program management, or process, and they are never ambushed by a domain they didn't know existed.

## The end-state user experience

A user states an outcome, not a task: "I want to launch a paid beta to EU users next month."

1. **The system infers the invisible roles.** It decomposes the outcome and detects the domains it implicates (privacy law, commerce and tax, program sequencing, product scoping) without the user naming any of them.
2. **Work happens in the background; only decisions surface.** The user gets a short decision inbox containing only calls that are genuinely theirs to make. Everything else gets done and filed.
3. **Artifacts arrive finished and traceable.** Every load-bearing claim traces to a source the reader can re-verify. Nothing is invented.
4. **Invocation is invisible; accountability never is.** The user does not need to know to ask for legal, but they always see what was done in legal's name: a one-screen ledger of what was reviewed, what was flagged, and what needs a licensed human.
5. **The behavioral test of success:** across a full project, the user never types a role name and never manages a process.

The audience is non-technical operators, reached through an outcome-in/decisions-out surface. The builder dogfoods the loop on real projects in developer harnesses (OpenCode, Claude Code) while the surface is built.

## Architecture commitments

These are the load-bearing decisions. Each was made deliberately on 2026-08-03; changing one requires rewriting this section, not accreting an exception.

**1. Harness-independent by adapter, never by rebuild.** Execution rides whatever agent harness is present: OpenCode, Claude Code, Codex, or a direct API loop, behind one adapter interface (`execute(role, task, tools) → artifact`). MCP is the tool-independence layer. Construct never builds its own agent runtime, memory engine, or tool broker in competition with the platforms. Independence lives in the policy, knowledge, and contract layers, which are portable by construction.

**2. Trunk and rings: growth by densification, not accumulation.** Shared operational method (how to decompose, verify, escalate, finish artifacts) is the trunk. Learning accretes as rings: immutable, citation-carrying strata. A new ring supersedes older rings; it never rewrites or deletes them. Provenance always survives. Refinement means better compression with intact citations, not a smaller pile with amnesia.

**3. Personas are lenses with thick domain corpora.** A persona is a framing and risk posture over the shared trunk, plus a real domain corpus of its own. Placement rule: domain-agnostic method goes to the trunk; doctrine goes to the persona. Legal owns distilled law; PM owns distilled sequencing judgment; neither owns the method of working, which is shared. Boilerplate duplicated across persona prompts is trunk material that was mis-filed, and gets factored down.

**4. Every persona has a learning loop: research → distill → operationalize.** Legal researches primary legal sources and distills doctrine. PM distills program judgment from delivered outcomes. Distillations become rings only after passing the admission gate.

**5. Ring admission is risk-weighted.** Low-risk domain rings auto-admit after an adversarial verification pass (citations checked, consistency checked). High-risk domains (legal doctrine above all) require explicit human approval before a ring goes operational. A bad distillation that slips in is how a persona becomes confidently wrong forever; the gate exists to make that loud instead of silent.

**6. Prompts may evolve, through the same gate.** A ring may propose an amendment to a persona's operating prompt. Prompt amendments pass the same risk-weighted admission gate and must show non-regression on the eval suite before adoption. There is no ungated self-modification.

**7. Improvement is proven by evals, not vibes.** Past outcomes become fixed scenario evals. A candidate ring (corpus or prompt) re-runs the relevant suite and must not regress to be admitted. "The persona got better" is a measured claim or it is not made.

**8. The risk heat map is alive, and it governs three things.** Heat is inferred from outcome context (EU users, money movement, regulated data, deadline pressure), learned from history and incidents (past misses raise a domain's baseline), and overridable by the user (pin a domain hot or cold). Heat governs: which personas engage, how strict their gates run, and retention policy. Rare-but-critical knowledge in hot domains never auto-compacts; frequency-based forgetting is exactly wrong where the stakes concentrate in the tail.

**9. Learning is per-user, cross-workspace.** Rings follow the user across their projects. Doctrine learned once serves everywhere that user works. Nothing pools across users; there is no shared corpus and therefore no cross-user privacy or poisoning surface.

**10. Contracts declare; a router satisfies.** A contract specifies what a task needs: inputs, tool capabilities, verification postconditions. One router resolves those requirements against available tools (MCP connectors included) and personas. Contracts do not orchestrate themselves.

**11. Cross-domain conflicts surface as user decisions.** When legal says wait and PM says ship, the system frames the tradeoff with both sides cited and puts it in the decision inbox. No hidden precedence order, no heat-map auto-arbitration on judgment calls.

**12. Legal operates as issue-spot, draft, escalate.** It detects implications the user missed, drafts with annotated reasoning, and explicitly routes what needs a licensed human to a licensed human. Sourcing starts with free primary sources. Silent legal is a defect, not a feature.

**13. No-fabrication remains the trust kernel.** It was the strongest differentiated asset in the 2026-08-03 competitive audit and it is load-bearing for everything above: rings, ledgers, artifacts, evals.

## What carries over from v2

The kernel, extracted as libraries with no CLI or repo assumptions: outcome classification and routing, no-fabrication enforcement, contract postcondition validation, the artifact completion ladder, the multi-platform sync seam, and beads as the tracker. The existing memory and distillation machinery is the substrate the ring system is built on, not replaced by.

## What is killed

Named explicitly so it stays dead: team and enterprise deployment modes, workspace presets as a product surface, the parallel-platform ambition (own runtime, own registry-as-product), decorative persona metadata (capabilities arrays, participation rules, and watch conditions that nothing reads become enforced or deleted), and the ADR/RFC/PRD documentation system.

## Program shape

Phases gate on evidence, not calendar. The full work graph with acceptance criteria lives in beads.

- **Phase 0 — Kernel extraction.** Adapter contract (OpenCode and Claude Code first), kernel libraries, kill list executed, doc gates reshaped to the minimal doc set.
- **Phase 1 — Implication map.** Outcome → implicated domains with heat scores. Validated diagnostically: real outcome statements scored against expert judgment; miss rate is the metric.
- **Phase 2 — Spine and memory substrate.** Ring store (append-only, cited, per-user), admission gate, heat-driven retention, eval harness, background execution through adapters, decision inbox, escalation lane, accountability ledger.
- **Phase 3 — Role packs.** Trunk/lens refactor of existing profiles, then PM pack, then legal pack on the same spine with its approval-gated doctrine loop.
- **Phase 4 — Surface.** The outcome-in/decisions-out product for non-technical operators, tested by genuinely non-technical users before polish.
- **Phase 5 — Second-user gate.** No new roles, adapters, or platform investment until 3 to 5 external users have run a real outcome end to end.

## Named risks

1. **The implication map underdelivers.** Then the whole vision is a routing demo. Mitigation: it is Phase 1 and measured, not assumed.
2. **Solo bandwidth.** One builder, engine plus surface. Mitigation: spine built once, roles as content packs; strict phase gating.
3. **Legal liability.** Mitigation: escalate-by-design, approval-gated doctrine, the ledger, and unauthorized-practice boundaries treated as product constraints.
4. **Homebrew-runtime creep.** Independence pressure quietly turning into a second agent runtime. Mitigation: commitment 1 is a veto, and any work item that reimplements a harness capability gets challenged by name.
5. **Distillation poisoning and doctrine rot.** Mitigation: admission gates, staleness rechecks driven by the heat map, append-only rollback.
6. **Eval cost.** The regression suite is the expensive part of honest learning. Mitigation: scenarios accrete from real outcomes rather than being authored speculatively.

## Ground truth this rewrite stands on

Adversarial audit of 2026-08-03: solo-mode mechanism verified real (full test suite passing, clean install verified); orchestrated execution inert in the default install (plan-only without a provider key); adoption at 4 GitHub stars and ~782 npm downloads/week; every v2 module competing against a category leader at 100 to 1000 times its adoption; the platform-absorption kill risk named in the prior strategy already materialized. The prior strategy optimized a governance layer for developers. This one builds an outcome engine for people who should never have to learn what a governance layer is.
