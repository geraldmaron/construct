---
name: docs-research-workflow
description: "Use when: cx-researcher must investigate external facts — CVEs, APIs, market data, regulations, or vendor behavior."
inputs: [research-question]
artifactType: research-brief
toneDefault: direct
toneAllowed: [direct]
verificationBar: "Question→Method→Sources→Findings(Observation≠Inference)→Counter-evidence→Recommendation; every load-bearing claim cites a verifiable primary source or [unverified]."
triggers: ["research brief", "user research"]
---
# External Research Workflow

Use when: cx-researcher investigates **external** facts — not user interviews or codebase exploration. For user evidence use `docs/user-research-workflow`; for repo exploration use `docs/codebase-research-workflow`.

Follow [rules/common/research.md](../../rules/common/research.md) as the default policy.

## Native spine (blocking)

Question → Method → Sources → Findings → Counter-evidence → Confidence summary → Gaps → Implications → Recommendation → Open questions → References.

- Findings must separate **Observation** from **Inference**.
- `construct artifact validate --type=research-brief` runs `lintResearchBriefDeliveryDepth`.

## Steps

1. **Clarify the question**: one specific, falsifiable question the research must answer.
2. **Apply recency discipline**: search from the most recent year backward. For fast-moving domains, treat sources older than 12 months as presumptively stale unless confirmed.
3. **Check internal evidence first**: `.construct/research/`, `.construct/knowledge/`, PRDs, ADRs, runbooks before going external.
4. **Choose the tool path by intent, not habit**:

   - Construct itself → `knowledge_search`
   - Current repo / attached files / ingested artifacts → local evidence first
   - Library / framework / API / cloud docs → Context7 when available, otherwise web-search and fetch official docs directly
   - Everything else → domain-primary sources first, web search only as the locator

5. **Choose authoritative starting points** (external primary only):

   | Domain | Starting points |
   |---|---|
   | AI / LLM / multi-agent | arXiv, ACL Anthology, NeurIPS/ICML/ICLR proceedings |
   | Security / CVEs | NVD, GitHub Security Advisories, OWASP, vendor security blogs |
   | Market / adoption | SEC filings, company announcements, then analyst reports citing primaries |
   | Cloud / API / SDK | Official vendor docs for exact version, changelog, migration guide |
   | Regulatory | Primary regulation text, official agency guidance |

6. **Source hierarchy**: primary → secondary → tertiary (tertiary never alone for load-bearing claims).
7. **Cite inline and verify every URL** before publish: use linked short titles at the claim (`([Title](url); accessed YYYY-MM-DD)`), keep the Sources table, and run `construct artifact validate … --type=research-brief --check-links` (see `rules/common/citation.md`). Mark unconfirmed as `[unverified]`.
8. **Tone**: resolve from artifact manifest (`direct`). See `specialists/tone-profiles.json`.
9. **Structure** with `get_template("research-brief")`; write to `.construct/research/{topic-slug}.md`.
10. **Reference** the research doc in the requesting agent's output.

## Distribution (publish pipeline)

After the brief is written, **validate then publish** — the release gate is enforced by default:

```bash
node bin/construct artifact validate .construct/research/{topic-slug}.md --type=research-brief
node bin/construct tools detect --json
node bin/construct publish .construct/research/{topic-slug}.md --strict \
  --demo=resource-guard-rails \
  --dashboard-demo=cockpit-tour
```

Do **not** publish without a passing validate. Do **not** use `--no-gate` in demos or ship paths.

Optional frontmatter in the brief:

```yaml
publish:
  demo: resource-guard-rails
  dashboardDemo: cockpit-tour
```

**Community patterns (do not hand-roll):**

- **Figures in PDF**: fenced ` ```d2` / ` ```mermaid` blocks rendered at export time via vendored [pandoc-ext/diagram](https://github.com/pandoc-ext/diagram) (`construct export --figures` or `construct publish`).
- **Terminal demos**: shipped `.tape` files under `templates/demos/tapes/`; project overrides in `.construct/demos/tapes/`; regenerate with `construct demo record <name>` or CI `charmbracelet/vhs-action`.
- **Dashboard demos**: Playwright `e2e/demo/*.spec.ts` with `video: on` in `apps/dashboard`; run via `cd apps/dashboard && npx playwright test e2e/demo/<name>.spec.ts`.

Install toolchain once: `brew install d2 graphviz pandoc typst vhs` and `npm install -g @mermaid-js/mermaid-cli`. Playwright: `cd apps/dashboard && npm install && npx playwright install chromium`.

Do **not** claim PDF/demo done until `construct tools detect` reports ready or `--strict` publish succeeds.

## Verification bar

- Two independent sources per load-bearing claim unless one authoritative primary suffices.
- Admiralty grades on every source. Counter-evidence named when it exists.
- cx-researcher must **not** answer UX preference questions or infer codebase behavior without reading code.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
