/**
 * lib/mcp/tool-definitions-workflow.mjs — raw tool schemas: publish, workflow lifecycle, orchestration run/status/readiness.
 *
 * Pure data: name/description/inputSchema/outputSchema for a slice of the
 * hardcoded (non-self-registered) MCP tool catalog. Split out of
 * lib/mcp/tool-definitions.mjs (which itself was split out of
 * lib/mcp/server.mjs) purely to keep each file under the ~600-line
 * house limit — no behavior differs from one combined array.
 * lib/mcp/server.mjs concatenates every slice and applies
 * withSafetyEnvelope (lib/mcp/tool-safety.mjs) at load time.
 */
import { MODEL_TIERS } from '../model-tiers.mjs';

// One task entry from shapeRun (lib/mcp/tools/orchestration-run.mjs) — shared
// by orchestration_run and orchestration_status, whose responses both embed
// a tasks[] array in the same shape. system/user/provenanceSource only appear
// on a host-backend task; additionalProperties stays true so a future field
// is never rejected by a strict validator.

const ORCHESTRATION_TASK_SCHEMA = {
  type: 'object',
  required: ['id', 'role', 'status'],
  properties: {
    id: { type: 'string' },
    role: { type: 'string' },
    status: { type: 'string', description: 'e.g. queued, prepared, running, done, failed, awaiting-host.' },
    executor: { type: ['string', 'null'] },
    recruited: { type: 'boolean' },
    contractStatus: { type: 'string' },
    contractId: { type: ['string', 'null'] },
    contractViolations: { type: 'array' },
    output: { type: ['string', 'null'] },
    reasoning: { type: ['string', 'null'] },
    error: { type: ['object', 'null'] },
    webCapability: { type: ['string', 'null'] },
    webEvidence: { type: ['array', 'null'] },
    webSearchRequests: { type: 'number' },
    system: { type: 'string', description: 'Host-backend only: this task\'s materialized persona/system prompt.' },
    user: { type: 'string', description: 'Host-backend only: this task\'s materialized user turn.' },
    provenanceSource: { type: 'string', description: 'Present only on a host-reported result (e.g. "host-reported") — never on a construct-verified provider execution.' },
    evidenceGate: { type: 'object' },
  },
  additionalProperties: true,
};

// The shapeRun read-model both orchestration_run (wait=true) and
// orchestration_status return. `specialists` is the REAL, dispatched role
// list — authoritative and may be empty even when routePath.specialistSequence
// is not: that field can carry an informational/hypothetical route the track
// classifier considered but did not dispatch.

const ORCHESTRATION_RUN_SHAPE_SCHEMA = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    status: { type: 'string', description: 'planned | completed | completed-with-failures | completed-prepare-only | awaiting-host | degraded | cancelled | error.' },
    message: { type: 'string', description: 'Present on completed-prepare-only and RECRUITED-NOT-EXECUTED runs — the loud, honest disclosure a caller must not skip.' },
    prepareOnly: { type: 'boolean' },
    runMode: { type: ['string', 'null'] },
    semantics: { type: ['string', 'null'] },
    executionMode: { type: 'string' },
    degraded: { type: 'boolean' },
    degradationReason: { type: ['string', 'null'] },
    intent: { type: ['string', 'null'] },
    track: { type: ['string', 'null'] },
    suggestedWorkflowType: { type: ['string', 'null'] },
    researchExecutionPolicy: { type: ['object', 'null'] },
    specialists: { type: 'array', items: { type: 'string' }, description: 'Real dispatched roles — authoritative over routePath.specialistSequence.' },
    participation: { type: 'array' },
    contextBindings: { type: 'array' },
    routePath: { type: ['object', 'null'] },
    tasks: { type: 'array', items: ORCHESTRATION_TASK_SCHEMA },
    recruitmentHonesty: { type: 'object', description: 'Present when a recruited participant never executed.' },
    hostInstructions: { type: 'string', description: 'Present only when status is awaiting-host — loop instructions for the calling host.' },
    error: { type: 'string', description: 'Present only on a failure envelope in place of the normal shape.' },
    failFast: { type: 'boolean' },
    poll: { type: 'string', description: 'Present when wait=false (orchestration_run only) — how to poll for completion.' },
  },
  additionalProperties: true,
};

export const TOOL_DEFS_WORKFLOW = [
    {
      name: 'publish_detect',
      outputSchema: { type: 'object' },
      description: 'Detect availability of publish pipeline tooling: Pandoc/Typst export, pandoc-ext/diagram figures, and VHS terminal demos.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['pdf', 'docx', 'doc', 'deck', 'pptx', 'html', 'rtf', 'odt', 'epub', 'tex', 'txt', 'md', 'mdx'], description: 'Export format to probe (default pdf).' },
          figures: { type: 'boolean', description: 'Include figure binaries (default true).' },
          demo: { type: 'string', description: 'When set, require VHS/asciinema for terminal demo.' },
        },
      },
    },
    {
      name: 'publish_run',
      outputSchema: { type: 'object' },
      description: 'Run the publish pipeline: export markdown with optional figure filter and optional demo recordings. Use dry_run=true to probe tooling only.',
      inputSchema: {
        type: 'object',
        required: ['input_path'],
        properties: {
          input_path: { type: 'string', description: 'Absolute path to markdown research brief.' },
          output_path: { type: 'string', description: 'Optional output path for export.' },
          format: { type: 'string', enum: ['pdf', 'docx', 'doc', 'deck', 'pptx', 'html', 'rtf', 'odt', 'epub', 'tex', 'txt', 'md', 'mdx'], description: 'Target format (default pdf).' },
          demo: { type: 'string', description: 'Terminal tape name to record.' },
          figures: { type: 'boolean', description: 'Render diagrams (default true).' },
          strict: { type: 'boolean', description: 'Fail when toolchain or release gate fails (default true).' },
          source_only: { type: 'boolean', description: 'Write sources only (default false).' },
          no_gate: { type: 'boolean', description: 'Skip artifact release gate (default false).' },
          artifact_type: { type: 'string', description: 'Manifest doc type for release gate when path inference is ambiguous.' },
          dry_run: { type: 'boolean', description: 'Detect tooling only (default false).' },
        },
      },
    },
    {
      name: 'knowledge_search',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'Search Construct\'s own documentation, knowledge base, and distilled embed observations. Call immediately — no approval — when the user asks what Construct is, how a feature works, what commands exist, or anything about its architecture/config. Also covers embed observations (GitHub, Jira, …) and registered source targets (local dirs + synced corpora, docs and code), narrowable via `projects`. Returns excerpts with source file + heading. Corpus detail: docs/guides/reference/mcp-tools.md.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Natural-language question or keyword (e.g. "what is construct", "how does embed mode work", "provider authority guard", "slack configuration", "open Jira issues").' },
          top_k: { type: 'number', description: 'Max excerpts to return (default: 5).' },
          repo_root: { type: 'string', description: 'Repo root override (default: auto-detected from server location).' },
          root_dir: { type: 'string', description: 'Data directory where .construct/observations/ lives (default: home directory). Pass this to search embed observations from a custom data dir, and to resolve registered content targets for cross-project search.' },
          projects: { type: 'string', description: 'Restrict retrieval to specific registered source projects: a comma-separated list of target ids, "all" for every content target, or "self" for the host project. Requires root_dir. An unknown id is a hard error, not an empty result. Each hit carries a structured origin {targetId, provider, projectKey, relPath, ref, kind} for attribution.' },
        },
      },
    },
    {
      name: 'workflow_init',
      outputSchema: { type: 'object' },
      description: 'Initialize a new workflow for the current project. Creates plan.md state if not already present and returns the initial workflow envelope.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          title: { type: 'string', description: 'Workflow title shown in the plan header (default: "Untitled workflow").' },
          spec_ref: { type: 'string', description: 'Optional reference to a spec/PRD/ADR id this workflow implements.' },
        },
      },
    },
    {
      name: 'workflow_add_task',
      outputSchema: { type: 'object' },
      description: 'Add a task to the current workflow. Pass `request` for intent-based routing (the classifier picks track + specialist) or pass explicit task fields (`key`, `title`, etc.) for manual entry.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          request: { type: 'string', description: 'Natural-language task request; when present, intent-based routing is used and the explicit fields below act as overrides.' },
          key: { type: 'string', description: 'Stable task key (e.g. T-001). Generated when omitted.' },
          title: { type: 'string', description: 'Short task title.' },
          phase: { type: 'string', description: 'Phase bucket (plan, build, validate, ship, etc.).' },
          owner: { type: 'string', description: 'Specialist or persona that owns the task.' },
          files: { type: 'array', items: { type: 'string' }, description: 'File paths this task touches.' },
          readFirst: { type: 'array', items: { type: 'string' }, description: 'Files the owner should read before editing.' },
          doNotChange: { type: 'array', items: { type: 'string' }, description: 'Files/regions the owner must not modify.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria as a checklist.' },
          verification: { type: 'string', description: 'Command(s) or description of how to verify the task is done.' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task keys this task depends on.' },
          overlays: { type: 'array', items: { type: 'string' }, description: 'Role flavors that augment the owner persona for this task.' },
          challengeRequired: { type: 'boolean', description: 'Force a cx-reviewer plan-challenge before the task can complete.' },
          challengeStatus: { type: 'string', description: 'Initial challenge status when seeded.' },
          tokenBudget: { type: 'number', description: 'Per-task token budget for cost tracking.' },
          status: { type: 'string', description: 'Initial status override.' },
        },
      },
    },
    {
      name: 'workflow_update_task',
      outputSchema: { type: 'object' },
      description: 'Update fields on an existing workflow task. Requires the task `key`. Only fields supplied are changed.',
      inputSchema: {
        type: 'object',
        required: ['key'],
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          key: { type: 'string', description: 'Task key to update.' },
          status: { type: 'string', description: 'New status (pending, in_progress, blocked_needs_user, blocked_by_dep, done, etc.).' },
          owner: { type: 'string', description: 'New owner persona.' },
          phase: { type: 'string', description: 'New phase bucket.' },
          note: { type: 'string', description: 'Append-only progress note.' },
          verification: { type: 'string', description: 'Updated verification description.' },
          overlays: { type: 'array', items: { type: 'string' }, description: 'Replace the overlay list.' },
          challengeRequired: { type: 'boolean', description: 'Toggle whether a challenge is required.' },
          challengeStatus: { type: 'string', description: 'Update the challenge status (proposed, accepted, refused, etc.).' },
        },
      },
    },
    {
      name: 'workflow_needs_main_input',
      outputSchema: { type: 'object' },
      description: 'Mark a workflow task as blocked pending user input. Sets status to blocked_needs_user and writes a packet describing the blocker for the orchestrator to surface.',
      inputSchema: {
        type: 'object',
        required: ['taskKey', 'blocker', 'question'],
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          taskKey: { type: 'string', description: 'Task key to mark blocked.' },
          worker: { type: 'string', description: 'Specialist that needs input (default: current owner).' },
          blocker: { type: 'string', description: 'One-line description of what is blocking progress.' },
          question: { type: 'string', description: 'The specific question to put to the user.' },
        },
      },
    },
    {
      name: 'workflow_validate',
      outputSchema: { type: 'object' },
      description: 'Validate the current workflow state against the schema and run consistency checks (no orphan tasks, no circular dependencies, every owner resolves to a known persona).',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
        },
      },
    },
    {
      name: 'workflow_status',
      outputSchema: { type: 'object' },
      description: 'Return the full workflow snapshot for the current project: tasks, summary, alignment health, and the public-health surface used by the dashboard.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
        },
      },
    },
    {
      name: 'workflow_contract_validate',
      outputSchema: { type: 'object' },
      description: 'Validate a producer→consumer handoff against specialists/org. Required when a specialist hands off to another role: enforces input.mustContain, output schema, disk-artifact postconditions, and binary postconditions per producer (rubber-stamp prevention, post-hoc threat-model prevention, etc.). Self-enforcing: a producer with binary rules MUST pass `packet`, or the call itself is a contract violation.',
      inputSchema: {
        type: 'object',
        required: ['producer', 'consumer'],
        properties: {
          producer: { type: 'string', description: 'Producer agent or persona name (e.g. cx-reviewer, cx-security).' },
          consumer: { type: 'string', description: 'Consumer agent or persona name receiving the handoff.' },
          id: { type: 'string', description: 'Optional contract id; overrides producer/consumer lookup.' },
          artifact: { type: 'object', description: 'The handoff payload to validate against the contract schema and disk-artifact postconditions.' },
          packet: { type: 'object', description: 'The producer\'s in-memory output packet. REQUIRED when the producer has binary postconditions; omitting it is itself a contract violation.' },
          enforcement: { type: 'string', enum: ['block', 'warn'], description: 'Enforcement mode (default: block). Use warn only when explicitly advisory.' },
        },
      },
    },
    {
      name: 'workflow_import_plan',
      outputSchema: { type: 'object' },
      description: 'Bulk-add tasks from a markdown plan to the current workflow. Parses headings and bullet structure to extract task titles, owners, and acceptance criteria.',
      inputSchema: {
        type: 'object',
        required: ['markdown'],
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          markdown: { type: 'string', description: 'Plan markdown to parse.' },
          phase: { type: 'string', description: 'Phase bucket applied to all imported tasks.' },
          owner: { type: 'string', description: 'Default owner for tasks that do not specify one.' },
          readFirst: { type: 'array', items: { type: 'string' }, description: 'Default readFirst files applied to all imported tasks.' },
          doNotChange: { type: 'array', items: { type: 'string' }, description: 'Default doNotChange files applied to all imported tasks.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Default acceptance criteria applied to all imported tasks.' },
          title: { type: 'string', description: 'Workflow title to set if the workflow is newly created.' },
          spec_ref: { type: 'string', description: 'Spec reference to associate with the workflow.' },
        },
      },
    },
    {
      name: 'cx_trace_telemetry',
      outputSchema: { type: 'object' },
      description: 'Record a single CX telemetry trace for an agent invocation. Use to log start/end, model used, token cost, and outcome verdict for performance review.',
      inputSchema: {
        type: 'object',
        required: ['agent', 'trace'],
        properties: {
          agent: { type: 'string', description: 'Agent or persona name being traced.' },
          trace: { type: 'object', description: 'Trace record: start_ts, end_ts, model, tokens, verdict, notes, etc.' },
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
        },
      },
    },
    {
      name: 'artifact_workflow',
      outputSchema: { type: 'object' },
      description: 'Plan a manifest-backed document artifact workflow and return a truthful provenance report. It separates planned steps from locally executed validation/export and never claims a host-planned specialist review or rewrite was completed. Durable local export requires approval_mode=allow-durable-write.',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Natural-language artifact request.' },
          artifact_type: { type: 'string', description: 'Registered manifest document class.' },
          file_path: { type: 'string', description: 'Optional existing source document for local validation/export.' },
          format: { type: 'string', description: 'Distribution format such as pdf, docx, html, deck, or pptx.' },
          output_path: { type: 'string', description: 'Optional output destination when locally exporting.' },
          branding: { type: 'string', enum: ['construct', 'plain'], description: 'Construct is default; plain is an explicit opt-out.' },
          overrides: { type: 'object', description: 'Per-invocation manifest workflow overrides.' },
          approval_mode: { type: 'string', enum: ['proposal-only', 'requires-human-approval', 'allow-durable-write'], description: 'Only allow-durable-write performs local validation/export.' },
        },
      },
    },
    {
      name: 'author_artifact',
      outputSchema: { type: 'object' },
      description: 'Materialize a typed Construct artifact you drafted (prd/adr/rfc/research-brief/runbook/custom/adhoc — call get_template first for the shape) to disk and run the release gate. YOU draft the full markdown (single # title + the type\'s required ## sections) and pass it as draft_markdown; the file is written and the gate verdict + errors are returned so you can fix and re-call. Use artifact_type "adhoc" (title + instructions, no draft) for a one-off. Supported types + author→materialize→validate flow: docs/guides/reference/mcp-tools.md.',
      inputSchema: {
        type: 'object',
        properties: {
          draft_markdown: { type: 'string', description: 'The complete artifact markdown you authored. Must start with one # title line and contain the required ## sections for the type. Required for a normal author pass; omit for adhoc or dry_run.' },
          artifact_type: { type: 'string', description: 'Artifact type (prd, meta-prd, adr, rfc, research-brief, evidence-brief, runbook, a registered custom class, or adhoc). Defaults to prd; inferred from subject when omitted.' },
          subject: { type: 'string', description: 'Short subject/title hint (e.g. "OIDC integration") used for the filename and type inference.' },
          title: { type: 'string', description: 'Required for adhoc: the artifact title.' },
          instructions: { type: 'string', description: 'Required for adhoc: what the one-off document should cover. Its structure follows these instructions; the release gate still applies.' },
          for_type: { type: 'string', description: 'Optional adhoc hint: if this names a registered class, the call is redirected to that class instead of authoring adhoc.' },
          dry_run: { type: 'boolean', description: 'Preview mode: draft from the resolved template (or the adhoc scaffold) without a supplied draft, then run the gate. Default false.' },
          context_targets: {
            type: 'array',
            description: 'Optional registered source-target ids (or {id, role}) to bind this author pass to for cross-project context (B3). Each id must exist in sources.targets[] — an unknown id is a hard error before authoring. The multi-project synthesis context is assembled deterministically and woven into the authoring input so the artifact can draw on and cite each project (project:path).',
            items: {
              oneOf: [
                { type: 'string' },
                { type: 'object', required: ['id'], properties: { id: { type: 'string' }, role: { type: 'string' } } },
              ],
            },
          },
          recruitment: {
            oneOf: [
              { type: 'string', enum: ['auto', 'off'] },
              { type: 'array', items: { type: 'string' } },
            ],
            description: "Recruitment override: 'auto' (default) recruits from signals, 'off' disables, a cx- id array replaces the set. Recruits return in `recruited`.",
          },
        },
      },
    },
    {
      name: 'model_resolve',
      outputSchema: { type: 'object' },
      description: 'Resolve which model an embedded Construct workflow should use given the host/IDE provider context. Precedence: host model → same-provider-family fallback → Construct tier default → structured config error. Never reads or returns credential values (requiresCredential is a boolean) and never claims unverified provider health. Read-only; performs no writes.',
      inputSchema: {
        type: 'object',
        properties: {
          workflow_type: { type: 'string', description: 'Workflow type hint (e.g. evidence-ingest, prd-draft, architecture-review). Selects a tier when requested_tier is absent.' },
          requested_tier: { type: 'string', enum: [...MODEL_TIERS], description: 'Desired tier; overrides the workflow-type hint.' },
          host: { type: 'string', description: 'Host/IDE identifier (advisory).' },
          host_model: { type: 'string', description: 'Model the host is currently using (e.g. anthropic/claude-sonnet-4-6).' },
          host_provider: { type: 'string', description: 'Provider family the host uses, when no host_model is given.' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'Optional required capabilities; unverifiable ones are returned as warnings.' },
          allow_cross_provider_fallback: { type: 'boolean', description: 'Permit falling back outside the host provider family (default false).' },
        },
      },
    },
    {
      name: 'triage_recommend',
      outputSchema: { type: 'object' },
      description: 'Classify an artifact and return a role-aware plan (primary owner, role chain with rationale, suggested skills, evidence requirements, expected outputs, approval requirements, risks, next steps, canExecute) WITHOUT enqueuing or executing. Classification confidence is reported distinctly from any generation confidence. Read-only; performs no durable write.',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Artifact text to classify (meeting notes, bug report, proposal, etc.). Provide this OR file_path.' },
          file_path: { type: 'string', description: 'Path to a file to extract and classify (PDF/Office via docling, audio/video via whisper, transcripts, plain text). Used when input is absent.' },
          source_path: { type: 'string', description: 'Optional filename/source hint to aid classification.' },
          artifact_type: { type: 'string', description: 'Optional artifact-type hint (advisory).' },
          domain: { type: 'string', description: 'Optional broad domain hint.' },
          desired_outcome: { type: 'string', description: 'Optional desired outcome (advisory).' },
          constraints: { type: 'array', items: { type: 'string' }, description: 'Optional constraints (advisory).' },
          available_roles: { type: 'array', items: { type: 'string' }, description: 'Restrict the plan to these role ids; dropped roles are reported as warnings.' },
        },
      },
    },
    {
      name: 'workflow_invoke',
      outputSchema: { type: 'object' },
      description: 'Invoke a named Construct workflow (roles/skills) non-interactively and return a provenanced execution plan: selected roles, rationale, applied skills, resolved model, evidence requirements, output contract, risks, and a traceId. Construct returns the orchestration plan; the host runtime performs specialist reasoning. Durable writes occur ONLY when approval_mode is allow-durable-write; proposal-only and requires-human-approval perform no durable writes.',
      inputSchema: {
        type: 'object',
        required: ['workflow_type'],
        properties: {
          workflow_type: { type: 'string', description: 'One of: evidence-ingest, proposal-review, prd-draft, architecture-review, risk-review, research-synthesis.' },
          input: { type: 'string', description: 'Artifact text the workflow operates on. Provide this OR file_path.' },
          file_path: { type: 'string', description: 'Path to a file to extract (docling/whisper/transcript) and operate on, used when input is absent.' },
          context: { type: 'object', description: 'Optional structured context; keys matching evidence requirements mark them satisfied.' },
          role_strategy: { type: 'string', enum: ['auto', 'explicit', 'constrained'], description: 'auto = default chain; explicit = use requested_roles; constrained = default chain intersected with requested_roles.' },
          requested_roles: { type: 'array', items: { type: 'string' }, description: 'Role ids for explicit/constrained strategies.' },
          approval_mode: { type: 'string', enum: ['proposal-only', 'requires-human-approval', 'allow-durable-write'], description: 'Gate for durable writes (default: the workflow type default).' },
          trace: { type: 'boolean', description: 'Emit a traceId for provenance correlation (default true).' },
          host: { type: 'string', description: 'Host/IDE identifier (advisory).' },
          host_model: { type: 'string', description: 'Model the host uses, for model resolution.' },
          host_provider: { type: 'string', description: 'Provider family the host uses, for model resolution.' },
          recruitment: { type: 'string', enum: ['auto', 'off'], description: "Signal-driven recruitment onto the manifest chain (construct-pteo2.9): 'auto' (default) appends recruits, 'off' disables. Recruits and their reasons return in `recruitment`." },
        },
      },
    },
    {
      name: 'capability_describe',
      outputSchema: { type: 'object' },
      description: 'Describe what this Construct install can do: versions, contract interfaces (CLI/MCP/SDK), roles, skills, workflows, schemas, models/providers, policies, telemetry posture, and plugins. Read-only and secret-free — provider entries carry env-key names and a configured boolean only, never credential values. Reads live registries so the published contract cannot drift from reality.',
      inputSchema: {
        type: 'object',
        properties: {
          root_dir: { type: 'string', description: 'Optional Construct install root (default: server toolkit dir).' },
        },
      },
    },
    {
      name: 'construct_execution_resolve',
      outputSchema: { type: 'object' },
      description: 'Resolve the execution-capability contract for an embedded workflow BEFORE/at workflow start: returns executionMode (construct-orchestrated | construct-prompt-only | host-direct | same-family-fallback), constructCapabilitiesActive (subset of personas/skills/workflow-routing/prompt-envelope), degraded + machine-readable degradationReason, requestedStrategy vs effectiveStrategy, and the resolved provider/model. Descriptive, not enforced: reports what Construct planned and can resolve a model for, never an observation that the host ran personas (see the semantics field). Read-only and secret-free.',
      inputSchema: {
        type: 'object',
        properties: {
          workflow_type: { type: 'string', description: 'Workflow whose orchestration plan is weighed (e.g. evidence-ingest, architecture-review). Absent ⇒ generic orchestration availability.' },
          requested_strategy: { type: 'string', enum: ['orchestrated', 'prompt-only', 'auto'], description: 'Desired execution strategy (default auto).' },
          use_construct: { type: 'boolean', description: 'false ⇒ host-direct (host runs without Construct capabilities). Default true.' },
          host: { type: 'string', description: 'Host/IDE identifier (advisory).' },
          host_model: { type: 'string', description: 'Model the host is currently using, for model resolution.' },
          host_provider: { type: 'string', description: 'Provider family the host uses, when no host_model is given.' },
          requested_tier: { type: 'string', enum: [...MODEL_TIERS], description: 'Desired model tier; overrides the workflow-type hint.' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'Optional required capabilities; unverifiable ones are returned as warnings.' },
          allow_cross_provider_fallback: { type: 'boolean', description: 'Permit model fallback outside the host provider family (default false).' },
        },
      },
    },
    {
      name: 'orchestration_run',
      outputSchema: ORCHESTRATION_RUN_SHAPE_SCHEMA,
      description: 'EXECUTE a multi-specialist orchestration run and return per-specialist output (the executing counterpart to workflow_invoke, which only plans). Default backend for MCP runs is `host` — Construct materializes each specialist prompt, the calling host executes it in its own session (no API spend), and results come back via orchestration_task_result; `provider` executes against a configured key (real spend); `inline` only prepares. Treat the response `specialists`/`tasks` as authoritative, not `routePath.specialistSequence` (display-only, can be non-empty when nothing dispatched). Pass `file_count`/`module_count` for real-scope work, or a short request can classify as trivial and dispatch nobody even with `requested_strategy: "orchestrated"`. Full semantics + all fields: docs/guides/reference/mcp-tools.md.',
      inputSchema: {
        type: 'object',
        required: ['request'],
        properties: {
          request: { type: 'string', description: 'Natural-language description of the work to orchestrate (e.g. "refactor the auth module and review it for security").' },
          workflow_type: { type: 'string', description: 'Optional workflow type to shape the plan (e.g. architecture-review, risk-review).' },
          requested_strategy: { type: 'string', enum: ['orchestrated', 'prompt-only', 'auto'], description: 'Execution strategy (default auto).' },
          worker_backend: { type: 'string', enum: ['inline', 'provider', 'host'], description: 'host materializes prompts for the calling MCP host to execute itself (no API credits; default for MCP-originated runs); provider executes specialists against a configured provider key; inline prepares only.' },
          host: { type: 'string', description: 'Host/IDE identifier (advisory).' },
          host_model: { type: 'string', description: 'Model the host uses, for model resolution.' },
          host_provider: { type: 'string', description: 'Provider family the host uses, for model resolution.' },
          file_count: { type: 'number', description: 'Optional planning hint: number of files in scope.' },
          module_count: { type: 'number', description: 'Optional planning hint: number of modules in scope.' },
          context_targets: {
            type: 'array',
            description: 'Optional registered source targets to bind for context ([{id, role?}]); an unknown id is rejected at plan time, returned as contextBindings. See mcp-tools.md.',
            items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, role: { type: 'string' } } },
          },
          candidates: {
            type: 'array',
            description: 'Optional pre-retrieved artifacts routed to specialists as role-aware context (D3). Each specialist gets only the kinds its role prefers, within a token budget; a kind:"skill" entry is dropped for a role not entitled to it. See mcp-tools.md.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Artifact path or id.' },
                title: { type: 'string', description: 'Short title.' },
                kind: { type: 'string', description: 'Storage-taxonomy kind (prd, adr, target-file, test, skill, …).' },
                summary: { type: 'string', description: 'Summary, rendered as untrusted DATA.' },
                score: { type: 'number', description: 'Optional retrieval score (0..1).' },
                skillId: { type: 'string', description: 'For kind "skill": id checked against the role entitlement; defaults to path.' },
              },
            },
          },
          context_budget: {
            type: 'object',
            description: 'Optional {maxTokens} cap for injected role context (default ~6000).',
            properties: { maxTokens: { type: 'number' } },
          },
          wait: { type: 'boolean', description: 'Wait for the run to reach a terminal state and return task output (default true). false returns the runId immediately to poll with orchestration_status.' },
          timeout_ms: { type: 'number', description: 'Max time to wait when wait=true (default 120000). On timeout the runId is returned to poll.' },
        },
      },
    },
    {
      name: 'web_search',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'Search the PUBLIC WEB and return CITED results — the only search surface that reaches the open web, kept distinct from knowledge_search / provider_fetch / repo search so it is never conflated or faked. Requires a governed provider (WEB_SEARCH_URL); without one it returns a typed degradation (capability-unavailable) and zero results, never source/repo results dressed as web. Every result carries a verifiable URL, a claim-relative class, and an Admiralty grade with derived confidence (ADR-0017; high reserved for A1/A2/B1).',
      inputSchema: {
        type: 'object',
        required: ['query', 'claim'],
        properties: {
          query: { type: 'string', description: 'The search query string.' },
          claim: { type: 'string', description: 'The claim the results are meant to support — drives claim-relative source classification (ADR-0017).' },
          recency: { type: 'string', description: 'Optional freshness window hint (e.g. "30d").' },
        },
      },
    },
    {
      name: 'orchestration_status',
      outputSchema: {
        oneOf: [
          ORCHESTRATION_RUN_SHAPE_SCHEMA,
          { type: 'array', items: ORCHESTRATION_RUN_SHAPE_SCHEMA },
        ],
      },
      description: 'Inspect orchestration runs: pass run_id for the full shaped record (status, per-task status/executor/output/error), or omit it for a list of recent runs. Solo runs are in-process (no daemon); a remote service is opt-in via CONSTRUCT_ORCHESTRATION_URL, and only that path can be unreachable.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'Run id to fetch. Omit to list recent runs.' },
          limit: { type: 'number', description: 'Max runs to list when run_id is omitted (default 20).' },
        },
      },
    },
    {
      name: 'orchestration_cancel',
      outputSchema: { type: 'object' },
      description: 'Request cancellation of an in-progress orchestration run by run_id. A soft, cooperative cancel: the run stops cleanly before its next task (an in-flight model call is not aborted), and the request is persisted on the run so a run executing in another process observes it. Returns an error for an unknown or already-terminal run.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'Run id to cancel.' },
        },
        required: ['run_id'],
      },
    },
    {
      name: 'orchestration_readiness',
      outputSchema: { type: 'object' },
      description: 'Report whether this MCP session has the required Construct orchestration tools attached and reachable now. Returns a pass/fail verdict, typed reasonCode, one next step, required/observed/missing tools, and a redacted diagnostic bundle for support.',
      inputSchema: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Host/IDE identifier, if known.' },
          session_id: { type: 'string', description: 'Host session/thread id, if known.' },
          observed_tools: { type: 'array', items: { type: 'string' }, description: 'Optional tool names the host observed in tools/list. When omitted, this server reports its own catalog under observation_scope server-self-report, not host-session.' },
          reachable_tools: { type: 'array', items: { type: 'string' }, description: 'Optional long-tail tools reachable through a gateway enum.' },
          required_tools: { type: 'array', items: { type: 'string' }, description: 'Tools required for orchestration. Defaults to orchestration_policy + orchestration_run.' },
          client_contract_version: { type: 'string', description: 'Client contract version for compatibility checks.' },
          observation_scope: { type: 'string', enum: ['host-session', 'local-probe', 'local-config', 'server-self-report'], description: 'What was observed. Pass host-session only when observed_tools/reachable_tools reflect what the host actually saw in tools/list.' },
        },
      },
    },
];
