# Workflow domain preservation (2026-10-17)

Captured before deleting the original manifests. The executable baseline is
`tests/kernel/workflow/fixtures/domain-contracts.json`. Domain bindings are
shallow overrides of workflow fields and individual steps, not new workflows.
The domain key is the bound skill id. Skill manifests remain unchanged; their
required validators are added to the domain step at binding time.

| Former id | Merged id / domain | Validators | Required inputs | Step inputs, tiers, sources |
| --- | --- | --- | --- | --- |
| `architecture-decision-review` | `review` / `system-architecture` | preserved at every step | `target` preserved | identical |
| `delivery-plan-review` | `review` / `program-delivery` | preserved at every step | `target` preserved | identical |
| `experience-review` | `review` / `experience-design` | preserved at every step | `target` preserved | identical |
| `governance-issue-spotting` | `review` / `governance-risk` | preserved at every step | `target` preserved | identical |
| `implementation-review` | `review` / `software-engineering` | preserved at every step | `target` preserved | identical |
| `operational-readiness-review` | `review` / `operations-reliability` | preserved at every step | `target` preserved | identical |
| `product-requirements-review` | `review` / `product-management` | preserved at every step | `target` preserved | identical |
| `security-privacy-review` | `review` / `security-privacy` | preserved at every step | `target` preserved | identical |
| `strategy-execution-review` | `review` / `strategy-research` | preserved at every step | `target` preserved | identical |
| `prd-authoring` | `authoring` / `requirements-structuring` | preserved at every step | `request`, `target` preserved | identical |
| `proposal-authoring` | `authoring` / `decision-framing` | preserved at every step | `request`, `target`, `audience` preserved | identical |
| `rfc-authoring` | `authoring` / `system-architecture` | preserved at every step | `request`, `target` preserved | identical |
| `research-brief` | `authoring` / `investigative-research` | preserved at every step | `question` preserved | identical after synthesize → draft reference rename |

No validator, required input, step input, tier, source, capability, output,
retry, timeout, trigger, concurrency rule or deliverable schema was removed.
Research new runs rename `synthesize` to `draft` and rewrite its references;
saved runs retain frozen steps. Every binding adds a `domain` input and includes
it in deduplication. Existing aliases infer it; a contradictory domain is refused.

Removal search: `rg` across src, scripts, tests and docs found no production
loader of `workflows/remember`. A registry test expected it to resolve; that
assertion is changed to assert absence. The remember tool writes directly
through the service and creates no workflow run. Historical evidence is kept.

## Detailed contracts

The left side is the captured original; the right side is the actual merged
binding returned by the registry. Unchanged lists are written once as `same`.

### architecture-decision-review → review / system-architecture

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### delivery-plan-review → review / program-delivery

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"jira","freshness":"any","required":false},{"kind":"docs","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete","no_velocity_as_capacity"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### experience-review → review / experience-design

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### governance-issue-spotting → review / governance-risk

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"docs","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### implementation-review → review / software-engineering

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### operational-readiness-review → review / operations-reliability

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### product-requirements-review → review / product-management

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"docs","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### security-privacy-review → review / security-privacy

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### strategy-execution-review → review / strategy-research

- Input schema: {"target":"string","scope":"string"} → {"target":"string","scope":"string","domain":"string"}
- Required inputs: ["target"] → ["target","domain"]
- gather:
  - Validators: ["citations_present","reference_coverage"] (same)
  - Inputs: {"target":"input.target"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"docs","freshness":"fresh","required":true},{"kind":"jira","freshness":"fresh","required":false},{"kind":"hris","freshness":"fresh","required":false}] (same)
- checks:
  - Validators: ["evidence_refs_resolve"] (same)
  - Inputs: {"material":"steps.gather.material"} (same)
  - Tier: "observe" (same)
  - Sources: [] (same)
- review:
  - Validators: ["citations_present","no_uncited_material_findings","deliverable_complete","no_velocity_as_capacity"] (same)
  - Inputs: {"material":"steps.gather.material","target":"steps.gather.targetSummary","deterministic":"steps.checks.findings","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"review":"steps.review.findings","escalations":"steps.review.escalations","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### prd-authoring → authoring / requirements-structuring

- Input schema: {"request":"string","target":"string","template":"string"} → {"request":"string","target":"string","template":"string","domain":"string"}
- Required inputs: ["request","target"] → ["request","target","domain"]
- gather:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","superseded_acknowledged","conflicts_declared","settled_not_contradicted","deliverable_complete","reference_coverage"] (same)
  - Inputs: {"request":"input.request","template":"input.template"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false},{"kind":"jira","freshness":"any","required":false}] (same)
- draft:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","evidence_recorded","superseded_acknowledged","artifacts_exist","numbers_grounded","template_conformance","settled_not_contradicted","deliverable_complete"] (same)
  - Inputs: {"request":"input.request","target":"input.target","template":"input.template","material":"steps.gather.material","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)
- challenge:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"artifact":"steps.draft.artifact","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema","artifacts_exist"] (same)
  - Inputs: {"artifact":"steps.draft.artifact","verdict":"steps.challenge.verdict"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### proposal-authoring → authoring / decision-framing

- Input schema: {"request":"string","target":"string","template":"string","audience":"string","decisionBy":"string"} → {"request":"string","target":"string","template":"string","audience":"string","decisionBy":"string","domain":"string"}
- Required inputs: ["request","target","audience"] → ["request","target","audience","domain"]
- gather:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","superseded_acknowledged","conflicts_declared","settled_not_contradicted","deliverable_complete","reference_coverage"] (same)
  - Inputs: {"request":"input.request","template":"input.template"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false},{"kind":"jira","freshness":"any","required":false}] (same)
- draft:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","evidence_recorded","superseded_acknowledged","artifacts_exist","numbers_grounded","template_conformance","deliverable_complete","settled_not_contradicted","decision_ask_present"] (same)
  - Inputs: {"request":"input.request","target":"input.target","template":"input.template","material":"steps.gather.material","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns","audience":"input.audience","decisionBy":"input.decisionBy"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)
- challenge:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"artifact":"steps.draft.artifact","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema","artifacts_exist"] (same)
  - Inputs: {"artifact":"steps.draft.artifact","verdict":"steps.challenge.verdict"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### rfc-authoring → authoring / system-architecture

- Input schema: {"request":"string","target":"string","template":"string"} → {"request":"string","target":"string","template":"string","domain":"string"}
- Required inputs: ["request","target"] → ["request","target","domain"]
- gather:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","superseded_acknowledged","conflicts_declared","settled_not_contradicted","deliverable_complete","reference_coverage"] (same)
  - Inputs: {"request":"input.request","template":"input.template"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false},{"kind":"jira","freshness":"any","required":false}] (same)
- draft:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","evidence_recorded","superseded_acknowledged","artifacts_exist","numbers_grounded","template_conformance","settled_not_contradicted","deliverable_complete"] → ["citations_present","evidence_refs_resolve","excerpts_match","evidence_recorded","superseded_acknowledged","artifacts_exist","numbers_grounded","template_conformance","settled_not_contradicted","deliverable_complete","no_uncited_material_findings"]
  - Inputs: {"request":"input.request","target":"input.target","template":"input.template","material":"steps.gather.material","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)
- challenge:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"artifact":"steps.draft.artifact","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema","artifacts_exist"] (same)
  - Inputs: {"artifact":"steps.draft.artifact","verdict":"steps.challenge.verdict"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)

### research-brief → authoring / investigative-research

- Input schema: {"question":"string","scope":"string","target":"string","period":"period","sources":"source_ids"} → {"question":"string","scope":"string","target":"string","period":"period","sources":"source_ids","domain":"string"}
- Required inputs: ["question"] → ["question","domain"]
- gather:
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","within_period","named_sources_read","conflicts_declared","deliverable_complete","reference_coverage"] (same)
  - Inputs: {"question":"input.question","scope":"input.scope","target":"input.target","period":"input.period","sources":"input.sources"} (same)
  - Tier: "observe" (same)
  - Sources: [{"kind":"directory","freshness":"any","required":false},{"kind":"jira","freshness":"any","required":false},{"kind":"docs","freshness":"any","required":false}] (same)
- draft (formerly synthesize):
  - Validators: ["citations_present","evidence_refs_resolve","excerpts_match","within_period","sources_diverse","numbers_grounded","superseded_acknowledged","no_uncited_material_findings","settled_not_contradicted","deliverable_complete"] (same)
  - Inputs: {"question":"input.question","target":"input.target","findings":"steps.gather.findings","conflicts":"steps.gather.conflicts","unknowns":"steps.gather.unknowns"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)
- challenge:
  - Validators: ["citations_present","evidence_refs_resolve","within_period","no_uncited_material_findings","deliverable_complete"] (same)
  - Inputs: {"summary":"steps.draft.summary","findings":"steps.draft.findings"} (same)
  - Tier: "draft" (same)
  - Sources: [] (same)
- record:
  - Validators: ["schema"] (same)
  - Inputs: {"summary":"steps.draft.summary","verdict":"steps.challenge.verdict","artifact":"steps.draft.artifact"} (same)
  - Tier: "project_write" (same)
  - Sources: [] (same)
