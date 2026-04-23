# Doc Templates & Role Anti-Patterns

See `../prompt-surfaces.md` for the canonical public-vs-internal prompt surface model. This document covers only templates and internal role overlays.

Construct specialists produce standard documents (PRDs, ADRs, runbooks, memos, etc.) from shared templates, and they self-check against shared role anti-patterns. Both can be overridden per-project.

## Templates

Shipped templates live in [`templates/docs/`](../../templates/docs/):

| Template | Produced by | Purpose |
|---|---|---|
| `prd.md` | cx-product-manager | Product requirements doc |
| `meta-prd.md` | cx-product-manager, cx-docs-keeper | Requirements for product operating systems, agent workflows, document standards, and evaluation loops |
| `prfaq.md` | cx-product-manager, cx-business-strategist | Working-backwards press release and FAQ |
| `evidence-brief.md` | cx-product-manager, cx-ux-researcher, cx-researcher | Product evidence synthesis before decisions |
| `signal-brief.md` | cx-product-manager, cx-researcher | Weak or emerging product signal preservation |
| `customer-profile.md` | cx-product-manager, cx-docs-keeper | Durable customer/account product memory |
| `product-intelligence-report.md` | cx-product-manager, cx-business-strategist | Cross-source product intelligence synthesis |
| `backlog-proposal.md` | cx-product-manager | Approval-gated external tracker proposal |
| `memo.md` | cx-business-strategist | Strategy memo (~1 page) |
| `one-pager.md` | cx-product-manager, cx-business-strategist | Executive one-pager |
| `adr.md` | cx-architect, cx-rd-lead | Architecture decision record |
| `research-brief.md` | cx-researcher, cx-ux-researcher, cx-explorer | Research findings |
| `runbook.md` | cx-sre, cx-operations | Operational runbook |
| `incident-report.md` | cx-sre, cx-operations, cx-release-manager | Post-mortem |

### How specialists use them

Each specialist prompt points to the template via an MCP call:

```markdown
**Template**: call `get_template("prd")` when drafting a product PRD, or `get_template("meta-prd")` when drafting a Meta PRD, ...
```

The `get_template(name)` MCP tool (see [`lib/mcp/server.mjs`](../../lib/mcp/server.mjs)) resolves:

1. `.cx/templates/docs/{name}.md` — **project override** (preferred if present)
2. `templates/docs/{name}.md` — **shipped default** (fallback)

Use `list_templates` to see both shipped and overridden names.

### Overriding a template

Drop a file at `.cx/templates/docs/{name}.md` inside your project. That's it — next time a specialist drafts that doc type, they'll pick up your version. No sync, no restart.

Example: reshape the PRD to lead with success metrics:

```bash
mkdir -p .cx/templates/docs
cp templates/docs/prd.md .cx/templates/docs/prd.md
# edit .cx/templates/docs/prd.md to your shape
```

Ask Construct for a PRD; it'll follow the new shape.

## Role Anti-Patterns

Each specialist is cognitively rooted in a **role** (product-manager, engineer, architect, etc.) with a core set of failure modes to avoid. Flavored specialists extend the core with an overlay.

Core roles live in [`skills/roles/`](../../skills/roles/):

| Core role | Flavors | Applied to |
|---|---|---|
| `engineer` | `engineer.ai`, `engineer.data`, `engineer.platform` | cx-engineer, cx-ai-engineer, cx-data-engineer, cx-platform-engineer |
| `reviewer` | `reviewer.devil-advocate`, `reviewer.evaluator`, `reviewer.trace` | cx-reviewer, cx-devil-advocate, cx-evaluator, cx-trace-reviewer |
| `researcher` | `researcher.ux`, `researcher.explorer` | cx-researcher, cx-ux-researcher, cx-explorer |
| `operator` | `operator.sre`, `operator.release`, `operator.docs` | cx-sre, cx-release-manager, cx-operations, cx-docs-keeper |
| `product-manager` | `product-manager.product`, `product-manager.platform`, `product-manager.enterprise`, `product-manager.ai-product`, `product-manager.growth`, `product-manager.business-strategy` | cx-product-manager, cx-business-strategist |
| `designer` | `designer.accessibility` | cx-designer, cx-accessibility |
| `security` | `security.legal-compliance` | cx-security, cx-legal-compliance |
| `qa` | `qa.test-automation` | cx-qa, cx-test-automation |
| `architect` | — | cx-architect, cx-rd-lead |
| `debugger` | — | cx-debugger |
| `data-analyst` | — | cx-data-analyst |
| `orchestrator` | — | cx-orchestrator |

### How they're loaded

Unlike templates, role anti-patterns are **inlined at sync time** (not fetched at runtime). The specialist source prompt carries a marker:

```markdown
**Anti-patterns**: call `get_skill("roles/engineer.ai")` before drafting.
```

`construct sync` (via [`lib/role-preload.mjs`](../../lib/role-preload.mjs)) replaces that line with the full core role body + flavor overlay under `## Role anti-patterns`. The content is always present in the final platform prompt — no runtime dependency, no chance for the model to skip the pre-work.

### Editing or adding roles

- **Edit a role**: change the file under `skills/roles/`, then run `construct sync` to propagate to all platforms.
- **Add a flavor**: create `skills/roles/{core}.{flavor}.md` with YAML frontmatter:
  ```yaml
  ---
  role: {core}.{flavor}
  applies_to: [cx-...]
  inherits: {core}
  version: 1
  ---
  ```
  Update the corresponding `cx-*.md` source prompt to reference the new flavor name, then `construct sync`.
- **No project-level override for roles** today — roles are platform-wide and curated. If you need per-project role overrides, open a request.

## Verification

After editing either surface, run:

```bash
npm test                 # tests/agent-prompts.test.mjs covers both
node sync-agents.mjs     # regenerate platform adapters
construct doctor         # health check
```

Spot-check propagation:

```bash
grep -l "## Role anti-patterns" ~/.claude/agents/cx-*.md
```
