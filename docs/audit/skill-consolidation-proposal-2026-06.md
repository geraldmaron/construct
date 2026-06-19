# Skill Consolidation Proposal — 2026-06-19

Gate: **nothing is deleted until the maintainer approves a list.**

Reproduce: `node -e "import('./lib/registry/consolidation.mjs').then(m => console.log(JSON.stringify(m.triageBoundOrphans(),null,2)))"`

## Summary

- **149** skill files on disk
- **97** declared in specialists/registry.json
- **52** registry bound-orphans (not declared by any specialist)
- **52** composer-reachable (B-composer — intentional via prompt composer)
- **0** true orphans (C-merge + D-review — need maintainer action)

## Categories

| Category | Count | Action |
|---|---:|---|
| A-bind | 0 | Wire to specialist in registry |
| B-composer | 52 | Document composer reachability or bind |
| C-merge | 0 | Propose merge into parent role skill |
| D-review | 0 | Manual review |

## B-composer (52)

- `skills/roles/architect.ai-systems.md` — Role flavor for cx-architect — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/architect.data.md` — Role flavor for cx-architect — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/architect.enterprise.md` — Role flavor for cx-architect — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/architect.integration.md` — Role flavor for cx-architect — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/architect.md` — Role flavor for cx-architect — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/architect.platform.md` — Role flavor for cx-architect — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-analyst.experiment.md` — Role flavor for cx-data-analyst — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-analyst.md` — Role flavor for cx-data-analyst — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-analyst.product-intelligence.md` — Role flavor for cx-data-analyst — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-analyst.product.md` — Role flavor for cx-data-analyst — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-analyst.telemetry.md` — Role flavor for cx-data-analyst — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-engineer.pipeline.md` — Role flavor for cx-data-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-engineer.vector-retrieval.md` — Role flavor for cx-data-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/data-engineer.warehouse.md` — Role flavor for cx-data-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/debugger.md` — Role flavor for cx-debugger — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/designer.accessibility.md` — Role flavor for cx-designer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/designer.md` — Role flavor for cx-designer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/engineer.ai.md` — Role flavor for cx-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/engineer.data.md` — Role flavor for cx-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/engineer.md` — Role flavor for cx-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/engineer.platform.md` — Role flavor for cx-engineer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/operator.docs.md` — Profile role "operator" — may load via profile overlay; verify before merge
- `skills/roles/operator.md` — Profile role "operator" — may load via profile overlay; verify before merge
- `skills/roles/operator.release.md` — Profile role "operator" — may load via profile overlay; verify before merge
- `skills/roles/operator.sre.md` — Profile role "operator" — may load via profile overlay; verify before merge
- `skills/roles/orchestrator.md` — Role flavor for cx-orchestrator — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.ai-product.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.business-strategy.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.enterprise.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.growth.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.platform.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/product-manager.product.md` — Role flavor for cx-product-manager — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/qa.ai-eval.md` — Role flavor for cx-qa — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/qa.api-contract.md` — Role flavor for cx-qa — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/qa.data-pipeline.md` — Role flavor for cx-qa — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/qa.md` — Role flavor for cx-qa — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/qa.test-automation.md` — Role flavor for cx-qa — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/qa.web-ui.md` — Role flavor for cx-qa — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/researcher.explorer.md` — Role flavor for cx-researcher — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/researcher.md` — Role flavor for cx-researcher — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/researcher.ux.md` — Role flavor for cx-researcher — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/reviewer.devil-advocate.md` — Role flavor for cx-reviewer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/reviewer.evaluator.md` — Role flavor for cx-reviewer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/reviewer.md` — Role flavor for cx-reviewer — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.ai.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.appsec.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.cloud.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.legal-compliance.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.privacy.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
- `skills/roles/security.supply-chain.md` — Role flavor for cx-security — reachable via prompt-composer; document in registry or bind explicitly
