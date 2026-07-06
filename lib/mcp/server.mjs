#!/usr/bin/env node
/**
 * lib/mcp/server.mjs — Construct MCP server: tool registry and request dispatcher.
 *
 * Thin dispatcher only — all tool implementations live in lib/mcp/tools/*.mjs.
 * Registers the Construct MCP tool catalog across project, document, storage,
 * skills, workflow, telemetry, memory, scope, and orchestration modules.
 * Consumed by Claude Code, OpenCode, and any MCP-compatible host.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { loadToolkitEnv } from '../toolkit-env.mjs';
import { loadConstructEnv, prepareConstructEnv } from '../runtime-env.mjs';
import { getInstalledVersion } from '../version.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { withGenAiSpan, GenAiAttrs, extractTraceContext, injectTraceContext } from '../telemetry/otel-tracer.mjs';
import { TOOL_SAFETY, DEFAULT_OUTPUT_SCHEMA } from './tool-safety.mjs';
import { ToolRateLimiter, ToolRateLimited } from './tool-rate-limit.mjs';
import { appendAuditRecord } from '../audit-trail.mjs';

// Apply config.env values to process.env, letting config.env win over shell env
// so telemetry/OpenRouter credentials are always correct regardless of host env.
{
  const confEnv = prepareConstructEnv({ warn: false });
  for (const [k, v] of Object.entries(confEnv)) {
    process.env[k] = v;
  }
}

import {
  agentHealth, summarizeDiff, scanFile, projectContext, workflowStatus,
} from './tools/project.mjs';
import {
  extractDocumentText, ingestDocument, inferDocumentSchemaTool, listSchemaArtifactsTool,
} from './tools/document.mjs';
import {
  storageStatus, storageSync, storageReset, deleteIngestedArtifactsTool,
} from './tools/storage.mjs';
import {
  listSkills, getSkill, searchSkills, getTemplate, listTemplates,
  agentContract, brokerCheck, orchestrationPolicy, workerRun, listTeams, suggestSkillsTool,
} from './tools/skills.mjs';
import {
  workflowInit, workflowAddTask, workflowUpdateTask,
  workflowNeedsMainInput, workflowValidate, workflowImportPlan,
  workflowContractValidate,
} from './tools/workflow.mjs';
import {
  cxTrace, cxTraceUpdate, cxScore, sessionUsage, efficiencySnapshot,
} from './tools/telemetry.mjs';
import {
  memorySearch, memoryAddObservations, memoryCreateEntities, memoryRecent,
  sessionList, sessionLoad, sessionSearch, sessionSave, rovoSearch,
} from './tools/memory.mjs';
import {
  scopeShow, scopeList, scopeDrafts, scopeHealthTool,
  outcomesSummary, outcomesRecord, knowledgeAdd,
  scopeCreate, scopeArchive, sandboxList, learningStatus,
  knowledgeGraphAsk,
} from './tools/scope.mjs';
import { modelResolve, triageRecommend, workflowInvoke, capabilityDescribe, executionResolve, artifactWorkflow } from './tools/embedded-contract.mjs';
import { authorArtifact } from './tools/artifact-author.mjs';
import { findTool } from './tools/find-tool.mjs';
import { recoverToolName, recordToolNameMiss, isGatewayName } from './tool-recovery.mjs';
import { assertCoreSubsetOfCatalog } from './tool-surface-parity.mjs';
import { enableSecretAuditTrail } from '../providers/secret-audit-wiring.mjs';
import { buildOrchestrationReadiness } from '../orchestration/readiness.mjs';

const DEFAULT_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DIR = resolve(process.env.CX_TOOLKIT_DIR || DEFAULT_ROOT_DIR);
loadToolkitEnv(ROOT_DIR);

const opts = { ROOT_DIR };

// Identity an MCP host can render meaningfully: the real installed version (not a
// hardcoded stub), a one-line description of what the server offers (shown in the
// host's server-detail view), and a `construct://status` resource for live state.
// Without these the host shows only "<name> · OK" with an empty detail panel.

const VERSION = getInstalledVersion()?.version || 'unknown';
const DEPLOYMENT_MODE = getDeploymentMode(process.env, { cwd: ROOT_DIR });
const INSTRUCTIONS = [
  `Construct MCP — agent orchestration for this workspace (v${VERSION}, ${DEPLOYMENT_MODE} mode).`,
  'Tools cover: project context and diff review, skills/templates/teams, document ingestion and vector storage,',
  'workflow orchestration and contracts, telemetry and scoring, and cross-session memory.',
  'Read the `construct://status` resource for live state, or run `construct status` for full project health.',
  'Start the dashboard with `construct dev`.',
].join(' ');

const server = new Server(
  { name: 'construct-mcp', version: VERSION },
  { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'construct://status',
      name: 'Construct status',
      description: 'Live toolkit status: version, deployment mode, MCP broker, and how to get full project health.',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params?.uri !== 'construct://status') {
    throw new Error(`Unknown resource: ${req.params?.uri}`);
  }
  const payload = {
    name: 'Construct',
    version: VERSION,
    deploymentMode: DEPLOYMENT_MODE,
    mcpBroker: process.env.CONSTRUCT_MCP_BROKER === 'on' ? 'on' : 'off',
    capabilities: [
      'project-context', 'skills', 'templates', 'teams', 'document-ingestion',
      'vector-storage', 'workflow', 'telemetry', 'memory',
    ],
    fullHealth: 'run `construct status`',
    dashboard: 'run `construct dev`, then open the printed URL',
  };
  return {
    contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }],
  };
});

// The full construct-mcp tool catalog. Only a curated core is exposed flat in
// ListTools; the long tail is reachable through the construct_call meta-tool, so
// the serialized tool surface stays small on every host and model. The 75-tool
// flat surface alone (~14.8k tokens) overran a 32k local-model window.

// Every tool def gains a declared outputSchema and a safety block (class, fs/
// network/process scope) from TOOL_SAFETY. A tool missing from that table throws
// here rather than shipping unclassified — see lib/mcp/tool-safety.mjs.

function withSafetyEnvelope(def) {
  const safety = TOOL_SAFETY[def.name];
  if (!safety) {
    throw new Error(`tool-safety: "${def.name}" has no safety classification — add one to lib/mcp/tool-safety.mjs`);
  }
  return { ...def, outputSchema: def.outputSchema ?? DEFAULT_OUTPUT_SCHEMA, safety };
}

const ALL_TOOL_DEFS = [
    {
      name: 'agent_health',
      outputSchema: { type: 'object' },
      description: 'Returns agent health summaries from the most recent performance review.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'Specific agent name to filter, or omit for all agents.',
          },
        },
      },
    },
    {
      name: 'summarize_diff',
      outputSchema: { type: 'object' },
      description: 'Summarizes the git diff between the current state and a base ref.',
      inputSchema: {
        type: 'object',
        properties: {
          base_ref: {
            type: 'string',
            description: 'Git ref to diff against (default: HEAD~1).',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the git command.',
          },
        },
      },
    },
    {
      name: 'scan_file',
      outputSchema: { type: 'object' },
      description: 'Scans a file for secrets and code quality issues.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to scan.',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'extract_document_text',
      outputSchema: { type: 'object' },
      description: 'Extracts readable text from a local document path. Uses node-native extractors (unpdf/mammoth) first; escalates to the docling Python sidecar or whisper.cpp when needed (same pipeline as `construct ingest`). Supports PDF, DOCX, XLSX, PPTX, HTML, plain text, email, and transcripts.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute or relative path to the document file.',
          },
          max_chars: {
            type: 'number',
            description: 'Maximum characters to return (default 20000, hard cap 200000).',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'ingest_document',
      outputSchema: { type: 'object' },
      description: 'Converts a local document into a normalized markdown file, placing it into an indexed project path by default.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute or relative path to the source document.',
          },
          out_path: {
            type: 'string',
            description: 'Optional explicit markdown output path.',
          },
          out_dir: {
            type: 'string',
            description: 'Optional directory for generated markdown output files.',
          },
          target: {
            type: 'string',
            description: 'Output mode: knowledge/internal, knowledge/external, knowledge/decisions, knowledge/how-tos, knowledge/reference, or sibling. Defaults to knowledge/internal.',
          },
          cwd: {
            type: 'string',
            description: 'Project root used to resolve default output paths and storage sync.',
          },
          sync: {
            type: 'boolean',
            description: 'When true, sync file-state into configured SQL/vector storage after writing output.',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'infer_document_schema',
      outputSchema: { type: 'object' },
      description: 'Infers a structured field schema from a local document using AI. Returns field names, types, formats, examples, and confidence. Supports all document types handled by extract_document_text. Pass multiple file_paths to get a reconciled unified schema across documents.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute or relative path to the document file. For unified inference across multiple documents, use file_paths instead.',
          },
          file_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple document paths for unified schema inference. Reconciles fields across all documents.',
          },
          max_chars: {
            type: 'number',
            description: 'Maximum characters of document text to send to the model (default 40000, hard cap 200000).',
          },
          save: {
            type: 'boolean',
            description: 'When true, write the schema result as a .schema.json artifact under .cx/knowledge/reference/schemas/.',
          },
          cwd: {
            type: 'string',
            description: 'Project root used to resolve output paths when save is true.',
          },
          sample_size: {
            type: 'number',
            description: 'For unified inference: max number of documents to sample (default 10).',
          },
          threshold: {
            type: 'number',
            description: 'For unified inference: minimum fraction of documents a field must appear in to be included (default 0.5).',
          },
        },
      },
    },
    {
      name: 'list_schema_artifacts',
      outputSchema: { type: 'object' },
      description: 'Lists all inferred schema artifacts (.schema.json files) in the project.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory to search (default: process.cwd()).',
          },
        },
      },
    },
    {
      name: 'storage_status',
      outputSchema: { type: 'object' },
      description: 'Returns SQL, local vector index, and ingested-artifact status for the current project.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory to inspect.',
          },
          project: {
            type: 'string',
            description: 'Optional explicit project key for SQL document counts.',
          },
        },
      },
    },
    {
      name: 'storage_sync',
      description: 'Syncs file-state documents into the local vector index and configured SQL storage.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory to sync.',
          },
          project: {
            type: 'string',
            description: 'Optional explicit project key.',
          },
        },
      },
    },
    {
      name: 'storage_reset',
      description: 'Resets SQL/vector storage state for a project. Requires explicit confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory whose storage should be reset.',
          },
          project: {
            type: 'string',
            description: 'Optional explicit project key.',
          },
          reset_sql: {
            type: 'boolean',
            description: 'Set false to keep SQL state intact.',
          },
          reset_vector: {
            type: 'boolean',
            description: 'Set false to keep the local vector index intact.',
          },
          reset_ingested: {
            type: 'boolean',
            description: 'Set true to also delete ingested markdown artifacts under .cx/knowledge/.',
          },
          confirm: {
            type: 'boolean',
            description: 'Must be true or the reset is rejected.',
          },
        },
      },
    },
    {
      name: 'delete_ingested_artifacts',
      description: 'Deletes ingested markdown artifacts. Requires explicit confirm=true and only allows files under the ingested artifact directory.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory whose ingested artifacts should be deleted.',
          },
          files: {
            type: 'array',
            description: 'Optional relative file paths under .cx/knowledge/. Omit to delete all ingested markdown artifacts.',
            items: { type: 'string' },
          },
          confirm: {
            type: 'boolean',
            description: 'Must be true or deletion is rejected.',
          },
        },
      },
    },
    {
      name: 'project_context',
      outputSchema: { type: 'object' },
      description: 'Returns project context: .cx/context.md content, recent commits, and working tree status.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory (default: process.cwd()).',
          },
        },
      },
    },
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
            description: 'Optional id of a pending intake packet. When supplied, the tool generates a task graph from the packet\'s triage, persists it to .cx/task-graphs/, emits a task_graph.created trace event correlated by traceId, and returns the graph in `taskGraph`.',
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
      description: 'Reads a doc template by name (e.g. "prd", "meta-prd", "prfaq", "evidence-brief", "adr", "runbook"). Resolves .cx/templates/docs/{name}.md first, then templates/docs/{name}.md.',
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
    {
      name: 'memory_search',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'Search the observation store for patterns, decisions, and insights learned by specialists across sessions. Returns semantically matched observations scoped by role, category, or project.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Semantic search query (e.g., project name, pattern, component).' },
          role: { type: 'string', description: 'Filter by specialist role (e.g., cx-engineer, cx-architect).' },
          category: { type: 'string', description: 'Filter by category: pattern, anti-pattern, dependency, decision, insight, session-summary.' },
          project: { type: 'string', description: 'Filter by project name.' },
          limit: { type: 'number', description: 'Max results (default: 10).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_add_observations',
      outputSchema: { type: 'object' },
      description: 'Record observations (patterns, insights, decisions, anti-patterns) that specialists discover during work. These are indexed for semantic search and surface in future sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          observations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', description: 'Specialist role (e.g., cx-engineer).' },
                category: { type: 'string', description: 'Category: pattern, anti-pattern, dependency, decision, insight.' },
                summary: { type: 'string', description: 'Brief summary (max 500 chars).' },
                content: { type: 'string', description: 'Detailed observation (max 2000 chars).' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering.' },
                confidence: { type: 'number', description: 'Confidence 0.0-1.0 (default: 0.8).' },
              },
              required: ['summary'],
            },
            description: 'Observations to record (max 10 per call).',
          },
        },
        required: ['observations'],
      },
    },
    {
      name: 'memory_create_entities',
      outputSchema: { type: 'object' },
      description: 'Track recurring entities (components, services, APIs, dependencies) that specialists encounter. Enables "what do we know about X?" queries.',
      inputSchema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Entity name (normalized to lowercase).' },
                type: { type: 'string', description: 'Type: component, service, dependency, api, concept, file-group.' },
                summary: { type: 'string', description: 'Brief description (max 500 chars).' },
                observation_ids: { type: 'array', items: { type: 'string' }, description: 'Link to observation IDs.' },
              },
              required: ['name'],
            },
            description: 'Entities to create or update (max 10 per call).',
          },
        },
        required: ['entities'],
      },
    },
    {
      name: 'memory_recent',
      outputSchema: { type: 'object' },
      description: 'Returns the most recent observations for the current project, deduplicated by (role, summary). Use this when the session-start hint indicates prior observations are available — fetch them on demand instead of paying for them every session.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          project: { type: 'string', description: 'Filter by project name (default: inferred from cwd).' },
          limit: { type: 'number', description: 'Max distinct observations (default: 10, max: 50).' },
        },
      },
    },
    {
      name: 'rovo_search',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'Cross-system semantic search via Atlassian Rovo. Searches Jira, Confluence, and other accessible sources. Returns excerpts with source attribution. Does NOT store results in the observation store. Use for broad queries across all sources, not just focal projects.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "Iverson reliability", "DR failover").' },
          top_k: { type: 'number', description: 'Max results (default: 10, max: 50).' },
          sources: { type: 'string', description: 'Comma-separated source filter (e.g., "jira,confluence").' },
        },
        required: ['query'],
      },
    },
    {
      name: 'efficiency_snapshot',
      outputSchema: { type: 'object' },
      description: 'Returns the read-efficiency snapshot for the current session — repeated reads, large reads, hot-spot files, and recommendations. Use this when investigating why a session feels slow or to surface optimization opportunities.',
      inputSchema: {
        type: 'object',
        properties: {
          home_dir: { type: 'string', description: 'Home directory override (default: os.homedir()).' },
        },
      },
    },
    {
      name: 'session_usage',
      outputSchema: { type: 'object' },
      description: 'Returns locally recorded interaction token and cost usage for the current Construct session.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          home_dir: { type: 'string', description: 'Home directory override for reading ~/.cx session logs.' },
        },
      },
    },
    {
      name: 'provider_fetch',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'Look up current data for a configured repo, project, or team. This is an internal lookup against sources the operator has already authorized (set in config.env). Call this immediately — no user approval needed — whenever the user asks about a specific repo, project, or team name (e.g. "what is project iverson", "cloud-reliability status", "PLAT issues"). Pass the user\'s query and the tool resolves the right source automatically. Returns repo metadata, README, docs, open PRs, issues, and recent commits, then stores them as observations.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'The user\'s question or the project/repo name (e.g. "project iverson", "hashicorp/project-iverson", "PLAT"). The tool matches this against configured GITHUB_REPOS, JIRA_PROJECTS, LINEAR_TEAMS.' },
          root_dir: { type: 'string', description: 'Data root dir override (default: homedir()). Use CX_DATA_DIR value if set.' },
          team_id: { type: 'string', description: 'Optional team id (from the unified registry). Scopes the fetch to that team\'s declared sources; observations are tagged team:<id>.' },
          target_ids: { type: 'array', items: { type: 'string' }, description: 'Optional source-target ids to restrict to (must belong to team_id). A target outside the team returns a typed OUT_OF_SCOPE error rather than a silent wrong-source fetch.' },
        },
      },
    },
    {
      name: 'scope_show',
      outputSchema: { type: 'object' },
      description: 'Return the active Construct scope (id, displayName, roles, departments, intake taxonomy, doc templates). Use when a specialist needs to know which role set, classification taxonomy, or doc templates apply before drafting work.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          id: { type: 'string', description: 'Force a specific scope id instead of resolving from config.' },
        },
      },
    },
    {
      name: 'scope_list',
      outputSchema: { type: 'object' },
      description: 'List the curated org scope catalog (rnd, operations, creative, research) with role/department counts. Use to discover which scopes are available before suggesting `construct scope set`.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'scope_drafts',
      outputSchema: { type: 'object' },
      description: 'List in-progress draft scopes under `.cx/scopes/draft-*` and any user-defined custom scope at `.cx/scope.json`. Use to see what scope work is pending before scaffolding another draft.',
      inputSchema: {
        type: 'object',
        properties: { cwd: { type: 'string', description: 'Project root (default: server cwd).' } },
      },
    },
    {
      name: 'scope_health',
      outputSchema: { type: 'object' },
      description: 'Per-scope health rollup over a window: observation count, per-role outcome runs and success rates. Use to check whether a scope is producing data before recommending changes or archive.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          id: { type: 'string', description: 'Scope id (default: active scope).' },
          window_days: { type: 'number', description: 'Window in days (default 30).' },
        },
      },
    },
    {
      name: 'outcomes_summary',
      outputSchema: { type: 'object' },
      description: 'Read `.cx/outcomes/_summary.json` (per-role success rate, 30-day trend). Pass `aggregate=true` to rebuild the summary from JSONL outcome files first. Use to ground tiebreakers and improvement suggestions in real specialist performance.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          aggregate: { type: 'boolean', description: 'Rebuild `_summary.json` before reading (default false).' },
        },
      },
    },
    {
      name: 'outcomes_record',
      outputSchema: { type: 'object' },
      description: 'Append a specialist outcome line to `.cx/outcomes/<role>.jsonl` (writes durable state — requires `confirm=true`). Use when a specialist wants to self-report success/failure outside the automatic agent-tracker path.',
      inputSchema: {
        type: 'object',
        required: ['confirm', 'role', 'success'],
        properties: {
          confirm: { type: 'boolean', description: 'Must be true.' },
          cwd: { type: 'string' },
          role: { type: 'string', description: 'Specialist id (e.g. cx-engineer, product-manager).' },
          success: { type: 'boolean' },
          intake_id: { type: 'string' },
          profile: { type: 'string', description: 'Override active scope id stamp.' },
          escalated: { type: 'boolean' },
          duration_ms: { type: 'number' },
          notes: { type: 'string', description: 'Trimmed to 500 chars.' },
          source: { type: 'string', description: 'Origin tag (default: "mcp").' },
        },
      },
    },
    {
      name: 'knowledge_add',
      outputSchema: { type: 'object' },
      description: 'Persist a research finding as `.cx/knowledge/external/research/<slug>.md` with research-specific frontmatter (topic, confidence, sources, expiresAt, scope). Writes durable state — requires `confirm=true`. `confidence=confirmed` requires at least one source.',
      inputSchema: {
        type: 'object',
        required: ['confirm', 'slug', 'topic', 'body'],
        properties: {
          confirm: { type: 'boolean', description: 'Must be true.' },
          cwd: { type: 'string' },
          slug: { type: 'string', description: 'Lowercase hyphenated, max 60 chars.' },
          topic: { type: 'string' },
          body: { type: 'string', description: 'Findings / inferences / gaps / recommendation block. Capped at 50KB total file.' },
          confidence: { type: 'string', enum: ['confirmed', 'inferred', 'weak'], description: 'Default: inferred.' },
          sources: {
            type: 'array',
            description: 'Required when confidence=confirmed.',
            items: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string' },
                accessedAt: { type: 'string', description: 'ISO timestamp; default now.' },
                span: { type: 'string', description: 'Citation locator; trimmed to 200 chars.' },
              },
            },
          },
          ttl_days: { type: 'number', description: 'Default 90.' },
        },
      },
    },
    {
      name: 'scope_create',
      outputSchema: { type: 'object' },
      description: 'Scaffold a draft org scope under `.cx/scopes/draft-<id>/` (requirements.md + scope.json + persona stubs + department charters). Writes durable state — requires `confirm=true`. For curated catalog work, follow `docs/guides/concepts/scope-lifecycle.md` after creation.',
      inputSchema: {
        type: 'object',
        required: ['confirm', 'id'],
        properties: {
          confirm: { type: 'boolean', description: 'Must be true.' },
          cwd: { type: 'string' },
          id: { type: 'string', description: 'Scope id (^[a-z][a-z0-9-]{1,30}$).' },
          display_name: { type: 'string' },
          seed_roles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Role ids to scaffold persona files for (cap 80).',
          },
          seed_departments: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                displayName: { type: 'string' },
              },
            },
            description: 'Departments to scaffold charters for (cap 12).',
          },
        },
      },
    },
    {
      name: 'scope_archive',
      outputSchema: { type: 'object' },
      description: 'Archive a curated scope: moves `specialists/org/scopes/<id>.json` and its intake table into `archive/scopes/<id>/` with an archive note. Destructive — requires `confirm=true` and a substantive `reason` (>=8 chars). Observations and outcomes are preserved.',
      inputSchema: {
        type: 'object',
        required: ['confirm', 'id', 'reason'],
        properties: {
          confirm: { type: 'boolean', description: 'Must be true.' },
          id: { type: 'string' },
          reason: { type: 'string', description: 'Substantive reason (>= 8 chars).' },
        },
      },
    },
    {
      name: 'sandbox_list',
      outputSchema: { type: 'object' },
      description: 'List Construct sandboxes under `~/.cx/sandboxes/` (id, path, createdAt). Use to find an isolated environment for QA or dry-runs without polluting the active project.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'knowledge_graph_ask',
      outputSchema: { type: 'object' },
      category: 'retrieval',
      description: 'GraphRAG-style global query over the entity graph in `.cx/observations/`. Detects communities via label propagation, ranks them by BM25 against the query, and returns each top community with its central members and extractive summary. Use for "tell me about how X relates across the project" questions that pure semantic retrieval handles poorly.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Natural-language question.' },
          cwd: { type: 'string', description: 'Project root (default: server cwd).' },
          top_k: { type: 'number', description: 'Max communities to return (default 5).' },
          min_size: { type: 'number', description: 'Skip communities smaller than this (default 2).' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Restrict entity extraction to observations carrying these tags.' },
          tag_match: { type: 'string', enum: ['any', 'all'], description: 'Tag match mode: any (default) or all.' },
        },
      },
    },
    {
      name: 'learning_status',
      outputSchema: { type: 'object' },
      description: 'One-shot mirror of `npm run learning:status`: active scope, observation counts (last 24h + total), research finding count, per-role outcome rollup. Use to answer "is Construct learning?" without spawning a shell.',
      inputSchema: {
        type: 'object',
        properties: { cwd: { type: 'string', description: 'Project root (default: server cwd).' } },
      },
    },
    {
      name: 'document_export',
      outputSchema: { type: 'object' },
      description: 'Convert a markdown file into a distributable document — PDF, DOCX, legacy DOC (LibreOffice), deck HTML, PPTX, HTML, RTF, ODT, EPUB, LaTeX, plain text, or Markdown — via Pandoc and Typst (PDF engine) plus optional pptxgenjs/LibreOffice, per ADR-0024. Engines are optional dependencies discovered at runtime — the tool returns a structured "install <binary>" error when tooling is absent, never crashes. Use `detect_only=true` to check availability without running an export.',
      inputSchema: {
        type: 'object',
        required: ['format'],
        properties: {
          input_path: { type: 'string', description: 'Absolute path to the markdown source file (required unless detect_only=true).' },
          output_path: { type: 'string', description: 'Optional absolute output path; defaults to <input>.<format> next to the source.' },
          format: { type: 'string', enum: ['pdf', 'docx', 'doc', 'deck', 'pptx', 'html', 'rtf', 'odt', 'epub', 'tex', 'txt', 'md', 'mdx'], description: 'Target format.' },
          detect_only: { type: 'boolean', description: 'When true, report binary availability without exporting. Default false.' },
          figures: { type: 'boolean', description: 'When true, render d2/mermaid via pandoc-ext/diagram filter. Default false.' },
        },
      },
    },
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
      description: 'Search Construct\'s own documentation, knowledge base, and distilled embed observations. Call this immediately — no approval needed — when the user asks what Construct is, how a feature works, what commands exist, or anything about Construct\'s architecture or configuration. Also searches embed observations from GitHub, Jira, and other configured sources. Returns relevant excerpts with source file and heading.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Natural-language question or keyword (e.g. "what is construct", "how does embed mode work", "provider authority guard", "slack configuration", "open Jira issues").' },
          top_k: { type: 'number', description: 'Max excerpts to return (default: 5).' },
          repo_root: { type: 'string', description: 'Repo root override (default: auto-detected from server location).' },
          root_dir: { type: 'string', description: 'Data directory where .cx/observations/ lives (default: home directory). Pass this to search embed observations from a custom data dir.' },
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
          challengeRequired: { type: 'boolean', description: 'Force a cx-devil-advocate challenge before the task can complete.' },
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
      description: 'Materialize a typed Construct artifact you have drafted (prd, prd-platform, prd-business, meta-prd, adr, rfc, research-brief, evidence-brief, runbook) to disk and run the release gate. YOU draft the full markdown — start with a single # title and include the type\'s required ## sections (call get_template first for the shape) — and pass it as draft_markdown; the canonical file is written and the gate verdict + errors are returned so you can fix and re-call. This is the Construct author→materialize→validate pass for supported hosts.',
      inputSchema: {
        type: 'object',
        properties: {
          draft_markdown: { type: 'string', description: 'The complete artifact markdown you authored. Must start with one # title line and contain the required ## sections for the type.' },
          artifact_type: { type: 'string', description: 'Artifact type (prd, meta-prd, adr, rfc, research-brief, evidence-brief, runbook, …). Defaults to prd; inferred from subject when omitted.' },
          subject: { type: 'string', description: 'Short subject/title hint (e.g. "OIDC integration") used for the filename and type inference.' },
        },
        required: ['draft_markdown'],
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
          requested_tier: { type: 'string', enum: ['reasoning', 'standard', 'fast'], description: 'Desired tier; overrides the workflow-type hint.' },
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
          requested_tier: { type: 'string', enum: ['reasoning', 'standard', 'fast'], description: 'Desired model tier; overrides the workflow-type hint.' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'Optional required capabilities; unverifiable ones are returned as warnings.' },
          allow_cross_provider_fallback: { type: 'boolean', description: 'Permit model fallback outside the host provider family (default false).' },
        },
      },
    },
    {
      name: 'orchestration_run',
      outputSchema: { type: 'object' },
      description: 'EXECUTE a real multi-specialist orchestration run and return per-specialist output — the executing counterpart to workflow_invoke (which only plans). For MCP hosts with no subagent primitive (VS Code/Copilot, Cursor), this is how you actually run a specialist chain: the engine owns orchestration, this tool is the thin client (ADR-0022). Solo runs execute in-process — no daemon, no port, no token; a remote/team orchestration service is opt-in via CONSTRUCT_ORCHESTRATION_URL. Real specialist output requires the `provider` worker backend (a provider key configured); the default `inline` backend prepares tasks only.',
      inputSchema: {
        type: 'object',
        required: ['request'],
        properties: {
          request: { type: 'string', description: 'Natural-language description of the work to orchestrate (e.g. "refactor the auth module and review it for security").' },
          workflow_type: { type: 'string', description: 'Optional workflow type to shape the plan (e.g. architecture-review, risk-review).' },
          requested_strategy: { type: 'string', enum: ['orchestrated', 'prompt-only', 'auto'], description: 'Execution strategy (default auto).' },
          worker_backend: { type: 'string', enum: ['inline', 'provider'], description: 'provider executes specialists (needs a provider key); inline prepares only. Default: daemon config.' },
          host: { type: 'string', description: 'Host/IDE identifier (advisory).' },
          host_model: { type: 'string', description: 'Model the host uses, for model resolution.' },
          host_provider: { type: 'string', description: 'Provider family the host uses, for model resolution.' },
          file_count: { type: 'number', description: 'Optional planning hint: number of files in scope.' },
          module_count: { type: 'number', description: 'Optional planning hint: number of modules in scope.' },
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
      outputSchema: { type: 'object' },
      description: 'Inspect orchestration runs on the local Construct daemon: pass run_id for the full record (status, per-task status/executor/output/error), or omit it for a list of recent runs. Fails fast if the daemon is unreachable.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'Run id to fetch. Omit to list recent runs.' },
          limit: { type: 'number', description: 'Max runs to list when run_id is omitted (default 20).' },
        },
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
          observed_tools: { type: 'array', items: { type: 'string' }, description: 'Optional tool names the host observed in tools/list. Defaults to this server catalog.' },
          reachable_tools: { type: 'array', items: { type: 'string' }, description: 'Optional long-tail tools reachable through a gateway enum.' },
          required_tools: { type: 'array', items: { type: 'string' }, description: 'Tools required for orchestration. Defaults to orchestration_policy + orchestration_run.' },
          client_contract_version: { type: 'string', description: 'Client contract version for compatibility checks.' },
          observation_scope: { type: 'string', enum: ['host-session', 'local-config'], description: 'What was observed. MCP calls normally use host-session.' },
        },
      },
    },
].map(withSafetyEnvelope);

// Curated flat core: high-frequency, low-arg tools the orchestrator and the
// built-in Build/Plan agents actually reach for. Everything else collapses
// behind construct_call so the schema stays small. Universal — applies on every
// host/model; the long tail is reachable, just not front-loaded.

const CORE_TOOL_NAMES = new Set([
  'orchestration_policy', 'orchestration_run', 'get_skill', 'get_template', 'search_skills', 'knowledge_search',
  'memory_search', 'project_context', 'summarize_diff', 'find_tool',
  'author_artifact', 'document_export', 'publish_run', 'artifact_workflow',
  'workflow_invoke', 'triage_recommend', 'orchestration_readiness',
]);

const KNOWN_TOOL_NAMES = new Set(ALL_TOOL_DEFS.map((t) => t.name));

// The core/long-tail split is hand-maintained beside the catalog; a typo in a
// core name would silently drop a tool from both the flat surface and the gateway
// enum. Fail fast at module load against the catalog as the single source of truth.

assertCoreSubsetOfCatalog(CORE_TOOL_NAMES, KNOWN_TOOL_NAMES);

const LONG_TAIL_DEFS = ALL_TOOL_DEFS.filter((t) => !CORE_TOOL_NAMES.has(t.name));

// One dispatcher for the long tail. `tool` is constrained to an enum of valid
// names (≈1 token each — kills hallucinated names, the key small-model lever),
// and the description carries a compact one-line catalog instead of ~10k of full
// schemas. Dispatch reuses the same handlers via dispatchToolByName.

const CONSTRUCT_CALL_TOOL = withSafetyEnvelope({
  name: 'call',
  description:
    'Invoke any non-core Construct tool by name: provide `tool` and `args`. '
    + 'If you do not know the exact name, call find_tool with a description of your task to get ranked tools and their schemas. '
    + `Long-tail tool groups: ${[...new Set(LONG_TAIL_DEFS.map((t) => t.name.split('_')[0]))].sort().map((g) => `${g}_*`).join(', ')}. `
    + 'The `tool` value must be a catalog name (constrained by the enum below).',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: LONG_TAIL_DEFS.map((t) => t.name), description: 'The Construct tool to invoke.' },
      args: { type: 'object', additionalProperties: true, description: 'Arguments object for the tool.' },
    },
    required: ['tool'],
  },
});

export function exposedTools() {
  return [...ALL_TOOL_DEFS.filter((t) => CORE_TOOL_NAMES.has(t.name)), CONSTRUCT_CALL_TOOL];
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedTools() }));

function currentMcpToolCatalog() {
  const tools = exposedTools();
  const observedTools = tools.map((t) => t.name);
  const reachableTools = tools.flatMap((t) => (
    t.name === 'call' ? (t.inputSchema?.properties?.tool?.enum ?? []) : []
  ));
  return { observedTools, reachableTools };
}

// Single dispatch table shared by the direct CallTool path and the construct_call
// meta-tool, so collapsing the surface costs no capability — every tool stays
// reachable by name. construct_call re-enters here once (guarded against
// recursing into itself).

export async function dispatchToolByName(name, args = {}) {
  let result;
    if (name === 'agent_health') result = agentHealth(args);
    else if (name === 'summarize_diff') result = summarizeDiff(args);
    else if (name === 'scan_file') result = scanFile(args);
    else if (name === 'extract_document_text') result = await extractDocumentText(args);
    else if (name === 'ingest_document') result = await ingestDocument(args);
    else if (name === 'infer_document_schema') result = await inferDocumentSchemaTool(args);
    else if (name === 'list_schema_artifacts') result = listSchemaArtifactsTool(args);
    else if (name === 'storage_status') result = await storageStatus(args);
    else if (name === 'storage_sync') result = await storageSync(args);
    else if (name === 'storage_reset') result = await storageReset(args);
    else if (name === 'delete_ingested_artifacts') result = deleteIngestedArtifactsTool(args);
    else if (name === 'project_context') result = projectContext(args, opts);
    else if (name === 'orchestration_policy') result = await orchestrationPolicy(args);
    else if (name === 'list_skills') result = listSkills(opts);
    else if (name === 'get_skill') result = getSkill(args, opts);
    else if (name === 'search_skills') result = searchSkills(args, opts);
    else if (name === 'get_template') result = getTemplate(args, opts);
    else if (name === 'list_templates') result = listTemplates(opts);
    else if (name === 'agent_contract') result = await agentContract(args);
    else if (name === 'broker_check') result = await brokerCheck(args);
    else if (name === 'worker_run') result = await workerRun(args);
    else if (name === 'workflow_status') result = workflowStatus(args, opts);
    else if (name === 'workflow_init') result = workflowInit(args);
    else if (name === 'workflow_add_task') result = workflowAddTask(args);
    else if (name === 'workflow_update_task') result = workflowUpdateTask(args);
    else if (name === 'workflow_needs_main_input') result = workflowNeedsMainInput(args);
    else if (name === 'workflow_validate') result = workflowValidate(args);
    else if (name === 'workflow_contract_validate') result = await workflowContractValidate(args);
    else if (name === 'workflow_import_plan') result = workflowImportPlan(args);
    else if (name === 'list_teams') result = listTeams(opts);
    else if (name === 'suggest_skills') result = suggestSkillsTool(args, opts);
    else if (name === 'cx_trace_telemetry') { const m = await import('./tools/telemetry.mjs'); result = await m.cxTrace(args, opts); }
    else if (name === 'cx_trace') result = await cxTrace(args, opts);
    else if (name === 'cx_score') result = await cxScore(args);
    else if (name === 'cx_trace_update') result = await cxTraceUpdate(args);
    else if (name === 'session_list') result = sessionList(args);
    else if (name === 'session_load') result = sessionLoad(args);
    else if (name === 'session_search') result = sessionSearch(args);
    else if (name === 'session_save') result = sessionSave(args);
    else if (name === 'memory_search') result = await memorySearch(args);
    else if (name === 'memory_add_observations') result = await memoryAddObservations(args);
    else if (name === 'memory_create_entities') result = memoryCreateEntities(args);
    else if (name === 'memory_recent') result = memoryRecent(args);
    else if (name === 'rovo_search') result = await rovoSearch(args);
    else if (name === 'efficiency_snapshot') result = efficiencySnapshot(args);
    else if (name === 'session_usage') result = await sessionUsage(args, opts);
    else if (name === 'provider_fetch') {
      const { demandFetch } = await import('../embed/demand-fetch.mjs');
      result = await demandFetch({ query: args.query, rootDir: args.root_dir, teamId: args.team_id, targetIds: args.target_ids });
    }
    else if (name === 'knowledge_search') {
      const { knowledgeSearch } = await import('../knowledge/search.mjs');
      result = knowledgeSearch({ query: args.query, topK: args.top_k, repoRoot: args.repo_root, rootDir: args.root_dir });
    }
    else if (name === 'document_export') {
      const { detect, exportMarkdown } = await import('../document-export.mjs');
      if (args.detect_only) {
        result = detect(args.format, process.env, { figures: Boolean(args.figures) });
      } else {
        result = exportMarkdown({
          inputPath: args.input_path,
          outputPath: args.output_path,
          format: args.format,
          figures: Boolean(args.figures),
        });
      }
    }
    else if (name === 'publish_detect') {
      const { detectPublishPipeline } = await import('../publish-tooling.mjs');
      result = detectPublishPipeline({
        format: args.format || 'pdf',
        includeFigures: args.figures !== false,
        includeTerminalDemo: Boolean(args.demo),
      });
    }
    else if (name === 'publish_run') {
      const { runPublish } = await import('../publish.mjs');
      if (args.dry_run) {
        const { detectPublishPipeline } = await import('../publish-tooling.mjs');
        result = detectPublishPipeline({
          format: args.format || 'pdf',
          includeFigures: args.figures !== false,
          includeTerminalDemo: Boolean(args.demo),
        });
      } else {
        result = runPublish({
          inputPath: args.input_path,
          format: args.format || 'pdf',
          outputPath: args.output_path,
          demos: args.demo ? [args.demo] : [],
          figures: args.figures !== false,
          strict: args.strict !== false,
          gate: args.no_gate !== true,
          artifactType: args.artifact_type || args.type || null,
          sourceOnly: Boolean(args.source_only),
          repoRoot: process.cwd(),
        });
      }
    }
    else if (name === 'scope_show') result = scopeShow(args);
    else if (name === 'scope_list') result = scopeList();
    else if (name === 'scope_drafts') result = scopeDrafts(args);
    else if (name === 'scope_health') result = scopeHealthTool(args);
    else if (name === 'outcomes_summary') result = outcomesSummary(args);
    else if (name === 'outcomes_record') result = outcomesRecord(args);
    else if (name === 'knowledge_add') result = await knowledgeAdd(args);
    else if (name === 'scope_create') result = scopeCreate(args);
    else if (name === 'scope_archive') result = scopeArchive(args);
    else if (name === 'sandbox_list') result = sandboxList();
    else if (name === 'learning_status') result = learningStatus(args);
    else if (name === 'knowledge_graph_ask') result = knowledgeGraphAsk(args);
    else if (name === 'model_resolve') result = modelResolve(args);
    else if (name === 'triage_recommend') result = await triageRecommend(args);
    else if (name === 'workflow_invoke') result = await workflowInvoke(args);
    else if (name === 'capability_describe') result = capabilityDescribe(args);
    else if (name === 'construct_execution_resolve') result = executionResolve(args);
    else if (name === 'artifact_workflow') result = artifactWorkflow(args);
    else if (name === 'author_artifact') result = await authorArtifact(args, opts);
    else if (name === 'find_tool') result = await findTool(args, { toolDefs: ALL_TOOL_DEFS, env: process.env });
    else if (name === 'orchestration_readiness') {
      const catalog = currentMcpToolCatalog();
      result = buildOrchestrationReadiness({
        ...args,
        observedTools: args.observed_tools ?? catalog.observedTools,
        reachableTools: args.reachable_tools ?? catalog.reachableTools,
        observationScope: args.observation_scope ?? 'host-session',
      }, { env: process.env, cwd: process.cwd() });
    }
    else if (name === 'orchestration_run') { const m = await import('./tools/orchestration-run.mjs'); result = await m.orchestrationRun(args); }
    else if (name === 'web_search') { const m = await import('./tools/web-search.mjs'); result = await m.webSearch(args); }
    else if (name === 'orchestration_status') { const m = await import('./tools/orchestration-run.mjs'); result = await m.orchestrationStatus(args); }
    else if (name === 'call') {
      const inner = String(args?.tool || '');
      if (!inner || isGatewayName(inner)) result = { error: "call requires a 'tool' name to invoke (e.g. { tool: 'document_export', args: {…} })" };
      else result = await dispatchToolByName(inner, args?.args || {});
    }
    else result = await resolveUnknownToolName(name, args);
  return result;
}

// The agent reached for a name no branch matches. Recover the obvious cases (the
// gateway under an alias, a known tool wearing the host prefix) and record every
// miss so the discoverability gap is measurable instead of silent.

async function resolveUnknownToolName(name, args = {}) {
  const recovered = recoverToolName(name, KNOWN_TOOL_NAMES);
  recordToolNameMiss(ROOT_DIR, { name, recovered: recovered?.name || (recovered?.gateway ? 'call' : null) });
  if (recovered?.gateway) {
    const inner = String(args?.tool || '');
    if (!inner || isGatewayName(inner)) return { error: "call requires a 'tool' name to invoke (e.g. { tool: 'document_export', args: {…} })" };
    return dispatchToolByName(inner, args?.args || {});
  }
  if (recovered?.name) return dispatchToolByName(recovered.name, args);
  return { error: `Unknown tool: ${name}. Core tools are flat; invoke any other tool via { name: 'call', arguments: { tool: '<name>', args: {…} } }.` };
}

// Solo mode never instantiates lib/mcp/broker.mjs's Broker (role/policy-based,
// wired only for team/enterprise), so the live dispatch path otherwise has no
// rate bound and no audit trail in the default deployment. windowMs 0 disables,
// mirroring the CONSTRUCT_MCP_TOOL_TIMEOUT_MS override convention below.

const toolRateLimiter = new ToolRateLimiter({
  windowMs: (() => {
    const raw = Number(process.env.CONSTRUCT_MCP_TOOL_RATE_WINDOW_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  })(),
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const callStart = Date.now();

  // Extract W3C traceparent from params._meta (SEP-414 propagation). Tracing
  // must never break dispatch — a malformed _meta should not fail the call.
  let parentCtx = {};
  try { parentCtx = await extractTraceContext(request.params?._meta || {}); } catch { /* tracing optional */ }

  // The `call` gateway's own class would conflate every long-tail tool's budget
  // into one bucket; rate-limit and audit-log the real underlying tool instead.

  const innerTool = name === 'call' && typeof args?.tool === 'string' && !isGatewayName(args.tool) ? args.tool : null;
  const auditedTool = innerTool ?? name;
  const safetyClass = TOOL_SAFETY[auditedTool]?.class ?? 'read';

  // Bound every tool call. A tool that stalls (a stuck external extractor, a slow
  // model load, a wedged subprocess) must surface a clean timeout error to the
  // client rather than block the request until the client gives up and reports an
  // opaque failure. Override with CONSTRUCT_MCP_TOOL_TIMEOUT_MS (0 disables).
  const TOOL_TIMEOUT_MS = (() => {
    const raw = Number(process.env.CONSTRUCT_MCP_TOOL_TIMEOUT_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 120_000;
  })();

  let toolResult;
  try {
    toolRateLimiter.check(auditedTool, safetyClass);

    // A GenAI span per dispatch records the real underlying tool, its safety
    // class, and the serialized result size (a token proxy) for every call, so
    // per-tool calls/latency/errors are measured. Tracing never fails the call:
    // on any dispatch error the inner catch resolves to an { error } object, so
    // the span closes OK and the client still gets a structured error payload.

    toolResult = await withGenAiSpan(
      `execute_tool ${auditedTool}`,
      { [GenAiAttrs.TOOL_NAME]: auditedTool, 'construct.tool.safety_class': safetyClass, [GenAiAttrs.MCP_METHOD]: 'tools/call' },
      async (span) => {
        const dispatch = (async () => {
          let result;
          try {
            result = await dispatchToolByName(name, args);
          } catch (err) {
            result = { error: err.message ?? String(err) };
          }
          return result;
        })();

        let out;
        if (!TOOL_TIMEOUT_MS) {
          out = await dispatch;
        } else {
          let timer;
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`tool ${name} timed out after ${Math.round(TOOL_TIMEOUT_MS / 1000)}s`)),
              TOOL_TIMEOUT_MS,
            );
          });
          try {
            out = await Promise.race([dispatch, timeout]);
          } catch (err) {
            out = { error: err.message ?? String(err) };
          } finally {
            clearTimeout(timer);
          }
        }

        const isError = Boolean(out && typeof out === 'object' && 'error' in out);
        span.setAttribute('construct.tool.result_bytes', JSON.stringify(out ?? null).length);
        span.setAttribute('construct.tool.ok', !isError);
        return out;
      },
      parentCtx,
    );
  } catch (err) {
    if (err instanceof ToolRateLimited) toolResult = { error: err.message };
    else throw err;
  }

  // Value-free: tool name and safety class only, never call args or result
  // content. Logging must never break dispatch, matching the tracing guard above.

  try {
    appendAuditRecord({
      ts: new Date().toISOString(),
      agent: 'mcp-server',
      tool: auditedTool,
      target: safetyClass,
      ok: !(toolResult && typeof toolResult === 'object' && 'error' in toolResult),
      duration_ms: Date.now() - callStart,
    });
  } catch { /* audit trail unavailable must not fail the call */ }

  // Every tool now declares an outputSchema (see withSafetyEnvelope); the MCP SDK
  // client validates that declaration against the response and rejects a tool
  // call whose result omits structuredContent. toolResult is always a JSON object
  // across every dispatch branch, so it satisfies each tool's schema directly.

  return {
    content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
    structuredContent: toolResult,
  };
});

const cxTraceBound = (args) => cxTrace(args, opts);
const projectContextBound = (args) => projectContext(args, opts);
const workflowStatusBound = (args) => workflowStatus(args, opts);

export {
  cxTraceBound as cxTrace,
  projectContextBound as projectContext,
  workflowStatusBound as workflowStatus,
  extractDocumentText,
  ingestDocument,
  inferDocumentSchemaTool,
  listSchemaArtifactsTool,
  storageStatus,
  storageSync,
  storageReset,
  deleteIngestedArtifactsTool,
  agentContract,
};

const argv1Real = (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })();
if (fileURLToPath(import.meta.url) === argv1Real) {
  console.error('[construct-mcp] server started');

  // Orchestration and provider-backed tools resolve credentials in the server's
  // own process; wiring the sink at the entry records those op reads on the same
  // trail as the CLI. Scoped to the server entry so importing this module for a
  // test never installs the process-global sink.
  enableSecretAuditTrail();

  // A long-running stdio server must survive a single malformed request: a
  // background rejection from one ingest (e.g. a broken docling sidecar that
  // settles late) must not terminate the process and close the client
  // connection. Log loudly and keep serving instead of crashing. Scoped to the
  // server entry so importing this module never installs global handlers.
  process.on('unhandledRejection', (reason) => {
    console.error('[construct-mcp] unhandledRejection (kept alive):', reason instanceof Error ? reason.stack : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[construct-mcp] uncaughtException (kept alive):', err?.stack || err);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
