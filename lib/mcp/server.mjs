#!/usr/bin/env node
/**
 * lib/mcp/server.mjs — Construct MCP server: tool registry and request dispatcher.
 *
 * Thin dispatcher only — all tool implementations live in lib/mcp/tools/*.mjs.
 * Registers 40 tools across 7 modules: project, document, storage, skills, workflow, telemetry, memory.
 * Consumed by Claude Code, OpenCode, and any MCP-compatible host.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { loadToolkitEnv } from '../toolkit-env.mjs';
import { loadConstructEnv } from '../env-config.mjs';

// Apply config.env values to process.env, letting config.env win over shell env
// so Langfuse/OpenRouter credentials are always correct regardless of host env.
{
  const confEnv = loadConstructEnv({ warn: false });
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
  agentContract, orchestrationPolicy, listTeams, getTeam,
} from './tools/skills.mjs';
import {
  workflowInit, workflowAddTask, workflowUpdateTask,
  workflowNeedsMainInput, workflowValidate, workflowImportPlan,
} from './tools/workflow.mjs';
import {
  cxTrace, cxScore, sessionUsage, efficiencySnapshot,
} from './tools/telemetry.mjs';
import {
  memorySearch, memoryAddObservations, memoryCreateEntities, memoryRecent,
  sessionList, sessionLoad, sessionSearch, sessionSave,
} from './tools/memory.mjs';

const DEFAULT_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DIR = resolve(process.env.CX_TOOLKIT_DIR || DEFAULT_ROOT_DIR);
loadToolkitEnv(ROOT_DIR);

const opts = { ROOT_DIR };

const server = new Server(
  { name: 'construct-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'agent_health',
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
      description: 'Extracts readable text from a local document path. Supports PDF on macOS plus common text and office document formats.',
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
      description: 'Reads a specific skill playbook from the Construct knowledge base (e.g. "security/security-arch", "web/design-quality").',
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
      description: 'Classifies a request into intent, execution track, specialists, approval boundaries, and the contract chain that applies. The contractChain field names the typed producer→consumer handoffs expected for this dispatch plan.',
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
        },
      },
    },
    {
      name: 'list_skills',
      description: 'Lists all available categories and playbooks in the Construct knowledge base.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'agent_contract',
      description: 'Looks up explicit agent-to-agent service contracts (from agents/contracts.json). Specialists should call this at the start of a handoff to see the expected input shape, preconditions, and what postconditions they must satisfy. Use without args to get all contracts; pass producer/consumer to narrow; pass id for a specific contract.',
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
      name: 'get_template',
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
      description: 'Lists shipped and project-override doc templates.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search_skills',
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
      description: 'Lists all available Construct team templates with members, focus, and promotion gates.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_team',
      description: 'Returns the full definition of a named team template including members, skills, and promotion gates.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Team template name (e.g. feature, incident, architecture).' },
        },
        required: ['name'],
      },
    },
    {
      name: 'cx_trace',
      description: 'Records an agent trace in Langfuse for observability. Call at the start of every significant task with your agent name and the user goal.',
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
      description: 'Attaches a quality score to a trace in Langfuse. Call after producing a significant deliverable.',
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
      name: 'session_list',
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
      name: 'efficiency_snapshot',
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
      description: 'Look up current data for a configured repo, project, or team. This is an internal lookup against sources the operator has already authorized (set in config.env). Call this immediately — no user approval needed — whenever the user asks about a specific repo, project, or team name (e.g. "what is project iverson", "cloud-reliability status", "PLAT issues"). Pass the user\'s query and the tool resolves the right source automatically. Returns repo metadata, README, docs, open PRs, issues, and recent commits, then stores them as observations.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'The user\'s question or the project/repo name (e.g. "project iverson", "hashicorp/project-iverson", "PLAT"). The tool matches this against configured GITHUB_REPOS, JIRA_PROJECTS, LINEAR_TEAMS.' },
          root_dir: { type: 'string', description: 'Data root dir override (default: homedir()). Use CX_DATA_DIR value if set.' },
        },
      },
    },
    {
      name: 'knowledge_search',
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  let result;
  try {
    if (name === 'agent_health') result = agentHealth(args);
    else if (name === 'summarize_diff') result = summarizeDiff(args);
    else if (name === 'scan_file') result = scanFile(args);
    else if (name === 'extract_document_text') result = extractDocumentText(args);
    else if (name === 'ingest_document') result = await ingestDocument(args);
    else if (name === 'infer_document_schema') result = await inferDocumentSchemaTool(args);
    else if (name === 'list_schema_artifacts') result = listSchemaArtifactsTool(args);
    else if (name === 'storage_status') result = await storageStatus(args);
    else if (name === 'storage_sync') result = await storageSync(args);
    else if (name === 'storage_reset') result = await storageReset(args);
    else if (name === 'delete_ingested_artifacts') result = deleteIngestedArtifactsTool(args);
    else if (name === 'project_context') result = projectContext(args, opts);
    else if (name === 'orchestration_policy') result = orchestrationPolicy(args);
    else if (name === 'list_skills') result = listSkills(opts);
    else if (name === 'get_skill') result = getSkill(args, opts);
    else if (name === 'search_skills') result = searchSkills(args, opts);
    else if (name === 'get_template') result = getTemplate(args, opts);
    else if (name === 'list_templates') result = listTemplates(opts);
    else if (name === 'agent_contract') result = await agentContract(args);
    else if (name === 'workflow_status') result = workflowStatus(args, opts);
    else if (name === 'workflow_init') result = workflowInit(args);
    else if (name === 'workflow_add_task') result = workflowAddTask(args);
    else if (name === 'workflow_update_task') result = workflowUpdateTask(args);
    else if (name === 'workflow_needs_main_input') result = workflowNeedsMainInput(args);
    else if (name === 'workflow_validate') result = workflowValidate(args);
    else if (name === 'workflow_import_plan') result = workflowImportPlan(args);
    else if (name === 'list_teams') result = listTeams(opts);
    else if (name === 'get_team') result = getTeam(args, opts);
    else if (name === 'cx_trace') result = await cxTrace(args, opts);
    else if (name === 'cx_score') result = await cxScore(args);
    else if (name === 'session_list') result = sessionList(args);
    else if (name === 'session_load') result = sessionLoad(args);
    else if (name === 'session_search') result = sessionSearch(args);
    else if (name === 'session_save') result = sessionSave(args);
    else if (name === 'memory_search') result = await memorySearch(args);
    else if (name === 'memory_add_observations') result = memoryAddObservations(args);
    else if (name === 'memory_create_entities') result = memoryCreateEntities(args);
    else if (name === 'memory_recent') result = memoryRecent(args);
    else if (name === 'efficiency_snapshot') result = efficiencySnapshot(args);
    else if (name === 'session_usage') result = await sessionUsage(args, opts);
    else if (name === 'provider_fetch') {
      const { demandFetch } = await import('../embed/demand-fetch.mjs');
      result = await demandFetch({ query: args.query, rootDir: args.root_dir });
    }
    else if (name === 'knowledge_search') {
      const { knowledgeSearch } = await import('../knowledge/search.mjs');
      result = knowledgeSearch({ query: args.query, topK: args.top_k, repoRoot: args.repo_root, rootDir: args.root_dir });
    }
    else result = { error: `Unknown tool: ${name}` };
  } catch (err) {
    result = { error: err.message ?? String(err) };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
