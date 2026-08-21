# investigative-research — recorded run 2 (2026-08-20, Sonnet tier)

Run conditions, stated so the record is checkable: this run exists to answer
the portability question for the pilot skill — does it hold its floor on a
Sonnet-class model, one capability tier below the model that authored it?
The producing agent ran on Sonnet with web access, was given a copy of
`SKILL.md` outside the repository as its only method reference, and explicit
instruction not to read this repository. The task was real and load-bearing:
verifying the recorded characterization of affaan-m/ECC's catalog as
"engineering-config shaped," on which the deferred build-vs-build-on
decision leans.

The one-line verdict for the use ledger: the disconfirmation pass reversed
the recorded claim. ECC's catalog carries a real, directly-quotable minority
of business/analytic method skills (market-research names "investor due
diligence" in its own description field; investor-materials,
competitive-report-structure, article-writing, deep-research all carry
multi-step method, read as primary text). The surviving position is
narrower: majority engineering-shaped by folder count, with a business/
analytic minority that is lighter-weight than tradecraft-level method — none
of the five skills read carry a disconfirmation-pass requirement, a
coverage/absence frame, or a closing verification record. The differentiator
claim in this repository's records is corrected accordingly: depth and
rigor, not the mere presence of business-domain content.

The run also demonstrated the skill's honesty machinery on the lower tier:
directory-listing counts were explicitly downgraded to unverified because
they passed through a summarizing intermediary, the sample's selection bias
was named unprompted, and the star-count discrepancy with an aggregator was
resolved as a date-kind issue rather than a contradiction.

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading).

---

# ECC catalog verification — does it carry business/analytic method content

**Requester's question:** verify a load-bearing characterization in construct's strategy: that affaan-m/ECC's catalog is "engineering-config shaped" with no meaningful overlap against construct's business/analytic method differentiator (investigative research discipline, decision framing, document-writing method).

**Bottom line up front:** the characterization is **not accurate as stated**. ECC's catalog does carry business/analytic method skills — including one, `market-research`, whose description names "investor due diligence" and whose body explicitly separates fact/inference/recommendation and requires sourcing every claim — that overlap in *topic* with construct's differentiator. But the overlap is narrower than a full reversal: this business/analytic slice is a minority of the catalog by count, and where it exists it is lighter-weight than construct's tradecraft-level method (no disconfirmation-pass requirement, no coverage/absence framework, no closing verification gate found in the skills read). The defensible differentiator is method **depth and rigor**, not the mere presence of business-domain content — the original blanket claim does not survive and should be narrowed before the build-vs-build-on decision leans on it.

## 1. Scope frame

Population covered: the public GitHub repository `affaan-m/ECC` (default branch `main`) as it existed at fetch time on 2026-08-20/21. Coverage is the `skills/` directory listing (top-level folder names, ~286 per the repo's own README) plus direct reads of five representative `SKILL.md` files chosen for topical relevance to the question (research method, decision documents, competitive analysis, long-form writing, market research). Not covered on purpose: `agents/`, `commands/`, `rules/`, `hooks/`, and MCP config directories (not disputed — requester's characterization already concedes these are engineering-shaped, and the question is specifically about the skills catalog); the full text of all ~286 skill files (one bounded pass, §7 — a sample was read, not the whole catalog); the npm packages (`ecc-universal`, `ecc-agentshield`) and `ecc.tools` site, which were out of scope for a catalog-content question.

## 2. What the repository is, sourced and classed

- **Identity/rename.** The repository resolves at `github.com/affaan-m/ECC`; GitHub's contents API and raw file server both serve `main` under that path today [research: GitHub REST API, `api.github.com/repos/affaan-m/ECC`, fetched 2026-08-20 — **record**, direct API response]. Search results also show the path `affaan-m/everything-claude-code` referring to the same project (docs, discussions, CONTRIBUTING.md all under that name) [research: GitHub search results for "affaan-m/ECC everything-claude-code", including `github.com/affaan-m/everything-claude-code/discussions/740` and `.../blob/main/CONTRIBUTING.md` — **aggregator/index**, search-result listing, not opened directly]. This is consistent with the requester's own claim that the repo was "formerly named everything-claude-code" [cite: requester].
- **Stars.** GitHub API `stargazers_count` = 241,480, `pushed_at` 2026-08-19T23:31:56Z, `updated_at` 2026-08-21T02:33:28Z [research: GitHub REST API, `api.github.com/repos/affaan-m/ECC`, fetched 2026-08-20 — **record**]. This matches the requester's "roughly 241k stars when last checked on 2026-08-20" [cite: requester] closely and independently (a fresh API pull, not a copy of the requester's prior number). One search snippet cited "82,000 GitHub stars" from a Medium article [research: "Everything Claude Code: Inside the 82K-Star Agent Harness...", Medium, by Ewan Mak — **aggregator**]; I did not open the Medium piece's byline date. This is a **date-kind issue, not a contradiction**: the 82k figure is a star count read at whatever time that article was written, and star counts only grow, so an earlier, lower count from an undated aggregator does not disconfirm today's 241k API read. Flagging rather than resolving further — it is not load-bearing for the catalog-content question.
- **License.** MIT, copyright "Affaan Mustafa (2026)," confirmed two ways: the repo's own `LICENSE` file text [research: `raw.githubusercontent.com/affaan-m/ECC/main/LICENSE`, fetched 2026-08-20 — **record**, primary text] and GitHub's parsed `license.spdx_id: MIT` field [research: GitHub REST API, `api.github.com/repos/affaan-m/ECC` — **record**]. These are independent in the sense that one is the raw file and the other is GitHub's own automated license detector reading that same file — agreement here mostly confirms the detector read the file correctly, not two separate custodians; treat this as a single well-corroborated fact, not doubly independent evidence.
- **Skill file format.** Anthropic's own Agent Skills documentation defines a skill as "a `SKILL.md` file with instructions," invoked via a directory convention, with frontmatter fields including `name` and `description` [research: "Extend Claude with skills," code.claude.com/docs/en/skills, fetched 2026-08-20 — **derived record**, official product documentation]. Every ECC skill file I opened follows exactly this shape: a `skills/<name>/SKILL.md` path, YAML frontmatter with `name:` and `description:` fields, plus an ECC-specific `metadata: origin: ECC` field, and a markdown body [research: raw.githubusercontent.com reads of `skills/deep-research/SKILL.md`, `skills/investor-materials/SKILL.md`, `skills/competitive-report-structure/SKILL.md`, `skills/article-writing/SKILL.md`, `skills/market-research/SKILL.md`, all fetched 2026-08-20 — **record**, primary file content]. So: **yes, ECC's skill format is the Agent Skills SKILL.md format**, with one addition (an `origin` metadata field) that does not deviate from the spec, since the spec permits additional frontmatter.

## 3. What the catalog actually contains

Two directory reads, both against the live repository, agree on the shape of the catalog: an alphabetical slice of ~140 top-level folder names under `skills/` [research: GitHub REST API contents listing, `api.github.com/repos/affaan-m/ECC/contents/skills`, and a git-tree read, both fetched 2026-08-20 — **record**, though both reads were summarized by an intermediate small model rather than returned as raw JSON, so treat the *presence* of each named folder as reliable and any *count* claim ("all 50 have SKILL.md," "50 total") as **unverified** — that summary looks like it silently truncated a ~286-entry list to 50 and should not be trusted for totals]. What's reliably established, folder-name by folder-name, is a large majority of **engineering/tooling** skills — language and framework packs (`android-clean-architecture`, `angular-developer`, `csharp-testing`, `dart-flutter-patterns`, `django-*`, `dotnet-patterns`, `fastapi-patterns`, `golang-*`, `fsharp-testing`), infrastructure (`docker-patterns`, `database-migrations`, `deployment-patterns`, `homelab-*`), and agent-harness tooling (`agent-architecture-audit`, `agentic-os`, `autonomous-agent-harness`, `benchmark-optimization-loop`, `council`/`council-multi-model`, `ecc-guide`, `ecc-recipes`, `eval-harness`, `mcp-server-patterns`, `unified-memory`, `verification-loop`) — plus a smaller, but real and directly quotable, set of **business/analytic** skills: `market-research`, `investor-materials`, `investor-outreach`, `competitive-platform-analysis`, `competitive-report-structure`, `benchmark-methodology`, `deep-research`, `article-writing`, `brand-discovery`, `brand-voice`, `growth-log`, `customer-billing-ops`, `finance-billing-ops`, `customs-trade-compliance`, `energy-procurement`, `carrier-relationship-management`, `inventory-demand-planning` [research: same two directory reads as above — **record** for folder presence].

Five of these were opened directly (primary text, not description-only):

| Skill | What it actually says (quoted) | Method category |
|---|---|---|
| `market-research` | description: "market research, competitive analysis, **investor due diligence**, and industry intelligence with source attribution and decision-oriented summaries"; body: "Every important claim needs a source," "Separate fact, inference, and recommendation clearly," "Translate findings into a decision, not just a summary" [research: `raw.githubusercontent.com/affaan-m/ECC/main/skills/market-research/SKILL.md`, fetched 2026-08-20 — **record**] | Directly overlaps investigative research discipline |
| `deep-research` | "Cross-reference. If only one source says it, flag it as unverified," "academic, official, reputable news > blogs > forums," separate "fact from inference" [research: same-pattern fetch of `skills/deep-research/SKILL.md`, fetched 2026-08-20 — **record**] | Overlaps investigative research discipline (lighter-weight — see §5) |
| `investor-materials` | "All investor materials must agree with each other," "If conflicting numbers appear, stop and resolve them before drafting" [research: `skills/investor-materials/SKILL.md`, fetched 2026-08-20 — **record**] | Overlaps decision framing |
| `competitive-report-structure` | "The report must answer three questions for the client: who do we compete with, how do we compete, and where is our defensible white-space?", "Tie every recommendation back to the brand balance... and flag any that would shift it" [research: `skills/competitive-report-structure/SKILL.md`, fetched 2026-08-20 — **record**] | Overlaps decision framing |
| `article-writing` | "Write long-form content that sounds like an actual person with a point of view, not an LLM smoothing itself into paste," "Use proof instead of adjectives" [research: `skills/article-writing/SKILL.md`, fetched 2026-08-20 — **record**] | Overlaps document-writing method (genre: articles/marketing, not specs/business documents) |

## 4. Independence

Single-source list: every claim about ECC's *content* rests on ECC's own repository (its file text, or GitHub's index of that text) — there is no independent third party attesting to what's inside these skill files, because the only entity with custody of "what's actually in the file" is the file itself. This is expected and not a corroboration gap in the usual sense: reading the primary record directly *is* the strongest available evidence for "what does the catalog contain," and no aggregator's description of it would outrank that. Where an independent source *could* exist and would matter: a third-party audit or fork comparing ECC's business-skill quality against a dedicated business-skills product (none found in this pass); an independent, dated re-count of the full skill list (the two directory reads I have are not fully independent — both derive from the same GitHub-served tree at the same near-instant, summarized by the same kind of tool). The star-count and license fields *do* have two independently-sourced confirmations each (API field vs. raw file / API field vs. requester's own prior check), noted in §2.

## 5. Disconfirmation pass

**Hypothesis A (the requester's recorded finding):** ECC's catalog is genuinely engineering-configuration shaped; it carries no business/analytic method content that would overlap with construct's differentiator.

**Hypothesis B:** ECC's catalog does carry business/analytic method skills, and they meaningfully overlap with investigative research, decision framing, and document-writing method.

What would refute A, and was it found: a single skill whose description or body names due diligence, sourcing discipline, or decision-oriented synthesis would refute A. `market-research`'s description literally contains the phrase "investor due diligence" and its body requires "Separate fact, inference, and recommendation clearly" — this is a direct hit, found by opening the primary file, not inferred. A refuted.

What would refute B (i.e., support a strong form of A): if the "business" skills turned out to be five-line stubs with no actual method — pure naming with no teachable content. Checked directly: `investor-materials`, `competitive-report-structure`, `article-writing`, `deep-research`, and `market-research` all contain multi-step, imperative methodological instructions (stop-and-resolve-conflicts rules, source-hierarchy rules, three-question report structures), not stubs. B is not refuted on the "thin content" axis.

What would weaken B to a narrower form: if these skills, while topically overlapping, were shallower than construct's own method. Checked: none of the five opened skills contain a disconfirmation-pass requirement, a coverage/absence framework, an independence-vs-corroboration distinction, or a closing verification record comparable to §5/§6/§9-10 of the investigative-research skill applied in this very deliverable. `deep-research`'s "cross-reference, flag as unverified if only one source" is a real but single-layer check, not a structured hypothesis-vs-evidence method.

**Verdict, weighed by least credible disconfirmation:** Hypothesis A is refuted outright (direct textual hit on "investor due diligence" plus four more overlapping skills) — this is not a close call. The disconfirmation pass **materially weakened but did not simply flip to the opposite extreme**: the correct resting point is a third, narrower position — call it Hypothesis B′ — "ECC's catalog is majority engineering-shaped by folder count, but carries a real, directly-quotable minority of business/analytic method skills that overlap construct's differentiator on topic; where they overlap, ECC's method is lighter-weight than construct's tradecraft-level rigor." This reverses the requester's literal claim while preserving a defensible, narrower version of the underlying strategic point.

| Evidence | A (purely engineering) | B (full overlap, no differentiation left) | B′ (narrower: real but shallower overlap) |
|---|---|---|---|
| `market-research` description names "investor due diligence" | inconsistent | consistent | consistent |
| Majority of ~140 sampled folder names are language/infra/agent-tooling | consistent | inconsistent | consistent |
| Five business skills read contain real multi-step method, not stubs | inconsistent | consistent | consistent |
| None of the five contain a disconfirmation-pass, coverage-frame, or verification-record analog | consistent | inconsistent | consistent |

## 6. Coverage and absence

Frame: this pass covers folder-name presence across the sampled ~140 of ~286 skill folders, plus five fully-read files. It does **not** cover the remaining ~146 skill folders' content, the `agents/`, `commands/`, `rules/`, `hooks/`, MCP config directories, or the non-English doc trees (`docs/pt-BR/` was seen only as a search-result title, not opened). Classification of what's not covered: **not-yet-collected** for the unread skill files and non-`skills/` directories (they exist; this pass didn't reach them) — most likely to contain more engineering-shaped content given the folder names visible, but that is an inference, not confirmed. Whose record is thinner: business-analytic and compliance-flavored skills (`customs-trade-compliance`, `energy-procurement`, `carrier-relationship-management`, `healthcare-*`) were seen only as folder names, not read — the catalog may carry more overlap with construct's differentiator than this pass surfaced, since the sample favored skills whose names most obviously matched the question (a selection-bias risk worth naming: I chose the five most likely to overlap, which inflates the apparent overlap rate somewhat, though the raw hit — "investor due diligence" in a description field — required no cherry-picking to find).

## 7. Ground exhausted

Every source named above was opened directly: the repo root, the contents API, the git tree, the LICENSE file, five SKILL.md files, and Anthropic's skills documentation page. Not opened, and marked accordingly: the Medium article's publish date [unverified — would settle the star-count date-kind question, not load-bearing here], the remaining ~146 unsampled skill folders' content [unverified/not-yet-collected — a further pass would open `investor-outreach`, `competitive-platform-analysis`, `brand-voice`, `growth-log`, `customs-trade-compliance` etc. directly], the `docs/pt-BR/README.md` [unverified — seen only as a search-result title].

## 8. Strongest objection

The strongest argument against this deliverable's conclusion: the sample was small (5 of ~286 files, chosen because their names looked most likely to overlap) and the two directory listings both passed through an intermediate summarizing tool rather than being read as raw JSON — so the "majority is engineering-shaped" claim in §5's table rests on folder *names*, not file content, for everything except the five files actually opened. It is possible that a fuller read would find the business-skill slice thinner or shallower still than this pass suggests (strengthening the original claim), or conversely that other unsampled business skills are just as deep as `market-research` (weakening it further toward B). The one fact this objection cannot touch is the direct textual hit: `market-research`'s description names "investor due diligence" in the repository's own primary file, read directly. That single fact is sufficient on its own to falsify the strong form of the requester's claim ("genuinely engineering-configuration shaped"), independent of how the broader sample is weighted.

## 9. Pre-mortem

If construct proceeds on a strategy document that still asserts "ECC's catalog is genuinely engineering-config shaped with no business/analytic method overlap," and a competitor, investor, or technical reviewer later opens `affaan-m/ECC/skills/market-research/SKILL.md` and reads "investor due diligence... decision-oriented summaries... separate fact, inference, and recommendation clearly" — the claim will read as either uninvestigated or knowingly overstated, and it will undercut trust in the rest of the strategy document's other load-bearing claims, not just this one. The failure mode is not that the differentiator disappears — a depth-based differentiator (disconfirmation pass, coverage framework, verification record, source-independence discipline) survives this verification — but that the *stated version* of the differentiator is falsifiable by a five-minute read of ECC's own repo, which is exactly the kind of claim a hostile reader checks first.

## 10. Handbacks

None. Every sub-question the requester asked (catalog content, business/analytic overlap, license, SKILL.md format) was reachable and answered from the repository's own primary files within this pass; nothing here requires the requester's authority, access, or a decision this pass lacks standing to make. The one open item — reading the remaining ~146 skill folders for a fuller overlap percentage — is optional depth for the eventual build-vs-build-on decision, not something only the requester could settle; if wanted, it is a further bounded research pass, not a handback.

---

Verification record
- Claims cited:        answered — see §2, §3 (table), §6 — every date, count, license field, and quoted line carries [research: …] or [cite: requester]
- Source classes:      answered — see §2–§3 (record / derived record / aggregator labeled inline on first use)
- Independence:        answered — see §4 (single-source-by-necessity noted; star/license fields have two independent confirmations)
- Disconfirmation:     answered — see §5 (hypothesis table) | reversed the draft conclusion: yes — narrowed from "genuinely engineering-shaped" to "majority engineering-shaped with a real, shallower-than-construct's business/analytic minority"
- Coverage frame:      answered — see §6 (frame sentence, absences classified as not-yet-collected, selection-bias risk named)
- Ground exhausted:    answered — see §7 (every named document read or its line says why not)
- Strongest objection: answered — see §8
- Pre-mortem:          answered — see §9
- Handbacks:           none — see §10
