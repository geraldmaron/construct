# investigative-research — recorded run 1 (2026-08-20)

Run conditions, stated so the record is checkable: this was the pilot skill's
naked-file test and first dogfood run in one. The producing agent was given a
copy of `SKILL.md` outside the repository as its only method reference,
explicit instruction not to read this repository, and web access. The task was
real — resolving a claim the strategy research of 2026-08-20 had left
unverified. The deliverable below is verbatim as produced; nothing was edited.
The one-line verdict for the use ledger: the disconfirmation gate reversed the
draft conclusion, which is the gate-changed-outcome event the falsification
test counts.

Producing model: the session's own family (a Claude-family model). Where a
judged reading of this run is quoted, the correlated-error caveat travels with
it: producer and any same-family judge share failure modes, so observed
agreement is an upper bound on independent agreement.

---

# Verification: `koudicz/claude-harness` — existence, stars, and the cross-harness adapter claim

**Verdict in one paragraph.** The repository exists, but the claim as posed conflates two repositories. `koudicz/claude-harness` is a public, near-zero-traction **fork** (1 star, 0 forks, created 2026-03-21) of `affaan-m/ECC` — formerly `everything-claude-code` — and it is the *parent* that carries the traction and the "DRY adapter pattern" [research: GitHub REST API, GET /repos/koudicz/claude-harness, fetched 2026-08-20]. The star claim is false for the fork and *understated* for the parent, which stood at 241,391 stars at check time [research: same API response, `parent.stargazers_count` field]. The prior pass's HTTP 403 is best explained as unauthenticated API rate-limiting (reproduced live during this work), and its absence from a multi-repo search query is expected behavior: GitHub excludes forks from search results by default [research: GitHub Docs source file `searching-in-forks.md`, github/docs repo, main branch]. The strategically load-bearing answer: **yes, this niche is occupied, massively — by the parent repo `affaan-m/ECC`, not by `koudicz/claude-harness`.**

## 1. Findings, claim by claim

### (a) "It exists publicly on GitHub" — TRUE, but it is a fork

- The repository page is live and public [research: github.com/koudicz/claude-harness, fetched 2026-08-20].
- The API record states: `fork: true`, `parent.full_name: "affaan-m/ECC"`, `created_at: 2026-03-21T20:37:11Z` — a registration date for the fork, not a project founding date [research: GitHub REST API, GET /repos/koudicz/claude-harness, fetched 2026-08-20].
- The owner `koudicz` ("Koudy", Czech Republic, 4 followers, 58 repos, mostly forks) is an ordinary personal account, not the project's author [research: github.com/koudicz profile page, fetched 2026-08-20].
- The fork is stale: `updated_at` and `pushed_at` are both 2026-03-21, the same day it was created [research: same API response]. It is a snapshot, not a maintained project.

### (b) "Roughly 50,000+ stars" — FALSE for this repo; describes the parent

- `stargazers_count: 1` for `koudicz/claude-harness` [research: GitHub REST API, GET /repos/koudicz/claude-harness, fetched 2026-08-20].
- The parent, `affaan-m/ECC`, shows 241,391 stars and 36,599 forks in the same API response, and "241k / 36.6k" on its rendered page — a count as-of the check date, 2026-08-20 [research: GitHub REST API `parent.*` fields, and github.com/affaan-m/ECC page, both fetched 2026-08-20].
- The parent's trajectory makes "50,000+" a plausible description of **ECC as of roughly the fork's creation date (March 2026)**: launched 2026-01-18 [research: `parent.created_at`, same API response], reported at ~82K stars, ~100K stars, 163K, 170K, and 228K (July 2026) in a sequence of third-party article headlines [research: WebSearch result listing, 2026-08-20 — headlines from Medium ("Inside the 82K-Star Agent Harness…", Ewan Mak), Augment Code learn pages, and TechTimes ("Agent Harness ECC Tops 228K Stars", dated 2026-07-13 in its URL); **article bodies unread — the egress proxy blocked techtimes.com and augmentcode.com**]. That the original 50k+ claim was a fork/parent conflation is an **inference**, marked as such: the fork's page renders the parent's README and description verbatim, which is exactly the surface that invites the conflation.

### (c) "Cross-harness skills + hooks + security via a DRY adapter pattern transforming Claude Code hook scripts for Cursor" — TRUE in substance, with one mechanism correction

- The README (carried identically by fork and parent) states verbatim: "**DRY adapter pattern** lets Cursor reuse Claude Code's hook scripts without duplication" and "The `.cursor/hooks/adapter.js` module transforms Cursor's stdin JSON to Claude Code's format, allowing existing hook scripts to be reused without duplication" [research: README.md, affaan-m/ECC repository, raw.githubusercontent.com, fetched 2026-08-20].
- **Correction to the claim's mechanism:** the adapter transforms *Cursor's input into Claude Code's format* so that Claude Code hook scripts run **unmodified**; it does not transform the hook scripts themselves. Same DRY outcome, inverted direction.
- The broader claim set (skills, hooks, security, cross-harness) matches: the README claims 68 agents, 286 skills, 94 command shims, hook/rule systems, and support for Claude Code, Codex, OpenCode, Cursor [research: same README fetch], and an "AgentShield" security component "Built at the Claude Code Hackathon (Cerebral Valley x Anthropic, Feb 2026). 1282 tests, 98% coverage" [research: same README fetch — note these test/coverage figures are the project's self-description, not independently verified].

### The prior pass's 403 — explained as rate limiting, not access denial

- The prior pass got a 403 for this repo while six others verified fine [cite: task brief]. During this work the same symptom **reproduced**: `GET /users/koudicz` returned HTTP 403 while two adjacent api.github.com calls succeeded, and a later github.com/search request returned HTTP 429 with `Retry-After: 3600` [research: live probes during this session, 2026-08-20; reproducible by rerunning unauthenticated through a shared egress IP].
- GitHub's documentation source states: "If you exceed your primary rate limit, you will receive a `403` or `429` response" [research: `rate-limits-for-the-rest-api.md`, github/docs repository source, main branch, fetched 2026-08-20]. The commonly cited 60-requests/hour unauthenticated ceiling appeared only in search-result summaries; the doc source keeps the number in a template include the run could not resolve, so that specific figure is [unverified] — resolvable by reading the rendered docs page from an unblocked network.
- That the *prior* 403 was rate-limiting is an **inference** (the strongest available): the repo is publicly reachable today, which rules out any persistent access block; a nonexistent or private repo would be expected to return 404, though that 404-for-private behavior itself went unread in a primary source here [unverified — settled by GitHub's REST API docs on repository visibility errors].

### The missing search result — expected behavior for a fork

- "By default, forks are not shown in search results"; including them requires `fork:true` or `fork:only` (repo search) or `is:fork` (code search) [research: `searching-in-forks.md`, github/docs repository source, main branch, fetched 2026-08-20]. A multi-repo verification query that used GitHub search would therefore miss `koudicz/claude-harness` *by design*, since it is a fork. Which query type the prior pass used is not in the record, so mapping this rule onto that specific miss is an inference. A live confirmation attempt (default search for "claude-harness") was rate-limited (429) and could not be completed.

### The strategic question — is the niche occupied?

**Yes, decisively, by the parent.** `affaan-m/ECC` (ex-`everything-claude-code`, by Affaan Mustafa) *is* the cross-harness skills+hooks+security adapter with real traction: ~241k stars as of 2026-08-20 [research: GitHub API and repo page, above], npm packages `ecc-universal` and `ecc-agentshield`, a GitHub App, and a homepage at ecc.tools [research: affaan-m/ECC repo page, fetched 2026-08-20]. The rename is evidenced by the old URL github.com/affaan-m/everything-claude-code serving the ECC repository's content [research: fetch of that URL, 2026-08-20 — served the affaan-m/ECC page; that this reflects a GitHub rename redirect is an inference]. Secondary occupants exist at far smaller scale, known here only from search-result descriptions (bodies unopened): `mcpware/cross-code-organizer` (cross-host config dashboard), `razzant/claudexor` (multi-host control plane), `fcakyon/claude-codex-settings` (multi-tool configs/hooks) [research: WebSearch result listing, 2026-08-20 — repository descriptions from result titles only; traction figures not collected]. No third-party source discusses `koudicz/claude-harness` itself — a targeted search returned only the fork's own GitHub page plus unrelated projects that coincidentally use the words "claude harness" in their names [research: WebSearch, query `"koudicz" "claude-harness"`, 2026-08-20].

## 2. Source classes (first-use register)

| Source | Class | Notes |
|---|---|---|
| GitHub REST API responses (repos/users endpoints) | **Record** — registry entries | Counts are as-checked 2026-08-20; `created_at` is registration-kind |
| GitHub repository/profile HTML pages | **Record** — same registry, rendered | Same custodian as the API; not independent of it |
| `affaan-m/ECC` README (raw file) | **Record** of what the project claims about itself | Its test/coverage/count figures are self-description |
| github/docs source files (`searching-in-forks.md`, `rate-limits-…md`) | **Record** of GitHub's documentation | The docs' claims about platform behavior; doc source, not rendered page |
| Live 403/429 probes this session | **Record** of observed behavior | Timestamped observations, 2026-08-20 |
| Article headlines via WebSearch (Medium, TechTimes, Augment Code, Enterprise DNA) | **Aggregator** — headlines only | Bodies unread (egress-blocked); each headline's star figure dates from its publication |
| Task brief (prior 403, six repos verified, missing search result) | **Requester material** | Outranks anything found; taken as given |
| Fork/parent conflation; rename; rate-limit attribution of the prior 403 | **Inference** | Marked at each site above |

## 3. Single-source list

Conclusions resting on a single upstream, with whether independence could exist:

1. **All repository metadata (existence, fork status, dates, the counts themselves).** Sole custodian: GitHub's registry, read via two surfaces (API + HTML) that share custody. No independent registry of GitHub repos exists; mirrors could be checked but were not reached. For a fork this obscure, no independent record plausibly exists at all.
2. **ECC's star *trajectory*.** All observers (headlines at 82K→100K→163K→170K→228K→241k) read the same instrument — GitHub's counter — at different times. The corroboration is temporal, not custodial: it shows today's 241k is not a one-day glitch, but cannot show the counter reflects genuine humans (see Strongest objection).
3. **ECC's internal quality claims** (1282 tests, 98% coverage, hackathon origin). Single source: the project's own README. Independent check would be cloning and running the suite — out of scope here.
4. **The "DRY adapter pattern" text.** Single source: the README — but for claim (c) the README *is* the thing being verified, so this is the record itself, not a thin spot.

## 4. Disconfirmation pass

Hypotheses held, what would refute each, and what was found:

- **H1 — exists as claimed (50k+ stars, cross-host adapter).** Refuted by: a star count far from 50k. **Found: `stargazers_count: 1`.** Refuted.
- **H2 — does not exist; hallucination or name-mangling.** Refuted by: a live public page. **Found: live page and API record.** Refuted as literally stated — though the mangling instinct was half right: the *attributes* were mangled onto the wrong repo.
- **H3 — exists but private/renamed/much smaller.** "Much smaller" survives (1 star); "private" refuted (public today); "renamed" refuted for the fork (name intact) but confirmed *for the parent* (everything-claude-code → ECC).
- **H4 (emerged during the pass) — exists as a trivial fork; every impressive attribute belongs to the parent.** What would refute it: the fork diverging from the parent (own commits, own README) or the parent lacking the claimed traction/adapter. **Found: neither — the fork is a same-day snapshot, and the parent carries both the stars and the verbatim DRY-adapter text.**

| Evidence | H1 as-claimed | H2 nonexistent | H3 private/smaller | H4 fork-of-real-thing |
|---|---|---|---|---|
| Public page live, 2026-08-20 | consistent | **inconsistent** | inconsistent (private) | consistent |
| `stargazers_count: 1` | **inconsistent** | — | consistent | consistent |
| `fork: true`, parent affaan-m/ECC | silent | **inconsistent** | silent | consistent |
| "DRY adapter pattern" verbatim in README | consistent | **inconsistent** | consistent | consistent |
| Parent at 241k stars; ~50–100k around March 2026 | silent | silent | silent | consistent (explains "50k+") |
| 403 reproduced on unauthenticated API today | silent | silent | silent | consistent (prior 403 ≠ evidence about the repo) |

Weighed by least credible disconfirmation: **H4 stands — nothing found weighs against it.** Per the method's own requirement to say so: **the disconfirmation pass materially corrected the draft conclusion.** The first page fetch came back summarized as an active, hackathon-winning project with "significant community contributions," and only the precise field extraction (`fork: true`, 1 star, same-day snapshot) exposed that every impressive attribute belonged to the parent.

## 5. Coverage frame and absences

**Frame:** GitHub's public registry plus English-language web coverage reachable through the session's egress proxy, checked on 2026-08-20; deliberately outside the frame: the local repository (excluded by the task), authenticated GitHub access, non-English coverage, and any pre-2026 history of the ECC project's private development.

Classified absences:

- *`koudicz/claude-harness` in default search results*: expected-absent per documented fork exclusion; the live confirmation is **not-yet-collected** (the test drew HTTP 429, retry-after 3600s).
- *Third-party coverage of `koudicz/claude-harness` specifically*: one targeted search found none; classified **did-not-happen with residual unknown** — a 1-star fork attracts no coverage, but one search pass cannot prove a negative.
- *Traction figures for the secondary niche occupants*: **not-yet-collected** — their pages went unopened in the bounded pass.
- *Authenticity of ECC's star count* (organic vs. inflated): **not-recorded anywhere reachable** — no source in this collection can distinguish them; see the objection below.
- *When exactly the parent was renamed, and what the prior pass's exact query was*: **not-yet-collected** and **not-recorded here** respectively.

**Skew to name:** the egress proxy blocked docs.github.com, techtimes.com, and augmentcode.com, so this record is systematically thicker on GitHub's own records (self-descriptions included) and thinner on independent third-party commentary — precisely the direction that flatters ECC.

## 6. Strongest objection

*"Your niche verdict leans on a star counter, and star counters are gameable. Every 'independent' data point in your trajectory — the 82K headline, the 228K article, today's 241k — is the same GitHub instrument read at different times; none of them measures real adoption. One of your own unopened headlines calls the repo's velocity anomalous ('+1,250 stars/day, zero press coverage') and another calls it 'dividing the developer community.' A quarter-million stars accrued in seven months to a single-maintainer repo is exactly the profile star-inflation produces, and you verified none of the usage signals — npm download counts, dependents, issue quality — that would separate a phenomenon from a promotion. Your headline verdict, 'the niche is occupied, massively,' could be resting on a manufactured number."*

Response, not a rebuttal: the objection is sound about what the evidence can and cannot carry. Existence, fork status, the README's adapter text, and the fork/parent conflation stand regardless. The *magnitude* of ECC's traction is a single-instrument reading; the fact of *substantial* traction (multiple independent outlets choosing to cover it over months, an npm/GitHub-App footprint) survives even heavy discounting, but "241k stars" should be quoted as "GitHub shows 241k stars," never as "241k users."

## 7. Pre-mortem

**Recommendation made:** correct the upstream record to point at `affaan-m/ECC` (not `koudicz/claude-harness`) as the niche occupant, treat the prior 403 as a tooling artifact, and add `fork:true` (or authenticated direct lookups) to future multi-repo verification queries.

*Assume this was followed and failed — the likeliest story:* the record was corrected to name ECC as the dominant occupant, and three months later a competitive analysis built on that entry looks foolish: ECC's star count is exposed as substantially inflated, or the single maintainer burns out and the repo goes stale, and meanwhile the *actual* durable occupant turns out to be one of the smaller tools this pass left unopened — or a vendor-native feature (Cursor or Anthropic shipping first-party cross-host config) that no repo-shaped search would ever have surfaced. The failure mode is treating a point-in-time star reading as a durable market structure. The mitigation is already in this document's absences list: the secondary occupants were not-yet-collected, and the verdict should be re-read, not re-cited, at next use.

## 8. Handbacks

None. Every question the task posed was settled from reachable material; the two items left open (live fork-search demonstration, rendered rate-limit figure) are corroborated by GitHub's documentation source and change no conclusion.

---

```
Verification record
- Claims cited:        answered — see §1, markers inline on every load-bearing claim
- Source classes:      answered — see §2 register; date-kinds stated in §1 (registration vs. as-checked)
- Independence:        answered — see §3 single-source list; §5 names the shared-instrument limit
- Disconfirmation:     answered — see §4, hypotheses + table | reversed the draft conclusion: yes — materially corrected it (fork/parent conflation exposed)
- Coverage frame:      answered — see §5, frame sentence + classified absences + named skew
- Ground exhausted:    answered — see §5 absences and §1; every unopened source's line says why (egress-blocked or rate-limited)
- Strongest objection: answered — see §6, stated in its own words
- Pre-mortem:          answered — see §7
- Handbacks:           none
```
