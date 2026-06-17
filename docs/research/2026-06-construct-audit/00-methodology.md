# Construct Challenge-Everything Audit — Research Methodology

Date: 2026-06-10 · Branch: research/capability-registry · Tracking epic: construct-6zga

## Why this audit exists

Construct has grown to 1 persona, 28 specialists, 150 skills, 50 rules, ~53 hook registrations,
4 profiles, and 6 synced platforms. The maintainer no longer trusts that this shape is justified,
local models struggle in OpenCode today, and platform behavior is hard-coded inline despite an
"agnostic, no hard-coding" principle. This corpus gathers verifiable evidence to either justify or
challenge the current approach, benchmarked against community-respected tools — not frontier-provider
guidance alone.

## Evidence rules (no-fabrication)

- Every load-bearing claim cites a source the reader can re-verify: a URL (with the specific page/path
  inspected) or an absolute repo file path with line numbers.
- Inferences are labeled `INFERENCE:` and separated from cited fact.
- When a fact is not in a source, write `unknown` or `[unverified]` — never invent counts, dates, or
  quotes.
- Internal-audit numbers must be reproducible from a command recorded inline in the doc.

## Per-area document template

Every area section uses these fields:

- **Current** — what Construct does today (cited to repo paths).
- **Proposed** — the change this evidence suggests (becomes a bead in P2).
- **Pros / Cons** — honest trade-offs.
- **Reasoning** — why, tied to evidence.
- **Evidence** — URLs + file paths backing every claim above.
- **Counter-argument** — the strongest case *against* the proposal.
- **Falsified-if** — the concrete observation that would prove the proposal wrong.

## Comparison rubric (six dimensions)

Each external subject and Construct itself is scored on:

1. **Prompt economy** — tokens injected per session at rest; what earns always-on placement vs lazy load.
2. **Tool surface design** — tool count, schema size, dispatcher/gateway patterns, MCP annotation use.
3. **Local-model strategy** — surface degradation for small models, capability gating, context-window handling.
4. **Skill/knowledge architecture** — how knowledge is stored, retrieved, and injected.
5. **Hook/gate philosophy** — count and intent of lifecycle interception points; hard gates vs advisory.
6. **Test strategy** — what layers exist, what they catch, how host integration is tested.

## Document set

| Doc | Scope | Bead |
|---|---|---|
| 10-open-agents.md | aider, Cline/Roo, Goose, OpenHands, smolagents | construct-0oiv |
| 20-opencode-ecosystem.md | OpenCode config/precedence/plugins/local-model handling | construct-hibq |
| 30-specs-standards.md | MCP spec, AGENTS.md, ACP, multi-lab tool guidance | construct-qd8p |
| 40-memory-knowledge.md | mem0, Letta/MemGPT vs our observation/embedding/skills | construct-gd99 |
| 50-proliferation-audit.md | prompt/skill/hook token + value audit (internal) | construct-u27k |
| 60-third-party-strategic-eval.md | per-integration strategic fit (internal) | construct-hmv1 |
| 70-test-infra-verdict.md | escape analysis + test-infra verdict (internal) | construct-fhzv |
| 80-synthesis.md | cross-cutting verdicts feeding P2 decisions | construct-dpad |

## Local-model floor (decided)

First-class target = capable ~14B+/32k-ctx models that probe COHERENT (qwen3-coder, devstral class).
Models that probe COLLAPSED (qwen2.5-coder:7b) get honest capability gating, not heroics. The local
methodology is *allowed to diverge* from the cloud methodology where evidence supports it.
