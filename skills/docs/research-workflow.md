---
name: docs-research-workflow
description: "Use when: cx-researcher must investigate external facts — CVEs, APIs, market data, regulations, or vendor behavior."
inputs: [research-question]
artifactType: research-brief
toneDefault: direct
toneAllowed: [direct]
verificationBar: "Every load-bearing claim cites a verifiable primary source; label inference confidence; satisfy template structure requirements."
triggers: ["research brief", "user research"]
---
# External Research Workflow

Use when: cx-researcher investigates **external** facts — not user interviews or codebase exploration. For user evidence use `docs/user-research-workflow`; for repo exploration use `docs/codebase-research-workflow`.

Follow [rules/common/research.md](../../rules/common/research.md) as the default policy.

## Steps

1. **Clarify the question**: one specific, falsifiable question the research must answer.
2. **Apply recency discipline**: search from the most recent year backward. For fast-moving domains, treat sources older than 12 months as presumptively stale unless confirmed.
3. **Check internal evidence first**: `.cx/research/`, `.cx/knowledge/`, PRDs, ADRs, runbooks before going external.
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
7. **Verify every URL** before citing. Mark unconfirmed as `[unverified]`.
8. **Tone**: resolve from artifact manifest (`direct`). See `specialists/tone-profiles.json`.
9. **Structure** with `get_template("research-brief")`; write to `.cx/research/{topic-slug}.md`.
10. **Reference** the research doc in the requesting agent's output.

## Distribution (publish pipeline)

After the brief is written, **validate then publish** — the release gate is enforced by default:

```bash
node bin/construct artifact validate .cx/research/{topic-slug}.md --type=research-brief
node bin/construct tools detect --json
node bin/construct publish .cx/research/{topic-slug}.md --strict \
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
- **Terminal demos**: shipped `.tape` files under `templates/demos/tapes/`; project overrides in `.cx/demos/tapes/`; regenerate with `construct demo record <name>` or CI `charmbracelet/vhs-action`.
- **Dashboard demos**: Playwright `e2e/demo/*.spec.ts` with `video: on` in `apps/dashboard`; run via `construct demo dashboard:<name>`.

Install toolchain once: `brew install d2 graphviz pandoc typst vhs` and `npm install -g @mermaid-js/mermaid-cli`. Playwright: `cd apps/dashboard && npm install && npx playwright install chromium`.

Do **not** claim PDF/demo done until `construct tools detect` reports ready or `--strict` publish succeeds.

## Verification bar

- Two independent sources per load-bearing claim unless one authoritative primary suffices.
- Admiralty grades on every source. Counter-evidence named when it exists.
- cx-researcher must **not** answer UX preference questions or infer codebase behavior without reading code.
