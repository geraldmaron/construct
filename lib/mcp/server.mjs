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
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveTransportMode, TRANSPORT_HTTP } from './transport/mode.mjs';
import { startStdioTransport } from './transport/stdio.mjs';
import { startHttpTransport } from './transport/http.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync, readFileSync } from 'node:fs';
import { loadToolkitEnv } from '../toolkit-env.mjs';
import { loadConstructEnv, prepareConstructEnv } from '../runtime-env.mjs';
import { getInstalledVersion } from '../version.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { injectTraceContext } from '../telemetry/otel-tracer.mjs';
import { TOOL_SAFETY, DEFAULT_OUTPUT_SCHEMA } from './tool-safety.mjs';
import { RAW_HARDCODED_TOOL_DEFS } from './tool-definitions.mjs';
import { isBrokered } from './broker.mjs';
import { resolveProjectRoot } from '../roots.mjs';
import { createToolCallHandler } from './dispatch-envelope.mjs';

// Apply project .env and config.env values to process.env, letting project
// .env win over config.env and config.env win over shell env, so
// telemetry/OpenRouter credentials are always correct regardless of host env.
// PROJECT_ROOT (walked up from the server's cwd, per lib/roots.mjs) is the
// user's repo, distinct from ROOT_DIR below (the toolkit install/checkout
// used for asset lookups and loadToolkitEnv's fill-missing toolkit .env).
{
  const PROJECT_ROOT = resolveProjectRoot(process.cwd());
  const confEnv = prepareConstructEnv({ warn: false, rootDir: PROJECT_ROOT });
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
import { providerWrite } from './tools/provider-write.mjs';
import { findTool } from './tools/find-tool.mjs';
import { recoverToolName, recordToolNameMiss, isGatewayName } from './tool-recovery.mjs';
import { assertCoreSubsetOfCatalog, assertToolSurfacePartition } from './tool-surface-parity.mjs';
import { scanToolModules } from './tool-registry.mjs';
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

// A long-running server caches VERSION at module load and never re-checks it, so
// on a dev-checkout-as-live-install topology a server up for days keeps serving
// stale code with no signal. VERSION_STAMP_PATH is the on-disk artifact this
// process was started from (ROOT_DIR/package.json, honoring CX_TOOLKIT_DIR);
// STARTED_DISK_VERSION is that file's version at startup. readVersionSkew()
// re-reads the same file on every status read (one stat + a small JSON parse)
// and reports restartRequired when the two disagree — the server cannot safely
// hot-swap its own module graph, so the only correct action is to surface the
// mismatch for the host/user to act on, not to auto-restart in-process.

const VERSION_STAMP_PATH = resolve(ROOT_DIR, 'package.json');
const STARTED_DISK_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(VERSION_STAMP_PATH, 'utf8')).version || VERSION;
  } catch {
    return VERSION;
  }
})();

export function readVersionSkew() {
  let diskVersion = STARTED_DISK_VERSION;
  try {
    diskVersion = JSON.parse(readFileSync(VERSION_STAMP_PATH, 'utf8')).version || STARTED_DISK_VERSION;
  } catch {
    diskVersion = STARTED_DISK_VERSION;
  }
  return {
    startedVersion: STARTED_DISK_VERSION,
    diskVersion,
    restartRequired: diskVersion !== STARTED_DISK_VERSION,
  };
}

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
    mcpBroker: isBrokered(process.env, { cwd: ROOT_DIR }) ? 'on' : 'off',
    mcpBrokerMode: isBrokered(process.env, { cwd: ROOT_DIR }) ? 'dispatch' : 'off',
    capabilities: [
      'project-context', 'skills', 'templates', 'teams', 'document-ingestion',
      'vector-storage', 'workflow', 'telemetry', 'memory',
    ],
    ...readVersionSkew(),
    fullHealth: 'run `construct status`',
    dashboard: 'run `construct dev`, then open the printed URL',
  };
  return {
    contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }],
  };
});

// The full construct-mcp tool catalog. Only a curated core is exposed flat in
// ListTools; the long tail is reachable through the construct_call meta-tool, so
// the serialized tool surface stays small on every host and model. The 77-tool
// flat surface alone (~15k tokens) overran a 32k local-model window.

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

const HARDCODED_TOOL_DEFS = RAW_HARDCODED_TOOL_DEFS.map(withSafetyEnvelope);

// Self-registered tools (LMCP-B5): any `<name>.tool.mjs` file under
// lib/mcp/tools/ exporting TOOL_DEFS + TOOL_HANDLERS joins the catalog here
// without editing this file — see lib/mcp/tool-registry.mjs. Scan errors
// (a module that failed to import) are logged, not fatal; a module that
// imported but declared a tool with no safety classification throws, same
// fail-loud contract as withSafetyEnvelope above.

const { defs: SCANNED_TOOL_DEFS, handlers: SCANNED_TOOL_HANDLERS, errors: SCANNED_TOOL_ERRORS } = await scanToolModules();
for (const err of SCANNED_TOOL_ERRORS) console.error(`[construct-mcp] tool module scan: ${err}`);

const ALL_TOOL_DEFS = [...HARDCODED_TOOL_DEFS, ...SCANNED_TOOL_DEFS];

// One name -> def lookup shared by the dispatch envelope (construct-tsyfe.9.1):
// every tool in the catalog, hardcoded or self-registered, is enforced against
// its own declared inputSchema/outputSchema through this single map, so
// neither catalog gets partial coverage.

const ALL_TOOL_DEFS_BY_NAME = new Map(ALL_TOOL_DEFS.map((t) => [t.name, t]));

// Curated flat core: high-frequency, low-arg tools the orchestrator and the
// built-in Build/Plan agents actually reach for. Everything else collapses
// behind construct_call so the schema stays small. Universal — applies on every
// host/model; the long tail is reachable, just not front-loaded.

const CORE_TOOL_NAMES = new Set([
  'orchestration_policy', 'orchestration_run', 'get_skill', 'get_template', 'search_skills', 'suggest_skills', 'knowledge_search',
  'memory_search', 'project_context', 'summarize_diff', 'find_tool',
  'author_artifact', 'document_export', 'publish_run', 'artifact_workflow',
  'triage_recommend', 'orchestration_readiness',
]);

const KNOWN_TOOL_NAMES = new Set(ALL_TOOL_DEFS.map((t) => t.name));

// The core/long-tail split is hand-maintained beside the catalog; a typo in a
// core name would silently drop a tool from both the flat surface and the gateway
// enum. Fail fast at module load against the catalog as the single source of truth.

assertCoreSubsetOfCatalog(CORE_TOOL_NAMES, KNOWN_TOOL_NAMES);

const CORE_TOOL_DEFS = ALL_TOOL_DEFS.filter((t) => CORE_TOOL_NAMES.has(t.name));
const LONG_TAIL_DEFS = ALL_TOOL_DEFS.filter((t) => !CORE_TOOL_NAMES.has(t.name));

// One dispatcher for the long tail. `tool` is constrained to an enum of valid
// names (≈1 token each — kills hallucinated names, the key small-model lever),
// and the description carries a compact one-line catalog instead of ~10k of full
// schemas. Dispatch reuses the same handlers via dispatchToolByName.

const CONSTRUCT_CALL_TOOL = withSafetyEnvelope({
  name: 'call',
  description:
    'Invoke any non-core Construct tool by name: provide `tool` (from the enum below) and `args`. '
    + 'Unknown name? call find_tool with a task description to get ranked tools and schemas. '
    + `Long-tail tool groups: ${[...new Set(LONG_TAIL_DEFS.map((t) => t.name.split('_')[0]))].sort().map((g) => `${g}_*`).join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: LONG_TAIL_DEFS.map((t) => t.name), description: 'The Construct tool to invoke.' },
      args: { type: 'object', additionalProperties: true, description: 'Arguments object for the tool.' },
    },
    required: ['tool'],
  },
});

// The subset check above only catches a core name absent from the catalog; it
// says nothing about a gap (a catalog tool reachable through neither surface),
// an overlap (a tool both flat and in the enum), or a duplicate. Check the
// actual runtime surface — CORE_TOOL_DEFS and the enum array attached to the
// call tool's own schema — so a divergence between tools/list and dispatch is
// caught at load time instead of surfacing as a runtime tool-not-found.

assertToolSurfacePartition({
  catalog: KNOWN_TOOL_NAMES,
  flat: CORE_TOOL_DEFS.map((t) => t.name),
  enumNames: CONSTRUCT_CALL_TOOL.inputSchema.properties.tool.enum,
});

export function exposedTools() {
  return [...CORE_TOOL_DEFS, CONSTRUCT_CALL_TOOL];
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
    else if (name === 'provider_write') result = await providerWrite(args, { rootDir: opts.ROOT_DIR });
    else if (name === 'knowledge_search') {
      const { knowledgeSearch } = await import('../knowledge/search.mjs');
      result = knowledgeSearch({ query: args.query, topK: args.top_k, repoRoot: args.repo_root, rootDir: args.root_dir, projects: args.projects });
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
      // Only the label 'host-session' when the caller actually reported what
      // its session observed; falling back to this server's own catalog is a
      // liveness-shaped self-report and must say so, never wear the
      // serve-ability label it did not earn.
      const callerObserved = Array.isArray(args.observed_tools) || Array.isArray(args.reachable_tools);
      // Host provenance (construct-6y6w.7 pattern): default host from the MCP
      // initialize handshake so hostExecutionViable reflects a real attached
      // client, not just whatever an explicit args.host claims.
      result = buildOrchestrationReadiness({
        host: server.getClientVersion()?.name,
        ...args,
        observedTools: args.observed_tools ?? catalog.observedTools,
        reachableTools: args.reachable_tools ?? catalog.reachableTools,
        observationScope: args.observation_scope ?? (callerObserved ? 'host-session' : 'server-self-report'),
      }, { env: process.env, cwd: process.cwd() });
    }
    else if (name === 'orchestration_run') {
      // Host provenance (construct-6y6w.7): default host from the MCP initialize
      // handshake's clientInfo.name so run records reflect the real caller (VS
      // Code, OpenCode, ...) instead of always falling through to cli-direct. An
      // explicit args.host still wins — the spread after `host` overrides it.
      const m = await import('./tools/orchestration-run.mjs');
      const clientName = server.getClientVersion()?.name;
      result = await m.orchestrationRun({ host: clientName, ...args });

      // Phase 2 (LMCP host-execution): a run that materialized and stood at
      // 'awaiting-host' is, by default, left for the calling agent to execute
      // and submit back (Phase 1 pickup). When the connected client declared
      // the MCP sampling capability at initialize time, construct-mcp instead
      // drives that same loop itself via server.createMessage, so the run can
      // finish in this same call rather than round-tripping through the
      // caller's own turn. resolveHostExecutionMode degrades to pickup when
      // the client never declared sampling, or when config forces pickup.
      if (result && result.status === 'awaiting-host' && result.runId) {
        const { resolveHostExecutionMode, driveHostSamplingLoop } = await import('../orchestration/host-sampling.mjs');
        const { loadProjectConfig } = await import('../config/project-config.mjs');
        const { getRun } = await import('../orchestration/runtime.mjs');
        const config = (() => { try { return loadProjectConfig(process.cwd(), process.env).config || {}; } catch { return {}; } })();
        const mode = resolveHostExecutionMode({ config, clientCapabilities: server.getClientCapabilities() });
        if (mode === 'sampling') {
          const freshRun = await getRun(process.cwd(), result.runId, { env: process.env });
          if (freshRun) {
            const driven = await driveHostSamplingLoop({ server, run: freshRun, cwd: process.cwd(), env: process.env });
            result = m.shapeRun(driven);
          }
        }
      }
    }
    else if (name === 'web_search') { const m = await import('./tools/web-search.mjs'); result = await m.webSearch(args); }
    else if (name === 'orchestration_status') { const m = await import('./tools/orchestration-run.mjs'); result = await m.orchestrationStatus(args); }
    else if (name === 'orchestration_cancel') { const m = await import('./tools/orchestration-run.mjs'); result = await m.orchestrationCancel(args); }
    else if (name === 'call') {
      const inner = String(args?.tool || '');
      if (!inner || isGatewayName(inner)) result = { error: "call requires a 'tool' name to invoke (e.g. { tool: 'document_export', args: {…} })" };
      else result = await dispatchToolByName(inner, args?.args || {});
    }
    else if (SCANNED_TOOL_HANDLERS.has(name)) result = await SCANNED_TOOL_HANDLERS.get(name)(args, opts);
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

// Rate limiting, the destructive gate, tracing, timeout, and audit logging
// around every dispatch live in dispatch-envelope.mjs (construct-rf26.10);
// the factory call below wires them to server.mjs's own ROOT_DIR/
// DEPLOYMENT_MODE and the dispatchToolByName defined above.

server.setRequestHandler(
  CallToolRequestSchema,
  createToolCallHandler({ ROOT_DIR, DEPLOYMENT_MODE, dispatchToolByName, toolDefsByName: ALL_TOOL_DEFS_BY_NAME }),
);

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
  ALL_TOOL_DEFS,
};

const argv1Real = (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })();
if (fileURLToPath(import.meta.url) === argv1Real) {
  // Orchestration tool calls that omit an explicit cwd default to this
  // process's cwd, which is host-launch-dependent (construct-6y6w.9) — the
  // same tool call can read/write a different project depending on which host
  // launched the server and from where. Logging the resolved cwd at startup
  // makes that binding diagnosable instead of silent.
  console.error(`[construct-mcp] server started (cwd: ${process.cwd()})`);

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

  // Transport is selected explicitly: stdio-local is the default and is byte-
  // for-byte the original stdio path; http-remote is opt-in via
  // CONSTRUCT_MCP_TRANSPORT and fails closed at startup when its auth config is
  // absent, so a network surface never comes up unauthenticated.

  // A startup auth-config failure in http-remote mode must exit non-zero, not be
  // absorbed by the keep-alive handlers above — fail-closed means the process
  // does not come up, not that it comes up degraded. The keep-alive guarantee
  // is for in-flight request errors after a transport is already serving.

  const mode = resolveTransportMode(process.env);
  if (mode === TRANSPORT_HTTP) {
    let config;
    try {
      ({ config } = await startHttpTransport(server, { env: process.env }));
    } catch (err) {
      console.error('[construct-mcp] http-remote transport refused to start:', err?.message || err);
      process.exit(1);
    }
    console.error(`[construct-mcp] http-remote transport listening on ${config.bindHost}:${config.bindPort}`);
  } else {
    await startStdioTransport(server);
  }
}
