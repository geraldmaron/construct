/**
 * lib/mcp/tools/skills.mjs — Skills, templates, agent contracts, orchestration policy, and team tools.
 *
 * Exposes listSkills, getSkill, searchSkills, getTemplate, listTemplates, agentContract,
 * orchestrationPolicy, listTeams, and getTeam. All synchronous except agentContract (dynamic import).
 * Requires ROOT_DIR injected via the opts argument on each call.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildConstructToOrchestratorPacket,
  routeRequest,
  routeRequestVerified,
  requiresExecutiveApproval,
  TERMINAL_STATES,
} from '../../orchestration-policy.mjs';
import { buildTaskPacketFromIntent } from '../../workflow-state.mjs';
import { logSkillCall } from '../../telemetry/skill-calls.mjs';
import { templateMetadata } from '../../artifact-manifest.mjs';
import { buildSpecialistCatalog } from '../../specialists/roster.mjs';
import { loadRegistry } from '../../registry/loader.mjs';
import { listGroupsHierarchical } from '../../registry/assemble.mjs';
import { suggestSkills } from '../../skills/router.mjs';

export function listSkills({ ROOT_DIR }) {
  const skillsDir = join(ROOT_DIR, 'skills');
  if (!existsSync(skillsDir)) return { error: 'Skills directory not found.' };

  const listDirRecursive = (dir, prefix = '') => {
    let results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Directory form: <name>/SKILL.md — emit the directory name as the skill id.
        const skillMd = join(dir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          results.push(`${prefix}${entry.name}`);
        } else {
          results = results.concat(listDirRecursive(join(dir, entry.name), `${prefix}${entry.name}/`));
        }
      } else if (entry.name.endsWith('.md') && entry.name !== 'SKILL.md' && entry.name !== 'routing.md') {
        results.push(`${prefix}${entry.name.replace('.md', '')}`);
      }
    }
    return results;
  };

  const skills = listDirRecursive(skillsDir).sort();
  return { skills };
}

export function getSkill(args, { ROOT_DIR }) {
  const { path: skillPath, specialistId, agentId } = args;
  if (!skillPath) return { error: 'Missing path argument' };

  const strict = process.env.CONSTRUCT_STRICT_SKILLS === '1';
  const specId = specialistId || agentId;
  let entitlementWarning = null;
  if (specId) {
    const registry = loadRegistry({ rootDir: ROOT_DIR, skipValidation: true });
    const id = String(specId).startsWith('cx-') ? specId : `cx-${specId}`;
    const entitled = new Set(registry.specialists?.[id]?.skills || []);
    if (entitled.size > 0 && !entitled.has(skillPath)) {
      entitlementWarning = `Skill ${skillPath} is not in ${id} entitlement list`;
      if (strict) return { error: entitlementWarning };
    }
  }

  // Primary: flat file form skills/<path>.md
  // Fallback: directory form skills/<path>/SKILL.md (one minor-release grace period)
  const candidates = [
    join(ROOT_DIR, 'skills', `${skillPath}.md`),
    join(ROOT_DIR, 'skills', skillPath, 'SKILL.md'),
  ];

  const fullPath = candidates.find(existsSync);
  if (!fullPath) {
    return { error: `Skill not found: ${skillPath}` };
  }
  const t0 = Date.now();
  const content = readFileSync(fullPath, 'utf8');
  logSkillCall({
    skillId: skillPath,
    source: 'mcp',
    latencyMs: Date.now() - t0,
    callerContext: args.callerContext,
    agentId: args.agentId,
    sessionId: args.sessionId,
    tokensReturned: Math.ceil(content.length / 4),
  });
  return { content, ...(entitlementWarning ? { warning: entitlementWarning } : {}) };
}

export function searchSkills(args, { ROOT_DIR }) {
  const { pattern } = args;
  if (!pattern) return { error: 'Missing pattern argument' };
  const skillsDir = join(ROOT_DIR, 'skills');

  // argv-array form: pattern is a discrete argument, never interpreted by a
  // shell. MCP tool inputs are model-controlled and must not reach a shell.

  try {
    const output = execFileSync('rg', ['-i', pattern, skillsDir], { encoding: 'utf8' });
    return { results: output.split('\n').filter(Boolean) };
  } catch {
    try {
      const output = execFileSync('grep', ['-ri', pattern, skillsDir], { encoding: 'utf8' });
      return { results: output.split('\n').filter(Boolean) };
    } catch {
      return { results: [], note: 'No matches found or grep error' };
    }
  }
}

function listTemplatesRaw({ ROOT_DIR }) {
  const shipped = [];
  const override = [];
  const shippedDir = join(ROOT_DIR, 'templates', 'docs');
  if (existsSync(shippedDir)) {
    for (const f of readdirSync(shippedDir)) {
      if (f.endsWith('.md')) shipped.push(f.replace(/\.md$/, ''));
    }
  }
  const overrideDir = join(process.cwd(), '.cx', 'templates', 'docs');
  if (existsSync(overrideDir)) {
    for (const f of readdirSync(overrideDir)) {
      if (f.endsWith('.md')) override.push(f.replace(/\.md$/, ''));
    }
  }
  return { shipped: shipped.sort(), overridden: override.sort() };
}

export function getTemplate(args, { ROOT_DIR }) {
  const { name } = args;
  if (!name) return { error: 'Missing name argument' };
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return { error: 'Invalid template name' };

  const cwd = process.cwd();
  const candidates = [
    { source: 'project-override', path: join(cwd, '.cx', 'templates', 'docs', `${safe}.md`) },
    { source: 'shipped-default', path: join(ROOT_DIR, 'templates', 'docs', `${safe}.md`) },
  ];
  for (const { source, path: p } of candidates) {
    if (existsSync(p)) {
      const meta = templateMetadata(safe, { cwd, rootDir: ROOT_DIR });
      return { source, path: p, content: readFileSync(p, 'utf8'), metadata: meta };
    }
  }
  return { error: `Template not found: ${safe}`, available: listTemplatesRaw({ ROOT_DIR }) };
}

export function listTemplates({ ROOT_DIR }) {
  const raw = listTemplatesRaw({ ROOT_DIR });
  const cwd = process.cwd();
  const metadata = {};
  for (const name of [...new Set([...raw.shipped, ...raw.overridden])]) {
    metadata[name] = templateMetadata(name, { cwd, rootDir: ROOT_DIR });
  }
  return { ...raw, metadata };
}

export async function agentContract(args = {}) {
  const {
    getAllContracts,
    getContractById,
    getContract,
    getOutgoingContracts,
    getIncomingContracts,
    summarize,
  } = await import('../../specialist-contracts.mjs');
  const { describePostconditions } = await import('../../specialists/postconditions.mjs');
  const { id, producer, consumer } = args;
  // Attach binary postconditions to every returned contract so a specialist
  // calling this tool at handoff time sees the hard checks their output
  // packet must pass — not just the free-text postconditions field.
  function attachPostconditions(c) {
    if (!c?.producer) return c;
    const binary = describePostconditions(c.producer);
    return binary.length > 0 ? { ...c, binaryPostconditions: binary } : c;
  }
  if (id) {
    const match = getContractById(String(id));
    return match ? { contract: attachPostconditions(match) } : { error: `Contract not found: ${id}` };
  }
  if (producer && consumer) {
    const match = getContract(String(producer), String(consumer));
    return match ? { contract: attachPostconditions(match) } : { error: `No contract for ${producer} → ${consumer}` };
  }
  if (producer) return { producer: String(producer), contracts: getOutgoingContracts(String(producer)).map(attachPostconditions) };
  if (consumer) return { consumer: String(consumer), contracts: getIncomingContracts(String(consumer)).map(attachPostconditions) };
  return { summary: summarize(), contracts: getAllContracts().map(attachPostconditions) };
}

export async function orchestrationPolicy(args) {
  // Use the LLM-verified router by default; it falls back to keyword-only
  // when no model is configured or the verifier errors. Callers that need
  // strictly synchronous behavior can import routeRequest directly.
  const route = await routeRequestVerified(args || {});
  const approvalRequired = requiresExecutiveApproval(args?.approval || {});
  const draftTask = route.track !== 'immediate'
    ? buildTaskPacketFromIntent(args?.request || '', { fileCount: args?.fileCount, moduleCount: args?.moduleCount })
    : null;
  const handoffPacket = route.track !== 'immediate'
    ? buildConstructToOrchestratorPacket({
      request: args?.request || '',
      route,
      goal: args?.goal,
      acceptanceCriteria: args?.acceptanceCriteria,
      fileCount: args?.fileCount,
      moduleCount: args?.moduleCount,
      introducesContract: args?.introducesContract,
      explicitDrive: args?.explicitDrive,
    })
    : null;

  // Per-specialist context packets: when the caller supplied a candidate
  // artifact list, build the role-filtered bundle each specialist should
  // receive. Each packet carries its own omitted-with-reason list so the
  // caller can see exactly what was dropped per role. The router lookup
  // strips the `cx-` prefix to match ROLE_POLICIES keys (which are
  // unprefixed, e.g. `engineer`, `product-manager`).
  let contextPackets = null;
  const candidates = Array.isArray(args?.candidates) ? args.candidates : null;
  if (candidates && route.specialists?.length > 0) {
    const { buildContextPacket } = await import('../../context-router.mjs');
    contextPackets = {};
    for (const specialist of route.specialists) {
      const role = specialist.replace(/^cx-/, '');
      contextPackets[specialist] = buildContextPacket({
        request: args?.request || '',
        triage: args?.triage || null,
        role,
        budget: args?.budget || {},
        candidates,
      });
    }
  }

  // Auto-generate a task graph when the caller names an intake packet.
  // The graph mirrors the triage's recommendedChain one-to-one and is
  // persisted to .cx/task-graphs/. Both intake.received and task_graph.created
  // trace events share the same traceId so the lineage is queryable end-to-end.
  let taskGraph = null;
  let intakeError = null;
  const intakeId = args?.intakeId;
  if (intakeId) {
    try {
      const { createIntakeQueue } = await import('../../intake/queue.mjs');
      const { generateTaskGraphFromTriage } = await import('../../task-graph/generate.mjs');
      const { FilesystemTaskGraphStore } = await import('../../task-graph/store.mjs');
      const { emitTraceEvent, newTraceId } = await import('../../worker/trace.mjs');
      const cwd = process.cwd();
      const queue = createIntakeQueue(cwd, process.env);
      const intake = await queue.read(intakeId);
      if (!intake) {
        intakeError = `intake packet not found: ${intakeId}`;
      } else if (!intake.triage) {
        intakeError = `intake packet ${intakeId} has no triage block`;
      } else {
        const traceId = args?.traceId || newTraceId();
        const graph = generateTaskGraphFromTriage({
          triage: intake.triage,
          project: args?.project || (cwd.split('/').pop() || 'construct'),
          request: args?.request || intake.excerpt || '',
          intake: intake.intake,
        });
        new FilesystemTaskGraphStore(cwd).save(graph);
        try {
          emitTraceEvent({
            rootDir: cwd,
            eventType: 'task_graph.created',
            traceId,
            project: graph.project,
            intakeId,
            metadata: {
              graphId: graph.id,
              nodes: graph.nodes.length,
              chain: graph.nodes.map((n) => n.owner),
              intakeType: intake.triage.intakeType,
              rdStage: intake.triage.rdStage,
            },
          });
        } catch { /* observability never breaks the caller */ }
        taskGraph = { ...graph, traceId };
      }
    } catch (err) {
      intakeError = err?.message || String(err);
    }
  }

  // A plan is not a tool. Weak models otherwise infer a tool name from
  // suggestedWorkflowType (e.g. research-synthesis → an invented
  // `research_synthesis` tool) or freelance raw host tools, bypassing the
  // governed specialist chain and its anti-fabrication persona. Hand back an
  // explicit, machine-actionable next step so the caller executes the plan
  // through orchestration_run instead of guessing. Omitted for the immediate
  // track, which needs no orchestration. worker_backend is left unset so the
  // project's configured backend (free/host/inline) is honored — never forced.
  const nextAction = route.track !== 'immediate'
    ? {
      tool: 'orchestration_run',
      arguments: { request: args?.request || '' },
      instruction: 'Execute this plan by calling the orchestration_run tool with the request above. suggestedWorkflowType is a plan label, not a tool — do not call it, and do not freelance raw web/file tools in its place.',
    }
    : null;

  return {
    ...route,
    specialistCatalog: buildSpecialistCatalog(),
    approvalRequired,
    terminalStates: TERMINAL_STATES,
    nextAction,
    draftTask,
    handoffPacket,
    ...(contextPackets ? { contextPackets } : {}),
    ...(taskGraph ? { taskGraph } : {}),
    ...(intakeError ? { intakeError } : {}),
  };
}

/**
 * broker_check — query the MCP broker's policy decision for a pending action.
 *
 * Agents call this BEFORE attempting a high-risk action. Returns the same
 * shape `Broker.invoke` would, minus the execute step: `{allowed, reason,
 * approvalRequired, source, brokerActive}`. Solo mode returns
 * `brokerActive: false` with `allowed: true` so agents skip the prompt
 * overhead when no broker is configured. Always emits a `tool.called`
 * trace event so the audit trail captures the consultation even when no
 * underlying tool is invoked.
 */
export async function brokerCheck(args = {}) {
  const { policyDecision } = await import('../../policy/engine.mjs');
  const { isBrokered } = await import('../broker.mjs');
  const { emitTraceEvent } = await import('../../worker/trace.mjs');
  const brokerActive = isBrokered(process.env);

  const baseEvent = {
    rootDir: process.cwd(),
    eventType: 'tool.called',
    traceId: args?.traceId,
    project: args?.project || null,
    role: args?.role || null,
  };

  if (!brokerActive) {
    try {
      emitTraceEvent({
        ...baseEvent,
        metadata: {
          tool: args?.tool || null,
          action: args?.action || null,
          risk: args?.risk || 'low',
          allowed: true,
          approvalRequired: false,
          source: 'broker-off',
          brokerActive: false,
        },
      });
    } catch { /* observability never breaks the caller */ }
    return {
      allowed: true,
      reason: 'broker inactive (solo mode default; set CONSTRUCT_MCP_BROKER=on to engage)',
      approvalRequired: false,
      source: 'broker-off',
      brokerActive: false,
    };
  }

  const decision = policyDecision({
    role: args?.role,
    project: args?.project,
    tool: args?.tool,
    action: args?.action,
    risk: args?.risk,
  });

  try {
    emitTraceEvent({
      ...baseEvent,
      metadata: {
        tool: args?.tool || null,
        action: args?.action || null,
        risk: args?.risk || 'low',
        allowed: decision.allowed,
        approvalRequired: decision.approvalRequired,
        source: decision.source,
        brokerActive: true,
      },
    });
  } catch { /* swallow */ }

  return { ...decision, brokerActive: true };
}

/**
 * worker_run — bounded command execution with optional task-graph evidence linkage.
 *
 * Wraps lib/worker/run.mjs `runJob`. Records evidence on the named task
 * graph node when both `graphId` and `nodeId` are provided; otherwise
 * returns the result without writing to a graph. Emits `worker.started`
 * / `worker.completed` trace events from inside runJob, plus an
 * `evidence.recorded` event when evidence is appended.
 *
 * Path policy: `allowedPaths` defaults to [cwd] so jobs can't reach
 * outside the project. Set explicitly to broaden, e.g. when staging
 * artifacts in a sibling worktree.
 */
export async function workerRun(args = {}) {
  const { runJob } = await import('../../worker/run.mjs');
  const { evidenceFromJobResult, recordEvidence } = await import('../../worker/evidence.mjs');
  const { FilesystemTaskGraphStore } = await import('../../task-graph/store.mjs');

  const cwd = process.cwd();
  const jobId = args?.jobId || `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const allowedPaths = Array.isArray(args?.allowedPaths) && args.allowedPaths.length > 0
    ? args.allowedPaths
    : [cwd];

  let result;
  try {
    result = await runJob({
      rootDir: cwd,
      job: {
        jobId,
        taskId: args?.nodeId || args?.taskId || null,
        project: args?.project || null,
        workspaceRef: args?.workspaceRef || cwd,
        command: args?.command,
        args: Array.isArray(args?.args) ? args.args : [],
        timeoutSeconds: args?.timeoutSeconds || 300,
        envPolicy: args?.envPolicy || 'restricted',
        allowedPaths,
        allowedEnvKeys: Array.isArray(args?.allowedEnvKeys) ? args.allowedEnvKeys : [],
        traceId: args?.traceId,
      },
    });
  } catch (err) {
    return { error: err?.message || String(err) };
  }

  // When the caller named a specific task graph node, append an evidence
  // record. The result includes the evidence shape so the caller can show
  // the user what was attached.
  let evidence = null;
  if (args?.graphId && args?.nodeId) {
    try {
      const store = new FilesystemTaskGraphStore(cwd);
      evidence = evidenceFromJobResult(result, {
        evidenceType: args?.evidenceType || 'test-result',
        summary: args?.evidenceSummary,
      });
      recordEvidence({
        store,
        graphId: args.graphId,
        nodeId: args.nodeId,
        evidence,
        rootDir: cwd,
      });
    } catch (err) {
      return { ...result, evidence: null, evidenceError: err?.message || String(err) };
    }
  }

  return { ...result, ...(evidence ? { evidence } : {}) };
}

export function suggestSkillsTool(args, { ROOT_DIR, cwd } = {}) {
  const intent = args?.intent || args?.query || '';
  return suggestSkills({
    intent,
    specialistId: args?.specialistId || args?.agentId,
    limit: args?.limit || 5,
    rootDir: ROOT_DIR,
    cwd: cwd || ROOT_DIR,
  });
}

export function listTeams({ ROOT_DIR } = {}) {
  const registry = loadRegistry({ rootDir: ROOT_DIR, skipValidation: true });
  return {
    groups: listGroupsHierarchical(registry),
    teams: Object.entries(registry.teams || {}).map(([id, t]) => ({ id, ...t })),
  };
}

export function getTeam(args, { ROOT_DIR } = {}) {
  const name = args?.name || args?.id;
  if (!name) return { error: 'Missing name argument' };
  const registry = loadRegistry({ rootDir: ROOT_DIR, skipValidation: true });
  const team = registry.teams?.[name];
  if (!team) return { error: `Team not found: ${name}`, available: Object.keys(registry.teams || {}) };
  return { id: name, ...team };
}
