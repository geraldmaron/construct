<!--
docs/guides/concepts/doc-visual-matrix.md — required structure and visuals per document type.
The enforced subset is encoded in lib/templates/visual-requirements.mjs and pinned
by tests/template-visuals.test.mjs; this page is the human-readable rationale.
-->
# Document structure and visual matrix

A document that exists only as prose hides its decision logic, its timeline, and its interactions. Each document type below names the structure it must carry and the visual that makes it legible. The **Enforced** column marks what `lib/templates/visual-requirements.mjs` checks today; the rest are recommended and will be promoted to enforced as the templates gain scaffolding.

Modern practice is consistent on two points: a diagram should show the happy path and at least one error path, and diagrams belong in version control next to the text they describe — which is why every visual here is Mermaid, not an image. See [Mermaid in technical documentation](https://hanyouqing.com/blog/2025/08/mermaid-diagram-guide/) and [version-controlled architecture diagrams](https://medium.com/@aferdousahmed/stop-fighting-draw-io-use-mermaid-for-architecture-diagrams-you-can-version-control-bfaaa217a064).

| Doc type | Required visual | Mermaid kind / table | Rationale | Enforced |
|----------|-----------------|----------------------|-----------|----------|
| runbook | Diagnostic decision tree | `flowchart` | A troubleshooting flowchart lets an operator branch to a fix faster than ordered prose. [src](https://www.lucidchart.com/blog/incident-management-process) | yes |
| incident-report | Event timeline | table `Time (UTC) \| Event` (or `timeline`) | A timeline reconstructs detection→mitigation→all-clear at a glance. [src](https://edrawmind.wondershare.com/timeline/how-to-make-timeline-with-mermaid.html) | yes |
| rfc | Proposed-behavior sequence | `sequenceDiagram` | A sequence diagram makes interactions explicit and cuts "what about this edge case?" review churn; include an error path. [src](https://simplemermaid.com/guides/use-cases.html) | yes |
| adr | Context / decision diagram | `flowchart` or `graph` | Shows how the decision sits among components and alternatives. | recommended |
| prd / prd-platform | User flow + metrics table | `flowchart` + table | A flow makes the user journey concrete; a metrics table pins success criteria. | recommended |
| architecture / concepts | Component or C4 diagram | `flowchart` / `C4Context` | Pairs a structural view with the common user flow. [src](https://docs.structurizr.com/export/mermaid) | recommended |
| strategy | Roadmap or bet matrix | `timeline` / table | Sequences bets and time horizons. | recommended |
| test-plan | Coverage / flow matrix | table | Maps scenarios to what they verify. | recommended |

## How enforcement works

Each enforced row is a postcondition (`artifact-has-mermaid` by kind, or `artifact-table-has-columns`) in `lib/templates/visual-requirements.mjs`, evaluated by the same `validateArtifactPostconditions` engine that checks contract handoffs. The shipped template for each enforced type carries the visual as scaffolding, and `tests/template-visuals.test.mjs` fails if a template ever drops it — so the matrix and the templates cannot diverge.

## References

- [Complete guide to Mermaid diagrams in technical documentation](https://hanyouqing.com/blog/2025/08/mermaid-diagram-guide/)
- [ITIL incident management process](https://www.lucidchart.com/blog/incident-management-process)
- [Mermaid diagram use cases (RFC/ADR/architecture)](https://simplemermaid.com/guides/use-cases.html)
- [Version-controlled architecture diagrams with Mermaid](https://medium.com/@aferdousahmed/stop-fighting-draw-io-use-mermaid-for-architecture-diagrams-you-can-version-control-bfaaa217a064)
