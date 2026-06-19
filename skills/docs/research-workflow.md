---
name: docs-research-workflow
description: "Use when: cx-researcher must investigate external facts — CVEs, APIs, market data, regulations, or vendor behavior."
inputs: [research-question]
artifactType: research-brief
toneDefault: direct
toneAllowed: [direct]
verificationBar: "Every load-bearing claim cites a verifiable primary source; label inference confidence; satisfy template structure requirements."
---
# External Research Workflow

Use when: cx-researcher investigates **external** facts — not user interviews or codebase exploration. For user evidence use `docs/user-research-workflow`; for repo exploration use `docs/codebase-research-workflow`.

Follow [rules/common/research.md](../../rules/common/research.md) as the default policy.

## Steps

1. **Clarify the question**: one specific, falsifiable question the research must answer.
2. **Apply recency discipline**: search from the most recent year backward. For fast-moving domains, treat sources older than 12 months as presumptively stale unless confirmed.
3. **Check internal evidence first**: `.cx/research/`, `.cx/knowledge/`, PRDs, ADRs, runbooks before going external.
4. **Choose authoritative starting points** (external primary only):

   | Domain | Starting points |
   |---|---|
   | AI / LLM / multi-agent | arXiv, ACL Anthology, NeurIPS/ICML/ICLR proceedings |
   | Security / CVEs | NVD, GitHub Security Advisories, OWASP, vendor security blogs |
   | Market / adoption | SEC filings, company announcements, then analyst reports citing primaries |
   | Cloud / API / SDK | Official vendor docs for exact version, changelog, migration guide |
   | Regulatory | Primary regulation text, official agency guidance |

5. **Source hierarchy**: primary → secondary → tertiary (tertiary never alone for load-bearing claims).
6. **Verify every URL** before citing. Mark unconfirmed as `[unverified]`.
7. **Tone**: resolve from artifact manifest (`direct`). See `specialists/tone-profiles.json`.
8. **Structure** with `get_template("research-brief")`; write to `.cx/research/{topic-slug}.md`.
9. **Reference** the research doc in the requesting agent's output.

## Verification bar

- Two independent sources per load-bearing claim unless one authoritative primary suffices.
- Admiralty grades on every source. Counter-evidence named when it exists.
- cx-researcher must **not** answer UX preference questions or infer codebase behavior without reading code.
