#!/usr/bin/env node
/**
 * lib/mcp/server.mjs — Construct MCP server exposing workflow, skill, and observability tools.
 *
 * Provides MCP tools for agent health, workflow management, skill retrieval, and Langfuse telemetry.
 * Consumed by Claude Code, OpenCode, and any MCP-compatible host.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { extractDocumentText as extractLocalDocumentText } from '../document-extract.mjs';
import { ingestDocuments } from '../document-ingest.mjs';
import { deleteIngestedArtifacts, getStorageStatus, inferProjectName, resetStorage } from '../storage/admin.mjs';
import * as langfuse from '../telemetry/backends/langfuse.mjs';
import { summarizePromptComposition } from '../prompt-composer.mjs';
import { enrichMetadataWithPrompt } from '../prompt-metadata.mjs';
import { readCurrentModels, resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from '../model-router.mjs';
import { loadToolkitEnv } from '../toolkit-env.mjs';
import { loadConstructEnv } from '../env-config.mjs';
import { inspectContextState } from '../context-state.mjs';
import { listSessions, loadSession, searchSessions, updateSession, buildResumeContext } from '../session-store.mjs';
import { addObservation, searchObservations, listObservations } from '../observation-store.mjs';
import { createEntity, addObservationToEntity, searchEntities } from '../entity-store.mjs';
import { syncFileStateToSql } from '../storage/sync.mjs';

const DEFAULT_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DIR = resolve(process.env.CX_TOOLKIT_DIR || DEFAULT_ROOT_DIR);
loadToolkitEnv(ROOT_DIR);
import {
  addTask,
  addTaskFromIntent,
  addTasksFromPlan,
  alignmentFindings,
  createNeedsMainInputPacket,
  initWorkflow,
  inspectWorkflowHealth,
  loadWorkflow,
  summarizeWorkflow,
  updateTask,
  validateWorkflowState,
} from '../workflow-state.mjs';
import { buildPublicHealthSurface, buildStatus } from '../status.mjs';
import { routeRequest, requiresExecutiveApproval, TERMINAL_STATES } from '../orchestration-policy.mjs';

const SECRET_PATTERNS = [
  { name: 'Anthropic API key', pattern: /ANTHROPIC_API_KEY\s*=\s*(sk-ant-[a-zA-Z0-9\-_]{20,})/i },
  { name: 'OpenAI API key', pattern: /OPENAI_API_KEY\s*=\s*(sk-[a-zA-Z0-9]{40,})/i },
  { name: 'OpenRouter key', pattern: /(sk-or-v1-[a-zA-Z0-9]{40,})/ },
  { name: 'AWS access key', pattern: /(AKIA[0-9A-Z]{16})/ },
  { name: 'Private key (PEM)', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub personal access token', pattern: /(ghp_[a-zA-Z0-9]{36})/ },
  { name: 'GitHub Actions token', pattern: /(ghs_[a-zA-Z0-9]{36})/ },
  { name: 'Database URL with credentials', pattern: /DATABASE_URL\s*=\s*(postgresql:\/\/[^@]+:[^@]+@)/i },
];

const PLACEHOLDER_PATTERNS = [
  /\.\.\./,
  /YOUR_KEY/i,
  /<[^>]+>/,
  /^sk-\.\.\./,
  /^pk-lf-\.\.\./,
  /__[A-Z_]+__/,
];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value));
}

function isBinary(buffer) {
  const len = Math.min(buffer.length, 512);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function exec(cmd, cwd) {
  return execSync(cmd, { stdio: 'pipe', timeout: 10000, cwd }).toString().trim();
}

function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractDocumentText(args) {
  const filePath = resolve(String(args.file_path || ''));
  const maxChars = Number.isFinite(Number(args.max_chars)) && Number(args.max_chars) > 0
    ? Math.min(Number(args.max_chars), 200_000)
    : 20_000;

  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const extracted = extractLocalDocumentText(filePath, { maxChars });
    return {
      file_path: extracted.filePath,
      extension: extracted.extension,
      extraction_method: extracted.extractionMethod,
      text: extracted.text,
      truncated: extracted.truncated,
      characters: extracted.characters,
    };
  } catch (error) {
    return {
      error: `Failed to extract text from ${filePath}: ${error.message ?? String(error)}`,
    };
  }
}

async function ingestDocument(args) {
  const filePath = resolve(String(args.file_path || ''));
  const outputPath = args.out_path ? resolve(String(args.out_path)) : null;
  const outputDir = args.out_dir ? resolve(String(args.out_dir)) : null;
  const target = typeof args.target === 'string' && args.target ? args.target : 'product-intel';
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const sync = Boolean(args.sync);

  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    return await ingestDocuments([filePath], {
      cwd,
      outputPath,
      outputDir,
      target,
      sync,
      env: process.env,
    });
  } catch (error) {
    return {
      error: `Failed to ingest ${filePath}: ${error.message ?? String(error)}`,
    };
  }
}

async function storageStatus(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project ? String(args.project) : inferProjectName(cwd);
  return getStorageStatus(cwd, { env: process.env, project });
}

async function storageSync(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project ? String(args.project) : inferProjectName(cwd);
  return syncFileStateToSql(cwd, { env: process.env, project });
}

async function storageReset(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project ? String(args.project) : inferProjectName(cwd);
  if (args.confirm !== true) {
    return { error: 'storage_reset requires confirm=true' };
  }
  return resetStorage(cwd, {
    env: process.env,
    project,
    resetSql: args.reset_sql !== false,
    resetVector: args.reset_vector !== false,
    resetIngested: args.reset_ingested === true,
    confirm: true,
  });
}

function deleteIngestedArtifactsTool(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  if (args.confirm !== true) {
    return { error: 'delete_ingested_artifacts requires confirm=true' };
  }
  const files = Array.isArray(args.files)
    ? args.files.map((value) => String(value))
    : [];
  try {
    return deleteIngestedArtifacts(cwd, { files, confirm: true });
  } catch (error) {
    return { error: error.message ?? String(error) };
  }
}

// Tool: agent_health
function agentHealth(args) {
  const reviewDir = join(homedir(), '.cx', 'performance-reviews');

  if (!existsSync(reviewDir)) {
    return { error: "No performance reviews found. Run 'construct review' to generate one." };
  }

  let files;
  try {
    files = readdirSync(reviewDir);
  } catch {
    return { error: "No performance reviews found. Run 'construct review' to generate one." };
  }

  const processed = files
    .filter((f) => f.endsWith('.json') && !f.endsWith('-raw.json'))
    .sort()
    .reverse();

  const raw = files
    .filter((f) => f.endsWith('-raw.json'))
    .sort()
    .reverse();

  const candidates = processed.length > 0 ? processed : raw;

  if (candidates.length === 0) {
    return { error: "No performance reviews found. Run 'construct review' to generate one." };
  }

  let data;
  try {
    const content = readFileSync(join(reviewDir, candidates[0]), 'utf8');
    data = JSON.parse(content);
  } catch {
    return { error: "Failed to parse performance review file." };
  }

  const reviewDate = data.reviewDate ?? data.generatedAt ?? candidates[0].replace(/\.json$/, '');
  const period = data.period ?? data.windowDays ?? null;

  let agents = [];

  if (Array.isArray(data.agents)) {
    agents = data.agents;
  } else if (data.agentReviews) {
    agents = Object.entries(data.agentReviews).map(([name, review]) => ({
      name,
      status: review.status ?? review.health ?? 'unknown',
      avgScore: review.avgScore ?? review.averageScore ?? null,
      trend: review.trend ?? null,
      failureRate: review.failureRate ?? null,
      invocations: review.invocations ?? review.totalCalls ?? null,
    }));
  } else if (data.summary && Array.isArray(data.summary.agents)) {
    agents = data.summary.agents;
  }

  if (args.agent_name) {
    const target = args.agent_name.toLowerCase();
    agents = agents.filter((a) => (a.name ?? '').toLowerCase().includes(target));
  }

  const normalized = agents.map((a) => ({
    name: a.name ?? 'unknown',
    status: a.status ?? 'unknown',
    avgScore: a.avgScore ?? a.averageScore ?? null,
    trend: a.trend ?? null,
    failureRate: a.failureRate ?? null,
    invocations: a.invocations ?? a.totalCalls ?? null,
  }));

  return { reviewDate, period, agents: normalized };
}

// Tool: summarize_diff
function summarizeDiff(args) {
  const baseRef = args.base_ref ?? 'HEAD~1';
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();

  let stat, nameStatus;
  try {
    stat = exec(`git diff --stat ${baseRef}`, cwd);
    nameStatus = exec(`git diff --name-status ${baseRef}`, cwd);
  } catch {
    return { error: 'Not a git repository or git not available' };
  }

  const changes = nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split('\t');
      return { status: status.trim(), file: parts.join('\t') };
    });

  // Parse insertions/deletions from stat summary line
  const statLines = stat.split('\n');
  const summaryLine = statLines[statLines.length - 1] ?? '';
  const filesMatch = summaryLine.match(/(\d+) files? changed/);
  const insertionsMatch = summaryLine.match(/(\d+) insertions?\(\+\)/);
  const deletionsMatch = summaryLine.match(/(\d+) deletions?\(-\)/);

  const filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : changes.length;
  const insertions = insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0;
  const deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;

  const added = changes.filter((c) => c.status === 'A').length;
  const modified = changes.filter((c) => c.status === 'M').length;
  const deleted = changes.filter((c) => c.status === 'D').length;

  const parts = [];
  if (modified > 0) parts.push(`${modified} file${modified > 1 ? 's' : ''} modified`);
  if (added > 0) parts.push(`${added} file${added > 1 ? 's' : ''} added`);
  if (deleted > 0) parts.push(`${deleted} file${deleted > 1 ? 's' : ''} deleted`);

  const summary =
    parts.length > 0
      ? `${parts.join(', ')} (+${insertions}/-${deletions} lines) vs ${baseRef}.`
      : `No changes vs ${baseRef}.`;

  return { base_ref: baseRef, files_changed: filesChanged, insertions, deletions, changes, summary };
}

// Tool: scan_file
function scanFile(args) {
  const filePath = resolve(args.file_path);

  let rawBuffer;
  try {
    rawBuffer = readFileSync(filePath);
  } catch (err) {
    return { error: `Cannot read file: ${err.message}` };
  }

  if (isBinary(rawBuffer)) {
    return { file_path: filePath, secrets: [], quality_issues: [], clean: true };
  }

  const content = rawBuffer.toString('utf8');
  const lines = content.split('\n');

  // Secret scanning
  const secrets = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const captured = match[1] ?? match[0];
      if (isPlaceholder(captured)) continue;
      secrets.push({
        pattern: name,
        line: i + 1,
        masked_value: captured.slice(0, 20) + '...',
      });
    }
  }

  // Quality scanning
  const quality_issues = [];

  if (lines.length > 800) {
    quality_issues.push({ type: 'file_too_long', detail: `File has ${lines.length} lines (limit: 800)` });
  }

  // Detect oversized functions via simple heuristic
  const funcKeywords = /^\s*(function\s+\w+|async\s+function\s+\w+|\w+\s*=\s*(?:async\s+)?\(|def\s+\w+|func\s+\w+)/;
  let funcStart = null;
  let braceDepth = 0;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (funcKeywords.test(line)) {
      funcStart = i + 1;
      braceDepth = 0;
      inBlock = false;
    }

    if (funcStart !== null) {
      for (const ch of line) {
        if (ch === '{') { braceDepth++; inBlock = true; }
        else if (ch === '}') { braceDepth--; }
      }
      if (inBlock && braceDepth <= 0) {
        const funcLen = i + 1 - funcStart + 1;
        if (funcLen > 50) {
          quality_issues.push({
            type: 'function_too_long',
            detail: `Function starting at line ${funcStart} is ${funcLen} lines (limit: 50)`,
            line: funcStart,
          });
        }
        funcStart = null;
        inBlock = false;
        braceDepth = 0;
      }
    }

    // TODO/FIXME/HACK comments
    const todoMatch = /\/\/\s*(TODO|FIXME|HACK)\b|#\s*(TODO|FIXME|HACK)\b/i.exec(line);
    if (todoMatch) {
      const tag = (todoMatch[1] ?? todoMatch[2]).toUpperCase();
      quality_issues.push({
        type: 'comment_marker',
        detail: `${tag} comment`,
        line: i + 1,
      });
    }
  }

  return {
    file_path: filePath,
    secrets,
    quality_issues,
    clean: secrets.length === 0 && quality_issues.length === 0,
  };
}

// Tool: project_context
function projectContext(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const contextInspection = inspectContextState(cwd);
  const context_state = contextInspection.state;
  const context = context_state?.markdown || null;
  const has_context_file = contextInspection.hasFile;
  const workflow = loadWorkflow(cwd);
  const mergedEnv = loadConstructEnv({ rootDir: ROOT_DIR, homeDir: homedir(), env: process.env });
  const registry = readJSON(join(ROOT_DIR, 'agents', 'registry.json')) ?? {};
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: mergedEnv,
    registryModels: registry.models ?? {},
    requestedTier: selectModelTierForWorkCategory(workflow?.tasks?.find((task) => task.key === workflow?.currentTaskKey)?.workCategory),
    workCategory: null,
  });
  const publicHealth = buildPublicHealthSurface({
    cwd,
    contextInspection,
    workflow,
    executionContractModel,
  });

  let recent_commits = [];
  let working_tree_status = 'clean';
  let changed_files = [];

  try {
    const log = exec('git log --oneline -10', cwd);
    recent_commits = log.split('\n').filter(Boolean);
  } catch {
    // not a git repo or no commits
  }

  try {
    const status = exec('git status --short', cwd);
    const statusLines = status.split('\n').filter(Boolean);
    changed_files = statusLines.map((l) => l.trim());
    working_tree_status = statusLines.length > 0 ? 'dirty' : 'clean';
  } catch {
    // not a git repo
  }

  return { cwd, has_context_file, context, context_state, recent_commits, working_tree_status, changed_files, publicHealth };
}

function orchestrationPolicy(args) {
  const route = routeRequest(args || {});
  const approvalRequired = requiresExecutiveApproval(args?.approval || {});
  return {
    ...route,
    approvalRequired,
    terminalStates: TERMINAL_STATES,
  };
}

// Tool: list_skills
function listSkills() {
  const skillsDir = join(ROOT_DIR, 'skills');
  if (!existsSync(skillsDir)) return { error: 'Skills directory not found.' };

  const listDirRecursive = (dir, prefix = '') => {
    let results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        results = results.concat(listDirRecursive(join(dir, entry.name), `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
        results.push(`${prefix}${entry.name.replace('.md', '')}`);
      }
    }
    return results;
  };

  const skills = listDirRecursive(skillsDir).sort();
  return { skills };
}

// Tool: get_skill
function getSkill(args) {
  const { path: skillPath } = args;
  if (!skillPath) return { error: 'Missing path argument' };

  const fullPath = join(ROOT_DIR, 'skills', `${skillPath}.md`);

  if (!existsSync(fullPath)) {
    return { error: `Skill not found: ${skillPath}` };
  }
  const content = readFileSync(fullPath, 'utf8');
  return { content };
}

// Tool: get_template
function getTemplate(args) {
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
      return { source, path: p, content: readFileSync(p, 'utf8') };
    }
  }
  return { error: `Template not found: ${safe}`, available: listTemplatesRaw() };
}

function listTemplatesRaw() {
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

// Tool: list_templates
function listTemplates() {
  return listTemplatesRaw();
}

// Tool: search_skills
function searchSkills(args) {
  const { pattern } = args;
  if (!pattern) return { error: 'Missing pattern argument' };
  const skillsDir = join(ROOT_DIR, 'skills');

  try {
    // Try ripgrep first
    const output = execSync(`rg -i "${pattern.replace(/"/g, '\\"')}" "${skillsDir}"`, { encoding: 'utf8' });
    return { results: output.split('\n').filter(Boolean) };
  } catch (err) {
    // Fallback to basic grep
    try {
      const output = execSync(`grep -ri "${pattern.replace(/"/g, '\\"')}" "${skillsDir}"`, { encoding: 'utf8' });
      return { results: output.split('\n').filter(Boolean) };
    } catch (err2) {
      return { results: [], note: 'No matches found or grep error' };
    }
  }
}

function workflowStatus(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const workflow = loadWorkflow(cwd);
  const workflowHealth = inspectWorkflowHealth(workflow, { cwd });
  const mergedEnv = loadConstructEnv({ rootDir: ROOT_DIR, homeDir: homedir(), env: process.env });
  const registry = readJSON(join(ROOT_DIR, 'agents', 'registry.json')) ?? {};
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: mergedEnv,
    registryModels: registry.models ?? {},
    requestedTier: selectModelTierForWorkCategory(workflow?.tasks?.find((task) => task.key === workflow?.currentTaskKey)?.workCategory),
    workCategory: null,
  });
  const publicHealth = buildPublicHealthSurface({
    cwd,
    workflow,
    executionContractModel,
  });
  return {
    cwd,
    exists: Boolean(workflow),
    summary: summarizeWorkflow(workflow),
    workflow,
    alignment: {
      status: workflowHealth.alignment.status,
      findings: workflowHealth.alignment.findings,
    },
    publicHealth,
  };
}

function workflowInit(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const title = args.title || 'Untitled workflow';
  const { workflow, created } = initWorkflow(cwd, title, args.spec_ref ?? null);
  return { cwd, created, workflow, summary: summarizeWorkflow(workflow) };
}

// Tool: list_teams
function listTeams() {
  const teamsPath = join(ROOT_DIR, 'agents', 'teams.json');
  if (!existsSync(teamsPath)) return { error: 'agents/teams.json not found' };
  const { templates } = JSON.parse(readFileSync(teamsPath, 'utf8'));
  return {
    teams: Object.entries(templates).map(([name, t]) => ({
      name,
      description: t.description,
      members: t.members,
      focus: t.focus,
      skills: t.skills,
      promotionGates: t.promotionGates,
    })),
  };
}

// Tool: get_team
function getTeam(args) {
  const { name } = args;
  if (!name) return { error: 'Missing name argument' };
  const teamsPath = join(ROOT_DIR, 'agents', 'teams.json');
  if (!existsSync(teamsPath)) return { error: 'agents/teams.json not found' };
  const { templates } = JSON.parse(readFileSync(teamsPath, 'utf8'));
  const team = templates[name];
  if (!team) return { error: `Team not found: ${name}`, available: Object.keys(templates) };
  return { name, ...team };
}

function workflowAddTask(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  if (args.request) {
    const workflow = addTaskFromIntent(cwd, args.request, {
      key: args.key,
      title: args.title,
      phase: args.phase,
      owner: args.owner,
      files: args.files,
      readFirst: args.readFirst,
      doNotChange: args.doNotChange,
      acceptanceCriteria: args.acceptanceCriteria,
      verification: args.verification,
      overlays: args.overlays,
      challengeRequired: args.challengeRequired,
      challengeStatus: args.challengeStatus,
      tokenBudget: args.tokenBudget,
      status: args.status,
    });
    if (!workflow) return { ok: true, skipped: true, reason: 'immediate-track' };
    return { cwd, workflow, summary: summarizeWorkflow(workflow), source: 'intent' };
  }
  const workflow = addTask(cwd, {
    key: args.key,
    title: args.title,
    phase: args.phase,
    owner: args.owner,
    files: args.files,
    readFirst: args.readFirst,
    doNotChange: args.doNotChange,
    acceptanceCriteria: args.acceptanceCriteria,
    verification: args.verification,
    dependsOn: args.dependsOn,
    overlays: args.overlays,
    challengeRequired: args.challengeRequired,
    challengeStatus: args.challengeStatus,
  });
  return { cwd, workflow, summary: summarizeWorkflow(workflow), source: 'manual' };
}

function workflowUpdateTask(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const workflow = updateTask(cwd, args.key, {
    status: args.status,
    owner: args.owner,
    phase: args.phase,
    note: args.note,
    verification: args.verification,
    overlays: args.overlays,
    challengeRequired: args.challengeRequired,
    challengeStatus: args.challengeStatus,
  });
  return { cwd, workflow, summary: summarizeWorkflow(workflow) };
}

function workflowNeedsMainInput(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const packet = createNeedsMainInputPacket(args);
  const workflow = updateTask(cwd, args.taskKey, {
    status: 'blocked_needs_user',
    note: `${packet.worker}: ${packet.blocker} | question: ${packet.question}`,
  });
  return { cwd, packet, workflow, summary: summarizeWorkflow(workflow) };
}

function workflowValidate(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const workflow = loadWorkflow(cwd);
  const result = validateWorkflowState(workflow);
  return { cwd, ...result };
}

function workflowImportPlan(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const markdown = args.markdown ?? '';
  const { workflow, count } = addTasksFromPlan(cwd, markdown, {
    phase: args.phase,
    owner: args.owner,
    readFirst: Array.isArray(args.readFirst) ? args.readFirst : undefined,
    doNotChange: Array.isArray(args.doNotChange) ? args.doNotChange : undefined,
    acceptanceCriteria: Array.isArray(args.acceptanceCriteria) ? args.acceptanceCriteria : undefined,
    workflowTitle: args.title,
    specRef: args.spec_ref,
  });
  return { cwd, count, workflow, summary: summarizeWorkflow(workflow) };
}

function resolveReleaseTag(cwd) {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: 'pipe', cwd, timeout: 2000 }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveSessionContext() {
  const cwd = process.cwd();
  let workflowId;
  let workflowPhase;
  let workflowOwner;
  try {
    const wf = loadWorkflow(cwd);
    if (wf) {
      workflowId = wf.id;
      workflowPhase = wf.phase;
      const active = (wf.tasks || []).find((t) => t.status === 'in-progress' || t.status === 'in_progress');
      if (active) workflowOwner = active.owner;
    }
  } catch { /* best effort */ }
  const sessionId = process.env.CLAUDE_SESSION_ID
    || process.env.CX_SESSION_ID
    || process.env.OPENCODE_SESSION_ID
    || workflowId;
  const userId = process.env.USER || process.env.USERNAME || process.env.LOGNAME;
  return { cwd, sessionId, userId, release: resolveReleaseTag(cwd), workflowPhase, workflowOwner, workflowId };
}

function langfuseHeaders() {
  const key = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  if (!key || !secret) throw new Error('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set.');
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function langfuseBaseUrl() {
  return (process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
}

async function cxTrace(args) {
  const ctx = resolveSessionContext();
  const registry = readJSON(join(ROOT_DIR, 'agents', 'registry.json')) ?? {};
  const registryModels = registry.models ?? {};
  const currentModels = readCurrentModels(join(ROOT_DIR, '.env'), registryModels, process.env);
  const route = typeof args.input === 'string' ? routeRequest({ request: args.input }) : null;
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: currentModels,
    registryModels,
    requestedTier: selectModelTierForWorkCategory(route?.workCategory),
    workCategory: route?.workCategory || null,
  });
  const runtimePromptMetadata = summarizePromptComposition(args.name, {
    rootDir: ROOT_DIR,
    request: typeof args.input === 'string' ? args.input : '',
    route,
    registryModels,
    envValues: currentModels,
    executionContractModel,
    hostConstraints: {
      runtime: 'mcp',
      providerAgnostic: true,
      telemetryBackend: 'langfuse',
    },
  });
  const metadata = enrichMetadataWithPrompt(args.name, {
    ...(args.metadata && typeof args.metadata === 'object' ? args.metadata : {}),
    ...runtimePromptMetadata,
    workflowId: ctx.workflowId,
    workflowPhase: ctx.workflowPhase,
    workflowOwner: ctx.workflowOwner,
    release: ctx.release,
  }, { rootDir: ROOT_DIR });
  const traceId = args.id ?? crypto.randomUUID();
  try {
    const available = await langfuse.isAvailable();
    if (!available) return { ok: false, error: 'Langfuse credentials not configured', id: traceId };
    const teamId = args.metadata?.teamId ?? metadata.teamId;
    const body = {
      id: traceId,
      name: args.name,
      metadata: {
        ...metadata,
        agentName: args.name,
        goal: typeof args.input === 'string' ? args.input : JSON.stringify(args.input ?? ''),
        teamId,
      },
      tags: [args.name, teamId].filter(Boolean),
      userId: ctx.userId,
      sessionId: args.session_id || ctx.sessionId,
      input: args.input,
      output: args.output,
      timestamp: args.timestamp ?? new Date().toISOString(),
      release: ctx.release,
    };
    const res = await fetch(`${langfuseBaseUrl()}/api/public/traces`, {
      method: 'POST',
      headers: langfuseHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Langfuse API error ${res.status}: ${text}`, id: traceId };
    }
    return { ok: true, id: traceId };
  } catch (err) {
    return { ok: false, error: err.message, id: traceId };
  }
}

async function cxScore(args) {
  const traceId = args.trace_id ?? '';
  try {
    const available = await langfuse.isAvailable();
    if (!available) return { ok: false, error: 'Langfuse credentials not configured' };
    const body = {
      id: crypto.randomUUID(),
      traceId,
      name: args.name ?? 'quality',
      value: args.value,
      dataType: 'NUMERIC',
      comment: args.comment,
    };
    const res = await fetch(`${langfuseBaseUrl()}/api/public/scores`, {
      method: 'POST',
      headers: langfuseHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Langfuse API error ${res.status}: ${text}` };
    }
    return { ok: true, traceId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sessionUsage(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const homeDir = args.home_dir ? resolve(args.home_dir) : homedir();
  const status = await buildStatus({ rootDir: ROOT_DIR, cwd, homeDir, env: process.env });
  return {
    cwd,
    sessionUsage: status.sessionUsage,
  };
}

// Server setup
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
            description: 'Output mode: product-intel | sibling (default: product-intel).',
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
            description: 'Set true to also delete ingested markdown artifacts under .cx/product-intel/sources/ingested.',
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
            description: 'Optional relative file paths under .cx/product-intel/sources/ingested. Omit to delete all ingested markdown artifacts.',
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
      description: 'Classifies a request into intent, execution track, specialists, and approval boundaries.',
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
      name: 'workflow_status',
      description: 'Returns Construct .cx/workflow.json state and alignment findings.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
        },
      },
    },
    {
      name: 'workflow_init',
      description: 'Creates .cx/workflow.json if missing and returns the workflow state.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Project directory (default: process.cwd()).' },
          title: { type: 'string', description: 'Workflow title.' },
          spec_ref: { type: 'string', description: 'Path to the governing spec/plan document (e.g. .cx/plans/feature-x.md).' },
        },
      },
    },
    {
      name: 'workflow_add_task',
      description: 'Adds a Construct task packet to .cx/workflow.json.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          key: { type: 'string' },
          title: { type: 'string' },
          phase: { type: 'string' },
          owner: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          readFirst: { type: 'array', items: { type: 'string' } },
          doNotChange: { type: 'array', items: { type: 'string' } },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          verification: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },
          overlays: { type: 'array', items: { type: 'string' } },
          challengeRequired: { type: 'boolean' },
          challengeStatus: { type: 'string' },
        },
        required: ['title', 'owner', 'acceptanceCriteria'],
      },
    },
    {
      name: 'workflow_update_task',
      description: 'Updates a task status, owner, phase, note, or verification evidence in .cx/workflow.json.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          key: { type: 'string' },
          status: { type: 'string' },
          owner: { type: 'string' },
          phase: { type: 'string' },
          note: { type: 'string' },
          verification: { type: 'array', items: { type: 'string' } },
          overlays: { type: 'array', items: { type: 'string' } },
          challengeRequired: { type: 'boolean' },
          challengeStatus: { type: 'string' },
        },
        required: ['key'],
      },
    },
    {
      name: 'workflow_needs_main_input',
      description: 'Records a blocked_needs_user task and returns a NEEDS_MAIN_INPUT packet for the primary persona.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          taskKey: { type: 'string' },
          worker: { type: 'string' },
          blocker: { type: 'string' },
          question: { type: 'string' },
          safeDefault: { type: 'string' },
          context: { type: 'array', items: { type: 'string' } },
        },
        required: ['taskKey', 'worker', 'blocker', 'question'],
      },
    },
    {
      name: 'workflow_validate',
      description: 'Validates .cx/workflow.json schema and high-severity alignment findings.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
        },
      },
    },
    {
      name: 'workflow_import_plan',
      description: 'Parses a plan document (markdown) into structured workflow task packets and writes them to .cx/workflow.json. Supports rich ### T1 — Title sections with Owner/Phase/Files/Depends on/Read first/Do not change/Acceptance criteria fields.',
      inputSchema: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: 'The plan document markdown to parse into tasks' },
          cwd: { type: 'string', description: 'Project directory (default: cwd)' },
          title: { type: 'string', description: 'Workflow title if creating a new workflow' },
          spec_ref: { type: 'string', description: 'Path to the governing spec/plan document (e.g. .cx/plans/feature-x.md)' },
          phase: { type: 'string', description: 'Default phase for tasks without an explicit phase (default: implement)' },
          owner: { type: 'string', description: 'Default owner for tasks without an explicit owner (default: cx-engineer)' },
          readFirst: { type: 'array', items: { type: 'string' }, description: 'Default readFirst list applied to tasks without one' },
          doNotChange: { type: 'array', items: { type: 'string' }, description: 'Default doNotChange list applied to all tasks' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Extra acceptance criteria appended to each task' },
        },
        required: ['markdown'],
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
    else if (name === 'storage_status') result = await storageStatus(args);
    else if (name === 'storage_sync') result = await storageSync(args);
    else if (name === 'storage_reset') result = await storageReset(args);
    else if (name === 'delete_ingested_artifacts') result = deleteIngestedArtifactsTool(args);
    else if (name === 'project_context') result = projectContext(args);
    else if (name === 'orchestration_policy') result = orchestrationPolicy(args);
    else if (name === 'list_skills') result = listSkills();
    else if (name === 'get_skill') result = getSkill(args);
    else if (name === 'search_skills') result = searchSkills(args);
    else if (name === 'get_template') result = getTemplate(args);
    else if (name === 'list_templates') result = listTemplates();
    else if (name === 'workflow_status') result = workflowStatus(args);
    else if (name === 'workflow_init') result = workflowInit(args);
    else if (name === 'workflow_add_task') result = workflowAddTask(args);
    else if (name === 'workflow_update_task') result = workflowUpdateTask(args);
    else if (name === 'workflow_needs_main_input') result = workflowNeedsMainInput(args);
    else if (name === 'workflow_validate') result = workflowValidate(args);
    else if (name === 'workflow_import_plan') result = workflowImportPlan(args);
    else if (name === 'list_teams') result = listTeams();
    else if (name === 'get_team') result = getTeam(args);
    else if (name === 'cx_trace') result = await cxTrace(args);
    else if (name === 'cx_score') result = await cxScore(args);
    else if (name === 'session_list') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      result = listSessions(cwd, { status: args.status || null, limit: args.limit || 20 });
    }
    else if (name === 'session_load') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      const session = loadSession(cwd, String(args.session_id));
      if (!session) result = { error: 'Session not found: ' + args.session_id };
      else result = { ...session, resumeContext: buildResumeContext(session) };
    }
    else if (name === 'session_search') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      result = searchSessions(cwd, String(args.query || ''));
    }
    else if (name === 'session_save') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      const updates = {};
      if (args.summary) updates.summary = args.summary;
      if (args.decisions) updates.decisions = args.decisions;
      if (args.files_changed) updates.filesChanged = args.files_changed;
      if (args.open_questions) updates.openQuestions = args.open_questions;
      if (args.task_snapshot) updates.taskSnapshot = args.task_snapshot;
      if (args.status) updates.status = args.status;
      const updated = updateSession(cwd, String(args.session_id), updates);
      if (!updated) result = { error: 'Session not found: ' + args.session_id };
      else result = updated;
    }
    else if (name === 'memory_search') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      const project = args.project || null;
      result = searchObservations(cwd, String(args.query || ''), {
        role: args.role || null,
        category: args.category || null,
        project,
        limit: args.limit || 10,
      });
      if (!result || result.length === 0) {
        result = listObservations(cwd, { project, limit: 5 });
        if (result.length > 0) result = { matches: result, note: 'No semantic matches — showing recent observations.' };
        else result = { matches: [], note: 'No observations recorded yet. Use memory_add_observations to capture patterns and insights.' };
      }
    }
    else if (name === 'memory_add_observations') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      const project = args.project || cwd.split('/').pop() || 'unknown';
      const observations = (args.observations || []).slice(0, 10);
      const created = [];
      for (const obs of observations) {
        const record = addObservation(cwd, {
          role: obs.role || 'unknown',
          category: obs.category || 'insight',
          summary: obs.summary || '',
          content: obs.content || obs.summary || '',
          tags: obs.tags || [],
          project,
          confidence: obs.confidence ?? 0.8,
          source: obs.source || null,
        });
        if (record) created.push({ id: record.id, summary: record.summary });
      }
      result = { created, count: created.length };
    }
    else if (name === 'memory_create_entities') {
      const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
      const project = args.project || cwd.split('/').pop() || 'unknown';
      const entities = (args.entities || []).slice(0, 10);
      const created = [];
      for (const ent of entities) {
        const record = createEntity(cwd, {
          name: ent.name || '',
          type: ent.type || 'concept',
          summary: ent.summary || '',
          project,
          observationIds: ent.observation_ids || [],
        });
        if (record) created.push({ name: record.name, type: record.type });
      }
      result = { created, count: created.length };
    }
        else if (name === 'session_usage') result = await sessionUsage(args);
    else result = { error: `Unknown tool: ${name}` };
  } catch (err) {
    result = { error: err.message ?? String(err) };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});

export {
  cxTrace,
  projectContext,
  workflowStatus,
  extractDocumentText,
  ingestDocument,
  storageStatus,
  storageSync,
  storageReset,
  deleteIngestedArtifactsTool,
};

const argv1Real = (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })();
if (fileURLToPath(import.meta.url) === argv1Real) {
  console.error('[construct-mcp] server started');
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
