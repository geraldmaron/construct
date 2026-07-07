/**
 * lib/mcp/tool-definitions-skills.mjs — raw tool schemas: skills/templates/teams, orchestration policy, telemetry trace/score, sessions.
 *
 * Pure data: name/description/inputSchema/outputSchema for a slice of the
 * hardcoded (non-self-registered) MCP tool catalog. Split out of
 * lib/mcp/tool-definitions.mjs (which itself was split out of
 * lib/mcp/server.mjs) purely to keep each file under the ~600-line
 * house limit — no behavior differs from one combined array.
 * lib/mcp/server.mjs concatenates every slice and applies
 * withSafetyEnvelope (lib/mcp/tool-safety.mjs) at load time.
 */
export const TOOL_DEFS_SKILLS = [
    {
      name: 'get_skill',
      outputSchema: { type: 'object' },
      description: 'Reads a specific skill playbook from the Construct knowledge base (e.g. "docs/adr-workflow", "roles/engineer", "architecture/security-arch").',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the skill (without .md extension)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'orchestration_policy',
      outputSchema: { type: 'object' },
      description: 'Classifies a request into intent, execution track, specialists, approval boundaries, and the contract chain that applies. The contractChain field names the typed producer→consumer handoffs expected for this dispatch plan. When `candidates` is supplied, also returns `contextPackets` keyed by specialist with the role-filtered artifact bundle each specialist should receive (omitted artifacts include the reason they were dropped).',
      inputSchema: {
        type: 'object',
        properties: {
          request: { type: 'string', description: 'User request or objective text.' },
          fileCount: { type: 'number', description: 'Approximate number of files involved.' },
          moduleCount: { type: 'number', description: 'Approximate number of modules involved.' },
          introducesContract: { type: 'boolean', description: 'Whether the change introduces a new contract/dependency.' },
          explicitDrive: { type: 'boolean', description: 'Whether drive/full-send mode is explicitly active.' },
          approval: {
            type: 'object',
            description: 'Approval-boundary flags.',
            properties: {
              scopeChange: { type: 'boolean' },
              productDecision: { type: 'boolean' },
              riskAcceptance: { type: 'boolean' },
              irreversibleAction: { type: 'boolean' },
              blockedDependency: { type: 'boolean' },
            },
          },
          candidates: {
            type: 'array',
            description: 'Pre-retrieved artifacts to consider for each specialist. Each item: {id, path, title, kind, summary, score}. When supplied, the response includes `contextPackets` keyed by specialist.',
            items: { type: 'object' },
          },
          budget: {
            type: 'object',
            description: 'Token budget for the per-specialist context packet (default: 6000).',
            properties: { maxTokens: { type: 'number' } },
          },
          triage: {
            type: 'object',
            description: 'Optional R&D triage block from a related intake packet — surfaced in each specialist\'s taskSummary.',
          },
          intakeId: {
            type: 'string',
            description: 'Optional id of a pending intake packet. When supplied, the tool generates a task graph from the packet\'s triage, persists it to .construct/task-graphs/, emits a task_graph.created trace event correlated by traceId, and returns the graph in `taskGraph`.',
          },
          project: {
            type: 'string',
            description: 'Project scope for the generated task graph (defaults to basename(cwd)).',
          },
          traceId: {
            type: 'string',
            description: 'Optional traceId to link task_graph.created with the originating intake.received event.',
          },
        },
      },
    },
    {
      name: 'list_skills',
      outputSchema: { type: 'object' },
      description: 'Lists all available categories and playbooks in the Construct knowledge base.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'worker_run',
      outputSchema: { type: 'object' },
      description: 'Runs a bounded shell command via the worker plane: timeout, path-policy denial, restricted env, stdout/stderr artifacts under the machine-scoped state root at `runtime/worker/<jobId>.{stdout,stderr}.log`. When `graphId` + `nodeId` are supplied, an evidence record is appended to that task graph node so it can transition to `done`. Emits `worker.started` / `worker.completed` / `evidence.recorded` trace events correlated by `traceId`.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run (e.g. `npm test`).' },
          args: { type: 'array', items: { type: 'string' }, description: 'Argv to pass alongside the command (when not embedded in the command string).' },
          workspaceRef: { type: 'string', description: 'Absolute path the job runs in. Must be inside `allowedPaths` (default: cwd).' },
          allowedPaths: { type: 'array', items: { type: 'string' }, description: 'Absolute path allowlist for the workspace. Default: [cwd] so the job can\'t reach outside the project.' },
          timeoutSeconds: { type: 'number', description: 'Hard timeout. Default: 300.' },
          envPolicy: { type: 'string', description: 'restricted (default — only PATH/HOME/USER/TZ/LANG/LC_ALL/TMPDIR plus allowedEnvKeys) | inherit.' },
          allowedEnvKeys: { type: 'array', items: { type: 'string' }, description: 'Additional env keys allowed through under restricted policy.' },
          graphId: { type: 'string', description: 'Optional task graph id — when present with `nodeId`, evidence is recorded on that node.' },
          nodeId: { type: 'string', description: 'Optional task graph node id — when present with `graphId`, evidence is recorded.' },
          evidenceType: { type: 'string', description: 'Evidence type (e.g. `test-result`, `lint-result`, `build-result`). Default: test-result.' },
          evidenceSummary: { type: 'string', description: 'Optional override for the evidence summary string.' },
          traceId: { type: 'string', description: 'Optional traceId to correlate with the rest of the agent\'s trace.' },
          taskId: { type: 'string', description: 'Optional task id (used when graphId/nodeId aren\'t supplied — purely for trace context).' },
          project: { type: 'string', description: 'Optional project scope.' },
          jobId: { type: 'string', description: 'Optional job id. Default: worker-<ts>-<rand>.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'broker_check',
      outputSchema: { type: 'object' },
      description: 'Queries the MCP broker policy gate for a pending action without executing it. Agents call this BEFORE attempting a high-risk action so the response (allowed / approvalRequired / reason / source) can be surfaced to the user in the agent\'s voice rather than triggering a denial after the fact. In solo mode the broker is off by default — returns `brokerActive: false` with `allowed: true` so the call is cheap and agents don\'t waste tokens on an inactive gate. Always emits a `tool.called` trace event for audit-trail parity. Reads specialists/org fence rules in team / enterprise mode.',
      inputSchema: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Persona name (e.g. `engineer`, `security`). Must match a key in specialists/org for team / enterprise mode.' },
          project: { type: 'string', description: 'Optional project scope for the decision.' },
          tool: { type: 'string', description: 'The tool the agent wants to invoke (e.g. `github`, `fs`).' },
          action: { type: 'string', description: 'The action on that tool (e.g. `create_pr`, `edit:lib/foo.mjs`).' },
          risk: { type: 'string', description: 'low | medium | high. high actions need approval for non-autonomous roles.' },
          traceId: { type: 'string', description: 'Optional traceId to correlate this check with the rest of the agent\'s trace.' },
        },
        required: ['role', 'tool', 'action'],
      },
    },
    {
      name: 'agent_contract',
      outputSchema: { type: 'object' },
      description: 'Looks up explicit agent-to-agent service contracts (from specialists/org). Specialists should call this at the start of a handoff to see the expected input shape, preconditions, and what postconditions they must satisfy. Use without args to get all contracts; pass producer/consumer to narrow; pass id for a specific contract.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact contract id (e.g. "architect-to-engineer")' },
          producer: { type: 'string', description: 'Producer agent name (e.g. "cx-architect"). Returns outgoing contracts.' },
          consumer: { type: 'string', description: 'Consumer agent name (e.g. "cx-engineer"). Returns incoming contracts.' },
        },
      },
    },
    {
      name: 'find_tool',
      outputSchema: { type: 'object' },
      description: 'Find Construct tools by intent when you do not know the exact name. Describe what you want to do; returns the best-matching tools with their input schemas, ranked by hybrid semantic + lexical relevance. Then invoke a result via the `call` gateway (or directly if it is a flat tool).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language description of the task (e.g. "export a markdown file to pdf").' },
          limit: { type: 'number', description: 'Max tools to return (default 5, max 20).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_template',
      outputSchema: { type: 'object' },
      description: 'Reads a doc template by name (e.g. "prd", "meta-prd", "prfaq", "evidence-brief", "adr", "runbook"). Resolves .construct/templates/docs/{name}.md first, then templates/docs/{name}.md.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name without .md extension' },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_templates',
      outputSchema: { type: 'object' },
      description: 'Lists shipped and project-override doc templates.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search_skills',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'Searches for a pattern within the Construct knowledge base skills.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'list_teams',
      outputSchema: { type: 'object' },
      description: 'Lists all available Construct team templates with members, focus, and promotion gates.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'suggest_skills',
      outputSchema: { type: 'object' },
      description: 'Rank skills from the central catalog for a natural-language intent. Optional specialistId filters entitlement metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          intent: { type: 'string', description: 'Task description or keywords' },
          specialistId: { type: 'string', description: 'Optional cx-* id for entitlement hints' },
          limit: { type: 'number', description: 'Max suggestions (default 5)' },
        },
        required: ['intent'],
      },
    },
    {
      name: 'cx_trace',
      outputSchema: { type: 'object' },
      description: 'Records an agent trace for observability. Call at the start of every significant task with your agent name and the user goal.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name (e.g. cx-engineer)' },
          id: { type: 'string', description: 'Optional trace UUID — auto-generated if omitted' },
          session_id: { type: 'string', description: 'Session ID to group related spans' },
          metadata: { type: 'object', description: 'Extra metadata (teamId, workflowId, etc.)' },
          input: { type: ['string', 'object'], description: 'Agent goal or user request' },
          output: { type: ['string', 'object'], description: 'Agent deliverable or response' },
          timestamp: { type: 'string', description: 'ISO start time (default: now)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'cx_score',
      outputSchema: { type: 'object' },
      description: 'Attaches a quality score to a trace. Call after producing a significant deliverable.',
      inputSchema: {
        type: 'object',
        properties: {
          trace_id: { type: 'string', description: 'The trace ID returned by cx_trace' },
          name: { type: 'string', description: 'Score name — use "quality"' },
          value: { type: 'number', description: 'Score from 0.0 (poor) to 1.0 (excellent)' },
          comment: { type: 'string', description: 'Brief explanation of the score' },
        },
        required: ['trace_id', 'name', 'value'],
      },
    },
    {
      name: 'cx_trace_update',
      outputSchema: { type: 'object' },
      description: 'Updates an existing trace with output and metadata. Use when a trace was created early but the result becomes available later.',
      inputSchema: {
        type: 'object',
        properties: {
          trace_id: { type: 'string', description: 'The trace ID returned by cx_trace' },
          output: { type: ['string', 'object'], description: 'Final output / deliverable content' },
          metadata: { type: 'object', description: 'Additional metadata to merge into the trace' },
        },
        required: ['trace_id'],
      },
    },
    {
      name: 'session_list',
      outputSchema: { type: 'object' },
      description: 'List construct sessions for the current project. Returns distilled session index entries with id, project, status, and summary.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          status: { type: 'string', description: 'Filter by status: active, completed, closed.' },
          limit: { type: 'number', description: 'Max results (default: 20).' },
        },
      },
    },
    {
      name: 'session_load',
      outputSchema: { type: 'object' },
      description: 'Load a full distilled session record by ID. Returns summary, decisions, files changed, open questions, and task snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          session_id: { type: 'string', description: 'The session ID to load.' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'session_search',
      outputSchema: { type: 'object' },
      description: 'Search sessions by keyword in summary or project name.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          query: { type: 'string', description: 'Search keyword.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'session_save',
      outputSchema: { type: 'object' },
      description: 'Update the active session with distilled context: summary, decisions, files changed, open questions, task snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          session_id: { type: 'string', description: 'The session ID to update.' },
          summary: { type: 'string', description: 'Brief summary of what happened (2-3 sentences).' },
          decisions: { type: 'array', items: { type: 'string' }, description: 'Key decisions made during the session.' },
          files_changed: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, reason: { type: 'string' } } }, description: 'Files modified with reasons.' },
          open_questions: { type: 'array', items: { type: 'string' }, description: 'Unresolved questions or blockers.' },
          task_snapshot: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, subject: { type: 'string' }, status: { type: 'string' } } }, description: 'Current task state.' },
          status: { type: 'string', description: 'Session status: active, completed, closed.' },
        },
        required: ['session_id'],
      },
    },
];
