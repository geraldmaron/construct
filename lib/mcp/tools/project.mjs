/**
 * lib/mcp/tools/project.mjs — Project-level MCP tools: agent health, diff summary, file scan, and project context.
 *
 * Exposes agentHealth, summarizeDiff, scanFile, and projectContext.
 * All tools are synchronous except where noted. Requires ROOT_DIR and homedir from the caller.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { loadConstructEnv } from '../../env-config.mjs';
import { inspectContextState } from '../../context-state.mjs';
import { loadWorkflow, summarizeWorkflow, inspectWorkflowHealth } from '../../workflow-state.mjs';
import { readCurrentModels, resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from '../../model-router.mjs';
import { buildPublicHealthSurface } from '../../status.mjs';

export function exec(cmd, cwd) {
  return execSync(cmd, { stdio: 'pipe', timeout: 10000, cwd }).toString().trim();
}

export function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

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

export function agentHealth(args) {
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
    return { error: 'Failed to parse performance review file.' };
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

export function summarizeDiff(args) {
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

export function scanFile(args) {
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

  const quality_issues = [];

  if (lines.length > 800) {
    quality_issues.push({ type: 'file_too_long', detail: `File has ${lines.length} lines (limit: 800)` });
  }

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

export function projectContext(args, { ROOT_DIR }) {
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

export function workflowStatus(args, { ROOT_DIR }) {
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
