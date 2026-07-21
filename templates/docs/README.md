# Doc Templates & Role Anti-Patterns

See [prompt surfaces](../../docs/guides/concepts/prompt-surfaces.mdx) for the canonical public-vs-internal prompt surface model. This document covers only templates and internal perspectives.

Construct Worker Profiles produce standard documents (PRDs, ADRs, runbooks, memos, etc.) from shared templates, and they self-check against shared perspective anti-patterns. Both can be overridden per-project.

## Templates

Shipped templates live in [`templates/docs/`](../../templates/docs/):

| Layer | Path | Purpose |
|---|---|---|
| Shipped default | `templates/docs/{name}.md` | Canonical shape for `get_template()` MCP |
| Init lane starters | `docs/{lane}/templates/` | Copied into downstream projects by `construct init --docs-preset=*` |
| Project override | `.construct/templates/docs/{name}.md` | Per-project template override at fetch time |

Do not duplicate starters at `docs/{lane}/_template.md` — lane READMEs link only to `./templates/`.

| Template | Author Worker Profile | Purpose |
|---|---|---|
| `prd.md` | product-manager | Product requirements doc |
| `meta-prd.md` | product-manager, docs-keeper | Requirements for product operating systems, agent workflows, document standards, and evaluation loops |
| `prfaq.md` | product-manager, business-strategist | Working-backwards press release and FAQ |
| `evidence-brief.md` | product-manager, ux-researcher, researcher | Product evidence synthesis before decisions |
| `signal-brief.md` | product-manager, researcher | Weak or emerging product signal preservation |
| `customer-profile.md` | product-manager, docs-keeper | Durable customer/account product memory |
| `product-intelligence-report.md` | product-manager, business-strategist | Cross-source product intelligence synthesis |
| `backlog-proposal.md` | product-manager | Approval-gated external tracker proposal |
| `memo.md` | business-strategist | Strategy memo (~1 page) |
| `one-pager.md` | product-manager, business-strategist | Executive one-pager |
| `adr.md` | architect, rd-lead | Architecture decision record |
| `research-brief.md` | researcher, ux-researcher, explorer | Research findings |
| `runbook.md` | sre, operations | Operational runbook |
| `incident-report.md` | sre, operations, release-manager | Post-mortem |

### How Worker Profiles use them

Each Worker Profile prompt points to the template via an MCP call:

```markdown
**Template**: call `get_template("prd")` when drafting a product PRD, or `get_template("meta-prd")` when drafting a Meta PRD, ...
```

The `get_template(name)` MCP tool (see [`lib/mcp/server.mjs`](../../lib/mcp/server.mjs)) resolves:

1. `.construct/templates/docs/{name}.md`: **project override** (preferred if present)
2. `templates/docs/{name}.md`: **shipped default** (fallback)

Use `list_templates` to see both shipped and overridden names.

### Overriding a template

Drop a file at `.construct/templates/docs/{name}.md` inside your project. That's it: next time a Worker Profile drafts that doc type, they'll pick up your version. No sync, no restart.

Example: reshape the PRD to lead with success metrics:

```bash
mkdir -p .construct/templates/docs
cp templates/docs/prd.md .construct/templates/docs/prd.md
# edit .construct/templates/docs/prd.md to your shape
```

Ask Construct for a PRD; it'll follow the new shape.

### Registering a new document class

Overriding a template reshapes an *existing* class. To generate a class the builtin manifest never registered, register it — this writes the template plus a project-tier manifest overlay, and never touches the builtin `registry/artifact-manifest.json`:

```bash
construct templates register convergence-brief \
  --description "Cross-project strategy convergence brief" \
  [--from .construct/templates/docs/convergence-brief.md]
```

That writes `.construct/templates/docs/convergence-brief.md` (a starter, or your `--from` file) and adds `convergence-brief` to `.construct/artifact-manifest.overlay.json`. The overlay merges over the builtin by three tiers (builtin → user `~/.config/construct/` → project `.construct/`), so the registered class now resolves everywhere: `get_template("convergence-brief")` returns the project override, and `author_artifact {type:"convergence-brief", ...}` drafts from it and runs the release gate. A registered class inherits memo-like author/reviewer defaults; override them (including `outputDir`) by editing its overlay entry.

### One-off adhoc documents

For a genuinely one-off document with no fixed shape, skip registration entirely and use the sanctioned `adhoc` type:

```
author_artifact {type:"adhoc", title:"Q3 strategy convergence", instructions:"..."}
```

`adhoc` needs an explicit `title` and `instructions`; its structure follows the instructions, but it still runs the full release gate — free-form structure, not free-form quality. It is not a bypass for a registered class: naming a known type through `adhoc` is redirected to that class. An unknown, unregistered non-adhoc class still returns a classification/registration prompt rather than becoming a PRD.

## Role Anti-Patterns

Each Worker Profile is cognitively rooted in a **role** (product-manager, engineer, architect, etc.) with a core set of failure modes to avoid. Flavored profiles extend the core with an overlay.

Core roles live in [`skills/perspectives/`](../../skills/perspectives/):

| Core role | Flavors | Applied to |
|---|---|---|
| `engineer` | `engineer.ai`, `engineer.data`, `engineer.platform` | engineer, ai-engineer, data-engineer, platform-engineer |
| `reviewer` | `reviewer.devil-advocate`, `reviewer.evaluator`, `reviewer.trace` | reviewer, devil-advocate, evaluator, trace-reviewer |
| `researcher` | `researcher.ux`, `researcher.explorer` | researcher, ux-researcher, explorer |
| `operator` | `operator.sre`, `operator.release`, `operator.docs` | sre, release-manager, operations, docs-keeper |
| `product-manager` | `product-manager.product`, `product-manager.platform`, `product-manager.enterprise`, `product-manager.ai-product`, `product-manager.growth`, `product-manager.business-strategy` | product-manager, business-strategist |
| `designer` | `designer.accessibility` | designer, accessibility |
| `security` | `security.legal-compliance` | security, legal-compliance |
| `qa` | `qa.test-automation` | qa, test-automation |
| `architect` |: | architect, rd-lead |
| `debugger` |: | debugger |
| `data-analyst` |: | data-analyst |
| `orchestrator` |: | orchestrator |

### How they're loaded

Unlike templates, perspective anti-patterns are **inlined at sync time** (not fetched at runtime). The Worker Profile source prompt carries a marker:

```markdown
**Anti-patterns**: call `get_skill("perspectives/engineer.ai")` before drafting.
```

`construct sync` (via [`lib/role-preload.mjs`](../../lib/role-preload.mjs)) replaces that line with the full core role body + flavor overlay under `## Role anti-patterns`. The content is always present in the final platform prompt: no runtime dependency, no chance for the model to skip the pre-work.

### Editing or adding roles

- **Edit a role**: change the file under `skills/perspectives/`, then run `construct sync` to propagate to all platforms.
- **Add a flavor**: create `skills/perspectives/{core}.{flavor}.md` with YAML frontmatter:
  ```yaml
  ---
  role: {core}.{flavor}
  applies_to: [worker-profile-id]
  inherits: {core}
  version: 1
  ---
  ```
  Update the corresponding Worker Profile source prompt to reference the new flavor name, then `construct sync`.
- **No project-level override for roles** today: roles are platform-wide and curated. If you need per-project role overrides, open a request.

## Verification

After editing either surface, run:

```bash
npm test                 # tests/agent-prompts.test.mjs covers both
node scripts/sync-agents.mjs   # regenerate platform adapters
construct doctor         # health check
```

Spot-check propagation:

```bash
grep -l "## Role anti-patterns" ~/.claude/agents/*.md
```
