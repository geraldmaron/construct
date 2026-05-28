---
title: Policy Architecture
description: How Construct enforces rules — the three-layer model, coverage table, and why OPA/Cedar are not used.
---

# Policy Architecture

Construct enforces behavior across three layers. Each layer is a different tradeoff between cost and coverage.

## The three-layer model

```
Layer 1: JSON manifests     — declarative truth
Layer 2: Validation modules — deterministic checks at known boundaries
Layer 3: Hooks              — enforcement at runtime events
```

### Layer 1 — JSON manifests (declarative truth)

Two files own the behavioral contract:

- **`specialists/registry.json`** — every specialist's allowed tools, skills, model tier, and collaborator set. Consumed by every platform sync (Claude Code, Codex, Copilot, OpenCode).
- **`specialists/role-manifests.json`** — file-path fences and action allowlists per role. If a specialist is not in the allowlist, the action is blocked.

JSON manifests are the single source of truth. When CI runs `construct lint:agents`, it validates the registry against its schema. Platform files are generated from the registry, not the reverse.

### Layer 2 — Validation modules (deterministic checks)

Validation runs at known decision points:

| Module | When it runs | What it checks |
|---|---|---|
| `lib/roles/fence.mjs` | Every specialist action | Path-fence and action-allowlist compliance |
| `lib/comment-lint.mjs` | PostToolUse + CI | Comment form, artifact fabrication risk patterns |
| `lib/contracts/validate.mjs` | lint:contracts, handoff | Contract schema + postconditions + beads close-reason |
| `lib/docs-verify.mjs` | docs:verify | Docs freshness, context invariant, intake traceability |
| `lib/gates-audit.mjs` | gates:audit CI step | Cross-surface gate coverage gaps |

Validation modules return structured results and are pure: no side effects, no LLM calls.

### Layer 3 — Hooks (enforcement at runtime events)

Hooks intercept events at the Claude Code harness boundary:

| Hook | Event | Enforcement |
|---|---|---|
| `lib/hooks/guard-bash.mjs` | PreToolUse: Bash | Blocks destructive command patterns |
| `lib/hooks/scan-secrets.mjs` | PreToolUse: Write/Edit | Scans added lines for credential patterns |
| `lib/hooks/pre-push-gate.mjs` | PreToolUse: git push | Runs test + build + lint + docs gates |
| `lib/hooks/policy-engine.mjs` | PostToolUse | Bootstrap state machine; blocks out-of-sequence actions |
| `lib/hooks/comment-lint.mjs` | PostToolUse | Warns on fabrication risk in artifact prose |
| `lib/hooks/mcp-audit.mjs` | All MCP tool calls | Logs every tool invocation; enforces rate limits |

Hooks can only warn (exit 0) or block (exit 2). They never modify the tool's output.

## Coverage table

| Policy | Source file | Enforcement file | Mode |
|---|---|---|---|
| File-path fence | `specialists/role-manifests.json` | `lib/roles/fence.mjs#checkAction` | Deterministic (100%) |
| Action approval | `specialists/role-manifests.json` | `lib/roles/fence.mjs#checkAction` | Deterministic (100%) |
| Anti-fabrication | `rules/common/no-fabrication.md` | `lib/comment-lint.mjs` | Deterministic (~85%) |
| Release gates | `rules/common/release-gates.md` | `lib/hooks/pre-push-gate.mjs` | Deterministic (95%) |
| Contract postconditions | `specialists/contracts.json` | `lib/contracts/validate.mjs` | Deterministic (100%) |
| Bash safety | built-in | `lib/hooks/guard-bash.mjs` | Deterministic (100%) |
| Bootstrap state | built-in | `lib/hooks/policy-engine.mjs` | Deterministic (100%) |
| Secret scan | built-in | `lib/hooks/scan-secrets.mjs` | Deterministic (100%) |
| Beads close-reason | `rules/common/beads-hygiene.md` | `lib/contracts/validate.mjs#validateBeadsCloseReason` | Deterministic |
| Commit approval | `rules/common/commit-approval.md` | (persona prompt) | Honor-system |
| Framing | `rules/common/framing.md` | (persona prompt) | Honor-system |
| Research evidence | `rules/common/research.md` | (persona prompt) | Honor-system |
| Doc ownership | `rules/common/doc-ownership.md` | (persona prompt) | Honor-system |

Full policy list: `construct policy show`

## Why not OPA or Cedar?

OPA (Open Policy Agent) and Cedar are purpose-built policy engines. For Construct's scale (5-50 specialists), the cost-benefit is negative:

- **Learning curve**: both require a policy language (Rego or Cedar) that no one on a typical product team already knows. Maintenance becomes a specialist task.
- **Runtime overhead**: an OPA or Cedar evaluation path for every tool call adds latency and a new infrastructure dependency.
- **Coverage**: Construct's existing three-layer model covers ~85% of enforcement deterministically. The remaining ~15% (commit approval, framing, research evidence) are honor-system by design — they require conversational judgment that no policy engine can substitute.
- **Precedent**: the 2025-2026 frontier for LLM-agent authorization uses LLM-assisted policy *generation* rather than replacing built-in layered models. Construct's JSON manifest + validation module approach aligns with this direction.

The right investment is to document the existing model (this document) and promote the few remaining honor-system rules that can be mechanically enforced — which is exactly what the beads close-reason validator (K2) does.

Sources: [Oso: OPA vs Cedar vs Zanzibar](https://www.osohq.com/learn/opa-vs-cedar-vs-zanzibar), [Permit.io: OPA vs Cedar](https://www.permit.io/blog/opa-vs-cedar).

## Enforcement modes

- **Deterministic (100%)**: a machine check that cannot be bypassed in normal operation. The action is blocked or the artifact is rejected.
- **Deterministic (~N%)**: a pattern-based check with known false-negative rate. The patterns cover the most common failure modes; adversarial bypasses exist but require intent.
- **Honor-system**: enforced at the conversation level by the persona prompt. Relies on the model following its instructions. Not a security boundary; a quality boundary.

The distinction matters when you're deciding where to invest. Converting honor-system rules to deterministic requires either a reliable pattern (cheap) or an LLM call (expensive and introduces the LLM-as-judge circularity problem).
