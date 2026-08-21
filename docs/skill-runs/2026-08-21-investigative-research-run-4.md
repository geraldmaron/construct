# investigative-research — recorded run 4 (2026-08-21, Sonnet tier)

Run conditions: Sonnet-tier producing agent, skill file outside the
repository as its only method reference, repository forbidden, web access
on. The task was real and immediately consumed: the evidence base for the
agentic-platform strategy document (docs/agentic-platform-strategy.md),
which cites this run's findings by number. The deliverable below is
verbatim as produced; nothing was edited.

The one-line verdict for the use ledger: the source-classing discipline
did the strategy's load-bearing work — Cursor's aggregator-quoted ARR
trajectory was refused while the acquisition record was accepted, a
too-precise adoption statistic was rejected as content-farm-shaped while
the directional claim it decorated was kept on convergent evidence, and
the disconfirmation pass kept the incumbent-bundling scenario alive as the
strategy's standing strongest objection instead of letting the
white-space narrative pass unopposed. The run also correctly refused to
promote "nobody names this category" to "confirmed white space" — the
distinction the strategy's hedge design rests on.

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading).

---

# Agentic AI Platform Landscape — Strategy Inputs (Draft)

*Scope frame: public record as reachable via web search/fetch, August 20–21, 2026. Covers the six named platforms, MCP/Agent Skills standardization, vendor roadmap statements, and governance/provenance tooling. Excludes non-English-language coverage, paywalled analyst reports (Gartner/Forrester full reports), and anything requiring an account. Financial figures are run-rate/point-in-time, not audited.*

## 1. The platform layer

**Adoption signals, by platform:**

- **Claude Code** (Anthropic): exceeded $2.5B annualized revenue run rate by Feb 2026, reported by Reuters; reached ~$8B ARR by May 2026, cited as commanding ~54% AI-coding market share [research: Reuters coding-revenue reporting via CNBC/Axios secondary coverage, retrieved 2026-08-21 — I read the aggregating search summaries, not the original Reuters wire text, so this is one step removed from the primary filing]. Anthropic's own overall run rate hit $65B in July 2026 per Bloomberg, corroborated by a Reuters source and reported directly by CNBC and Axios [research: cnbc.com/2026/08/17 "Anthropic says annualized revenue climbed to $65 billion in July," axios.com/2026/08/17 — both read]. GitHub stars for `anthropics/claude-code`: **142,167** [record: GitHub REST API, queried live 2026-08-21 — this-instant count, not a historical mark].
- **OpenAI Codex CLI**: OpenAI states over 4 million weekly active developers and Codex-turn volume "distributed across multiple, parallel agents" by June 2026 [research: openai.com "How agents are transforming work," a vendor claim, not independently audited]. OpenAI was named a Leader in Gartner's 2026 enterprise coding-agent evaluation, per OpenAI's own post summarizing that placement [research: openai.com/index/gartner-2026-agentic-coding-leader — vendor's characterization of a third-party analyst report I did not read directly]. `openai/codex` GitHub stars: **108,267** [record: GitHub API, live].
- **Cursor / Anysphere**: SpaceX confirmed a $60B all-stock acquisition of Anysphere on June 16, 2026 — this is the strongest, most independently corroborated Cursor data point, reported directly by CNBC and Forbes [research: cnbc.com/2026/06/16, forbes.com/sites/sandycarter/2026/06/16 — both read]. ARR claims of $2B (Feb 2026) and $4B (May 2026) rest on compiled statistics blogs (getpanto.ai, aibusinessweekly.net, taskade.com) that read as SEO content farms rather than financial reporting — no primary Anysphere disclosure or wire-service figure was found for these ARR numbers specifically [unverified: the acquisition price is solid record; the interim ARR trajectory is not — a reader who needs it should check Anysphere's own investor materials or a wire-service business story, not the aggregator posts found here].
- **GitHub Copilot**: crossed 20M users with ~4.7M paid subscriptions per 2025 reporting; Agent Mode + MCP support reached General Availability in VS Code 1.102, July 14, 2025 [research: multiple aggregator sources converging on the same VS Code changelog date, not independently opened at github.blog directly this session]. Agentic code review shipped March 5, 2026.
- **OpenCode** (originally SST, repo now under `anomalyco/opencode` — an ownership/org change worth flagging on its own, not explained in what I read): **199,593** GitHub stars [record: GitHub API, live 2026-08-21, after following a 301 redirect from `sst/opencode`]. This exceeds Claude Code's star count and is frequently cited as the top open-source coding-agent project by mid-2026 rankings (LogRocket's power ranking) [research: aggregator coverage of that ranking, ranking itself not opened directly].

**Interface-layer standardization — this is the best-evidenced part of the record:**

- **MCP**: Anthropic donated MCP to a new Linux Foundation directed fund, the Agentic AI Foundation, announced December 9, 2025 [record: anthropic.com official announcement page, fetched and read directly this session]. Co-founders are Anthropic, Block, and OpenAI; supporting organizations are Google, Microsoft, AWS, Cloudflare, and Bloomberg — named in the same primary announcement. That page states MCP had "more than 10,000 active public MCP servers" and integration into ChatGPT, Cursor, Gemini, and Microsoft Copilot as of the donation date — a vendor's own figure, not third-party audited. A separate claim of "97 million monthly downloads by March 2026" comes from aggregator blogs only and was not corroborated in a primary source [unverified].
- **Agent Skills**: Anthropic published the format as an open standard with a reference SDK at agentskills.io [research: anthropic.com/news/skills, title and content confirmed via search, page itself not fully fetched this session — a residual gap]. Convergent aggregator reporting (itecsonline.com, agentman.ai, thenewstack.io, and the agentskills.io ecosystem pages themselves) states Microsoft (VS Code/GitHub), OpenAI (Codex CLI, ChatGPT), Google (Gemini CLI), JetBrains (Junie), AWS (Kiro), and Block (Goose) all ship SKILL.md-compatible readers, with 25–30+ listed platforms by March–May 2026. The specific "within 48 hours" adoption-speed claim appears only in one blog (paperclipped.de) and should be treated with skepticism — it is the kind of precise, dramatic number content farms fabricate; the directionally consistent claim (broad multi-vendor adoption by Q1 2026) is corroborated across enough independent-looking write-ups, including GitHub repos maintained by unrelated third parties (netresearch, VoltAgent, gmh5225) that list the same platform set, to accept as real, but the 48-hour figure specifically is [unverified].

## 2. Where value is moving

**What vendors say they're building next**, from their own statements: Anthropic's Managed Agents added persistent filesystem-style memory in public beta (announced April 23, 2026) plus, per aggregator write-ups of a May 7 follow-on announcement, self-restructuring memory ("Claude Dreaming") and multi-agent orchestration infrastructure aimed at production teams [research: mindstudio.ai coverage; I did not reach an Anthropic primary page for the May 7 items specifically, so class this tier below the memory-beta claim]. OpenAI's Codex messaging emphasizes enterprise controls — approval gates, RBAC, OS-level sandboxing, "auditable workspace governance" — with admin controls, memory governance, and audit logs described as "coming soon" rather than shipped [research: getmaxim.ai summary of OpenAI positioning; "coming soon" is the vendor's own hedge, worth preserving verbatim]. Cursor's public direction (background/async agents, an "Agents window") is oriented at parallel task execution rather than governance.

**What has commoditized**: cross-source convergence (Berkeley CMR, FourWeekMBA, Simon-Kucher, multiple VC blogs) is unusually consistent on one point: frontier model access and the basic agent loop (plan → tool-call → observe → repeat) are now table stakes, illustrated by near-identical benchmark scores across leading models and by Meta's reported acquisition of Manus — an agent-orchestration company with no model of its own — as evidence orchestration, not model IP, was the asset being bought [research: fourweekmba.com, cmr.berkeley.edu — both reflect the same industry narrative rather than independent data; treat as one converging view, not three]. This is consistent with — and does not contradict — the requester's own held finding that popular skill collections are engineering-config shaped [cite: requester].

**Where credible observers say defensibility now sits**, synthesized across the venture/strategy commentary read: (a) proprietary data generated through actual use, (b) becoming the workflow's official system of record (switching cost), and (c) — closest to the requester's kernel thesis — accumulated statefulness: "the longer an enterprise runs agent authorization through a governance platform, the more policy logic becomes embedded" [research: multiple VC-adjacent strategy blogs, convergent framing, no single primary source]. None of the sources read named "method-content skills" or "obligation/provenance kernels" as a category by name — that gap is either genuinely unclaimed ground or simply outside what commentary has articulated yet; the record cannot distinguish those two explanations, and it stays classified as unknown rather than promoted to "confirmed white space."

## 3. The governance/trust gap

This is the least platform-covered area found. No vendor among the six studied claims a shipped, general-purpose agent audit/provenance product as of this pass; OpenAI's own language is explicitly future tense ("coming soon"). Standards activity exists but is early and non-Anthropic/OpenAI/Cursor-centric:

- Singapore's IMDA published a Model AI Governance Framework for Agentic AI in January 2026, described as requiring verifiable agent digital identity and an audit trail of which agent acted under whose authorization [research: identitychallengecard.avatier.com summary of the IMDA framework — a secondary description, the framework text itself not opened].
- NIST launched an AI Agent Standards Initiative in February 2026 around agent identity/authorization/accountability gaps [research: same search cluster, secondary coverage, NIST's own page not opened directly — a residual gap worth closing before this claim is load-bearing in the final document].
- EU AI Act mandates automatic logging for high-risk systems — this is a real, existing legal record, though the search did not surface an agent-specific amendment beyond the general high-risk-system logging requirement already in force.
- A quantified survey claim — "only 24.4% of organizations report full visibility into agent-to-agent communications" — is attributed to a "Gravitee 2026 survey" only via a secondary blog (kla.digital); the survey itself was not located or read [unverified].

Net: the big platforms are silent-to-promissory on cross-host audit/provenance; the standards efforts that exist are government/consortium-led (Singapore, NIST) rather than platform-led, and none reach into skill-content provenance or deliverable-level obligation tracking specifically — that remains, on this record, unclaimed by anyone studied.

## Single-source list (§4 of method)

Claimed but resting on one aggregator lineage, not independently corroborated: Cursor's $2B/$4B ARR figures; MCP's "97M monthly downloads"; the "48-hour" Agent Skills adoption speed; the Gravitee 24.4% visibility statistic; OpenAI's 4M weekly-developer figure (vendor-stated, no third-party audit found). Strong (record-level or multi-outlet-corroborated): the SpaceX–Anysphere deal; the MCP donation and its founding members; the Claude Code $2.5B/$8B figures (Reuters-sourced per CNBC/Axios); all GitHub star counts (pulled live via API this session).

## Disconfirmation pass

**Hypothesis A** (the draft's lean): the platform layer is standardizing fast on MCP + Agent Skills while commoditizing at the model/loop level, leaving governance/provenance and method-depth as open, defensible ground.
**Hypothesis B** (rival): the "standardization" and "governance gap" narratives are themselves aggregator-amplified hype — real adoption is narrower than the 25–30-platform claims suggest, and the platforms are closer to shipping audit/governance features than the "coming soon" language implies, given OpenAI's own enterprise-controls list (RBAC, sandboxing, approval gates) already covers a meaningful slice of what "who-did-what" accountability needs.

Evidence sought against A: I looked specifically for a platform already shipping (not promising) cross-host, agent-attributable audit trails — none was found among the six platforms studied, which is evidence *for* A holding, not against it (a genuine absence, not a search failure, since OpenAI's own page hedges "coming soon"). Evidence sought against B: OpenAI's controls (RBAC, sandboxing, approval gates) are per-platform, not cross-host or provenance-of-work-product — they govern what an agent may *touch*, not what it verifiably *did* or *whether the deliverable met its obligation*, which is a different claim than the requester's kernel targets. B is weakened but not eliminated: it's possible enterprise-controls roadmaps quietly subsume the obligation/provenance space before a small independent tool can occupy it — that risk is real and is the strongest objection below, not refuted.

## Strongest objection

The commoditization argument this document leans on (model access + basic agent loop = table stakes) is itself being made by venture-strategy commentary with an interest in selling the "next layer" narrative to founders — the same genre of content that produced some of the unreliable ARR figures flagged above. If OpenAI's "coming soon" enterprise/audit features ship broadly and cheaply within Codex/Copilot in the next two quarters, the obligation/provenance space could commoditize on the same timeline the model layer did, before an independent kernel has time to establish switching-cost statefulness. The record available here cannot rule this out; it can only confirm the feature is not shipped yet.

## Pre-mortem

If the strategy document bets the kernel's differentiation on "governance/provenance is unclaimed ground" and that turns out wrong: the most likely failure story is that OpenAI or Microsoft ships a "Codex/Copilot Audit" enterprise SKU within the next two-three quarters, bundled into existing per-seat enterprise pricing at near-zero marginal cost, and enterprise buyers standardize on the incumbent's bundled version over a standalone third-party kernel purely on procurement inertia — not because the incumbent's version is better, but because it required no new vendor approval.

## Handbacks

None. Every open question above was either answered from what was reachable this session or explicitly marked `[unverified]` with what would settle it, per §8 of the method.

---

Verification record
- Claims cited: answered — inline `[cite: requester]`, `[research: …]`, `[unverified]` markers throughout §1–3
- Source classes: answered — record vs. research vs. aggregator distinguished inline, especially in §1 platform-by-platform breakdown
- Independence: answered — see "Single-source list" section above
- Disconfirmation: answered — see "Disconfirmation pass" | reversed the draft conclusion: no (weakened B's case, did not overturn A)
- Coverage frame: answered — see frame sentence at top; absences (unopened NIST page, unopened anthropic.com/news/skills full text, unopened Reuters wire) are classified as not-yet-collected, named in the relevant claim's line
- Ground exhausted: answered — every named document is either read directly (marked "fetched and read," "read") or its line states it was reached only via secondary/aggregator coverage
- Strongest objection: answered — see "Strongest objection" section
- Pre-mortem: answered — see "Pre-mortem" section
- Handbacks: none
