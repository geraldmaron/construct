/**
 * lib/server/index.mjs — Construct dashboard HTTP server.
 *
 * Serves the single-page dashboard from lib/server/static/, provides a JSON
 * status API, SSE live-reload, REST endpoints for registry management,
 * artifact generation/listing, approval queue inspection, snapshot data,
 * token-based auth, and SSE-streamed chat via the claude CLI.
 * Runs on port 4242 (overridable via PORT env var), bound to 127.0.0.1.
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, statSync, watch, existsSync, readdirSync, mkdirSync, renameSync, chmodSync, appendFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, extname, relative, normalize, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStatus as buildSharedStatus } from '../status.mjs';
import { generateArtifact, listArtifacts } from '../embed/artifact.mjs';
import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { resolveEmbedStatus } from '../embed/cli.mjs';
import { loadConstructEnv } from '../env-config.mjs';
import {
  isAuthConfigured, isAuthenticated, rejectUnauthorized,
  validateToken, createSession, sessionCookieHeader, clearSessionCookieHeader,
  getDashboardToken, getAuthConfig,
} from './auth.mjs';
import { handleChatStream, handleChat, handleChatHistory } from './chat.mjs';
import { createWebhookHandler, createSlackCommandHandler } from './webhook.mjs';
import { onEmbedNotification } from '../embed/notifications.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const HOME = homedir();
const PORT = parseInt(process.env.PORT ?? '4242', 10);
const BIND_HOST = process.env.BIND_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const STATIC_DIR = join(__dirname, 'static');
const REGISTRY_FILE = join(ROOT_DIR, 'agents', 'registry.json');
const FEATURES_FILE = join(HOME, '.construct', 'features.json');
const WORKFLOW_FILE = join(ROOT_DIR, 'plan.md');
const SKILLS_DIR = join(ROOT_DIR, 'skills');
const COMMANDS_DIR = join(ROOT_DIR, 'commands');
const SNAPSHOTS_FILE = join(HOME, '.cx', 'snapshots.jsonl');
const APPROVAL_QUEUE_FILE = join(HOME, '.cx', 'approval-queue.jsonl');
const CONFIG_ENV_FILE = join(HOME, '.construct', 'config.env');
const EMBED_YAML_FILE = join(HOME, '.construct', 'embed.yaml');
const CREDENTIAL_AUDIT_FILE = join(HOME, '.cx', 'credential-audit.jsonl');

// Provider → expected env vars. Source of truth for the credentials surface,
// the per-provider health classification ("not configured" vs "unhealthy"),
// and the write-side allowlist — POST refuses env vars not listed here.

const BUILTIN_CREDENTIAL_MAP = [
  { provider: 'anthropic',           label: 'Anthropic',     kind: 'llm',         envVars: ['ANTHROPIC_API_KEY'] },
  { provider: 'openai',              label: 'OpenAI',        kind: 'llm',         envVars: ['OPENAI_API_KEY'] },
  { provider: 'openrouter',          label: 'OpenRouter',    kind: 'llm',         envVars: ['OPENROUTER_API_KEY'] },
  { provider: 'gemini',              label: 'Google Gemini', kind: 'llm',         envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  { provider: 'github',              label: 'GitHub',        kind: 'integration', envVars: ['GITHUB_TOKEN', 'GH_TOKEN'] },
  { provider: 'atlassian-jira',      label: 'Jira',          kind: 'integration', envVars: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] },
  { provider: 'atlassian-confluence',label: 'Confluence',    kind: 'integration', envVars: ['CONFLUENCE_BASE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN'] },
  { provider: 'slack',               label: 'Slack',         kind: 'integration', envVars: ['SLACK_BOT_TOKEN', 'SLACK_USER_TOKEN'] },
  { provider: 'salesforce',          label: 'Salesforce',    kind: 'integration', envVars: ['SALESFORCE_INSTANCE_URL', 'SALESFORCE_ACCESS_TOKEN'] },
];

const CUSTOM_CREDENTIALS_FILE = join(HOME, '.construct', 'custom-credentials.json');

// Env-var name validator: must match POSIX shell variable syntax and avoid
// stomping built-in entries. Refusing $PATH / $HOME / OS-special prefixes
// keeps a custom provider from being a foot-gun for the shell.
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const ENV_VAR_BLOCKLIST = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'PWD', 'TERM']);

function readCustomCredentials() {
  if (!existsSync(CUSTOM_CREDENTIALS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(CUSTOM_CREDENTIALS_FILE, 'utf8'));
    const list = Array.isArray(raw?.providers) ? raw.providers : [];
    return list.filter((entry) => {
      if (!entry || typeof entry.provider !== 'string') return false;
      if (BUILTIN_CREDENTIAL_MAP.some((b) => b.provider === entry.provider)) return false;
      if (!Array.isArray(entry.envVars)) return false;
      return entry.envVars.every((name) => ENV_VAR_PATTERN.test(name) && !ENV_VAR_BLOCKLIST.has(name));
    });
  } catch {
    return [];
  }
}

function writeCustomCredentials(list) {
  mkdirSync(dirname(CUSTOM_CREDENTIALS_FILE), { recursive: true });
  writeFileSync(CUSTOM_CREDENTIALS_FILE, JSON.stringify({ providers: list }, null, 2) + '\n');
  try { chmodSync(CUSTOM_CREDENTIALS_FILE, 0o600); } catch { /* perms best-effort */ }
}

function credentialMap() {
  return [...BUILTIN_CREDENTIAL_MAP, ...readCustomCredentials()];
}

function allowedCredentialEnvVars() {
  return new Set(credentialMap().flatMap((c) => c.envVars));
}

function maskValue(value) {
  if (!value) return null;
  if (value.length <= 10) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function buildCredentialsView(env = process.env) {
  return credentialMap().map(c => {
    const vars = c.envVars.map(name => {
      const val = resolveCredential(name, env);
      const set = Boolean(val);
      return { envVar: name, set, preview: set ? maskValue(val) : null };
    });
    const setCount = vars.filter(v => v.set).length;
    let configured;
    if (setCount === 0) configured = 'none';
    else if (setCount === c.envVars.length) configured = 'full';
    else configured = 'partial';
    return { provider: c.provider, label: c.label, kind: c.kind, vars, configured };
  });
}

// A provider with no required env vars set is "not_configured" regardless of
// whether the probe succeeds — some probes (e.g. GitHub anonymous rate_limit)
// return ok:true even with zero auth, which would otherwise read as a green
// "Healthy" while the credentials column shows everything blank.

/**
 * Resolve a credential from env, config.env, ~/.env, and shell rc files.
 * Mirrors the logic in model-router.mjs isProviderConfigured.
 */
function resolveCredential(varName, env) {
  if (env[varName] && typeof env[varName] === 'string' && env[varName].length > 0) return env[varName];
  const homeDir = HOME || homedir();

  // Special case: Ollama on default port
  if (varName === 'OLLAMA_BASE_URL') {
    try {
      const r = spawnSync('curl', ['-s', '--connect-timeout', '1', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:11434/api/tags'], { encoding: 'utf8', timeout: 3000 });
      if (r.status === 0 && r.stdout?.trim() === '200') return 'http://localhost:11434';
    } catch { /* not available */ }
    try {
      const r = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 2000 });
      if (r.status === 0) return 'found-ollama-binary';
    } catch { /* not available */ }
  }

  const paths = [join(homeDir, '.construct', 'config.env'), join(homeDir, '.env')];
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8');
        const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
        if (m && m[1]) return m[1].trim();
      }
    } catch { /* skip */ }
  }
  // Check shell rc files for op:// refs
  const shellFiles = [join(homeDir, '.zshrc'), join(homeDir, '.bashrc'), join(homeDir, '.bash_profile'), join(homeDir, '.profile')];
  for (const rc of shellFiles) {
    if (!existsSync(rc)) continue;
    try {
      const content = readFileSync(rc, 'utf8');
      const directRe = new RegExp(`^\\s*export\\s+${varName}=`, 'm');
      if (directRe.test(content)) return 'found-in-rc';
      const opRe = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
      const m = content.match(opRe);
      if (m) {
        const r = spawnSync('op', ['read', m[1]], { encoding: 'utf8', timeout: 5000 });
        if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim();
      }
    } catch { /* skip */ }
  }
  return null;
}

function classifyProviderStatus(providerId, healthOk, env = process.env) {
  const entry = credentialMap().find(c => c.provider === providerId);
  const anySet = entry ? entry.envVars.some(name => Boolean(resolveCredential(name, env))) : false;
  if (!anySet) return 'not_configured';
  return healthOk ? 'healthy' : 'unhealthy';
}

function describeMissingCredentials(providerId, env = process.env) {
  const entry = credentialMap().find(c => c.provider === providerId);
  if (!entry) return null;
  const missing = entry.envVars.filter(name => !resolveCredential(name, env));
  if (missing.length === 0) return null;
  return `missing: ${missing.join(', ')}`;
}

const approvalQueue = new ApprovalQueue({ path: APPROVAL_QUEUE_FILE });
const sseClients = new Set();

// ── Terraform config ───────────────────────────────────────────────────────
const TERRAFORM_DIR = join(ROOT_DIR, 'deploy', 'terraform');
const TERRAFORM_ALLOWED_EXTS = new Set(['.tf', '.tfvars', '.json']);

function terraformFiles(dir, base) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...terraformFiles(full, base));
    } else {
      const ext = extname(entry);
      if (TERRAFORM_ALLOWED_EXTS.has(ext)) {
        results.push(relative(base, full));
      }
    }
  }
  return results.sort();
}

function assertTerraformPath(relPath) {
  const abs = normalize(join(TERRAFORM_DIR, relPath));
  if (!abs.startsWith(TERRAFORM_DIR + '/') && abs !== TERRAFORM_DIR) {
    throw new Error('Path traversal not allowed');
  }
  if (!TERRAFORM_ALLOWED_EXTS.has(extname(abs))) {
    throw new Error('Only .tf, .tfvars, and .json files are editable');
  }
  return abs;
}

// Webhook handler — created after approvalQueue so it can share the instance
let _webhookHandler = null;
function getWebhookHandler() {
  if (!_webhookHandler) {
    _webhookHandler = createWebhookHandler({ approvalQueue, notifyClients });
  }
  return _webhookHandler;
}

let _slackCommandHandler = null;
function getSlackCommandHandler() {
  if (!_slackCommandHandler) {
    _slackCommandHandler = createSlackCommandHandler();
  }
  return _slackCommandHandler;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.manifest': 'text/cache-manifest',
  '.map': 'application/json',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

function listCommands() {
  if (!existsSync(COMMANDS_DIR)) return [];
  const result = [];
  for (const domain of readdirSync(COMMANDS_DIR).sort()) {
    const domainPath = join(COMMANDS_DIR, domain);
    try {
      if (!statSync(domainPath).isDirectory()) continue;
      const commands = [];
      for (const file of readdirSync(domainPath).sort()) {
        if (!file.endsWith('.md')) continue;
        const content = readFileSync(join(domainPath, file), 'utf8');
        const match = content.match(/^---\r?\n[\s\S]*?description:\s*(.+?)\r?\n[\s\S]*?---/);
        const description = match ? match[1].trim() : file.replace('.md', '');
        commands.push({ name: file.replace('.md', ''), description, slash: `/${domain}:${file.replace('.md', '')}` });
      }
      if (commands.length) result.push({ domain, commands });
    } catch { continue; }
  }
  return result;
}

function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  const result = [];
  for (const cat of readdirSync(SKILLS_DIR)) {
    const catPath = join(SKILLS_DIR, cat);
    try {
      const stat = statSync(catPath);
      if (!stat.isDirectory()) continue;
      const files = readdirSync(catPath)
        .filter(f => f.endsWith('.md') || f.endsWith('.mjs'))
        .filter(f => f !== 'SKILL.md');
      result.push({ category: cat, files });
    } catch { continue; }
  }
  return result;
}

async function buildStatus() {
  const status = await buildSharedStatus({
    rootDir: ROOT_DIR,
    cwd: process.cwd(),
    homeDir: HOME,
    // The dashboard is long-lived and `construct up` rewrites managed values in
    // ~/.construct/config.env. Read fresh config on every request instead of
    // letting inherited process env shadow updated ports/credentials.
    env: {},
    dashboardPort: PORT,
    selfDashboard: true,
  });

  return {
    ...status,
    skills: listSkills(),
    commands: listCommands(),
  };
}

async function handleSessionUsage(_req, res) {
  try {
    const status = await buildSharedStatus({
      rootDir: ROOT_DIR,
      cwd: process.cwd(),
      homeDir: HOME,
      env: {},
    });

    const payload = {
      source: status.sessionUsage?.status === 'available' ? 'local-session-log' : 'unavailable',
      status: status.sessionUsage?.status ?? 'unavailable',
      sessionUsage: status.sessionUsage,
      guidance: status.sessionUsage?.status === 'available'
        ? 'Construct can answer token usage questions from locally recorded session usage.'
        : 'No local token usage has been recorded for this session yet.',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ── Artifacts handler ─────────────────────────────────────────────────────

async function handleArtifacts(req, res) {
  const url = new URL(req.url, `http://${BIND_HOST}:${PORT}`);

  if (req.method === 'GET') {
    const type = url.searchParams.get('type') || undefined;
    try {
      const artifacts = listArtifacts({ type, rootDir: ROOT_DIR });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artifacts }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const result = generateArtifact({
          type: data.type,
          title: data.title,
          rootDir: ROOT_DIR,
          fields: data.fields || {},
          dryRun: data.dryRun === true,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
        if (!data.dryRun) notifyClients();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
}

// ── Approval queue handler ────────────────────────────────────────────────

async function handleApprovals(req, res) {
  const url = new URL(req.url, `http://${BIND_HOST}:${PORT}`);

  if (req.method === 'GET') {
    const pending = approvalQueue.list('pending');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: pending }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const { action, id, note } = data;
        if (!id) throw new Error('Missing id');
        if (action === 'approve') {
          approvalQueue.approve(id);
        } else if (action === 'reject') {
          approvalQueue.reject(id, { reason: note || 'Rejected via dashboard' });
        } else {
          throw new Error('action must be approve or reject');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        notifyClients();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
}

// ── Config handler ────────────────────────────────────────────────────────

function handleConfig(req, res) {
  if (req.method === 'GET') {
    const env = existsSync(CONFIG_ENV_FILE) ? readFileSync(CONFIG_ENV_FILE, 'utf8') : '';
    const embed = existsSync(EMBED_YAML_FILE) ? readFileSync(EMBED_YAML_FILE, 'utf8') : '';
    // Extract roles from embed YAML (simple regex — works for flat keys)
    let roles = { primary: null, secondary: null };
    const primaryMatch = embed.match(/^\s*primary:\s*(.+)$/m);
    const secondaryMatch = embed.match(/^\s*secondary:\s*(.+)$/m);
    if (primaryMatch) roles.primary = primaryMatch[1].trim() || null;
    if (secondaryMatch) roles.secondary = secondaryMatch[1].trim() || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ env, embed, roles }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { type, content } = JSON.parse(body || '{}');
        if (type !== 'env' && type !== 'embed') throw new Error('type must be env or embed');
        if (typeof content !== 'string') throw new Error('content must be a string');
        mkdirSync(join(HOME, '.construct'), { recursive: true });
        const target = type === 'env' ? CONFIG_ENV_FILE : EMBED_YAML_FILE;
        writeFileSync(target, content, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
}

// ── Snapshots handler ─────────────────────────────────────────────────────

function handleSnapshots(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); res.end('Method Not Allowed'); return; }

  const snapshots = [];
  if (existsSync(SNAPSHOTS_FILE)) {
    const lines = readFileSync(SNAPSHOTS_FILE, 'utf8').split('\n').filter(Boolean);
    // Return last 20 snapshots most-recent-first
    for (const line of lines.slice(-20).reverse()) {
      try { snapshots.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ snapshots }));
}
const activeWatchers = [];
let watchRefreshTimer = null;

function notifyClients(event) {
  const payload = event ? `data: ${JSON.stringify(event)}\n\n` : 'data: refresh\n\n';
  for (const res of sseClients) {
    try { res.write(payload); }
    catch { sseClients.delete(res); }
  }
}

function closeWatchers() {
  while (activeWatchers.length) {
    try { activeWatchers.pop().close(); }
    catch { /* ignore close errors */ }
  }
}

function scheduleWatchRefresh() {
  clearTimeout(watchRefreshTimer);
  watchRefreshTimer = setTimeout(() => {
    watchFiles();
    notifyClients();
  }, 150);
}

function addWatcher(target) {
  if (!existsSync(target)) return;
  try {
    const watcher = watch(target, () => scheduleWatchRefresh());
    activeWatchers.push(watcher);
  } catch {
    /* ignore watch errors */
  }
}

function addDirectoryTreeWatch(root) {
  if (!existsSync(root)) return;
  addWatcher(root);
  try {
    for (const entry of readdirSync(root)) {
      const full = join(root, entry);
      try {
        if (statSync(full).isDirectory()) addWatcher(full);
      } catch {
        /* ignore stat errors */
      }
    }
  } catch {
    /* ignore read errors */
  }
}

function watchFiles() {
  closeWatchers();
  [REGISTRY_FILE, FEATURES_FILE, WORKFLOW_FILE].forEach(addWatcher);
  addDirectoryTreeWatch(SKILLS_DIR);
  addDirectoryTreeWatch(COMMANDS_DIR);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${BIND_HOST}:${PORT}`);

  // ── Security middleware ────────────────────────────────────────────────
  // Imported lazily so a missing module never breaks the server boot.
  let applyCors, ensureCsrfCookie, verifyCsrf, csrfDefaultSkip, checkRateLimit, logger;
  try {
    ({ applyCors } = await import('./cors.mjs'));
    ({ ensureCsrfCookie, verifyCsrf, defaultSkip: csrfDefaultSkip } = await import('./csrf.mjs'));
    ({ checkRateLimit } = await import('./rate-limit.mjs'));
    ({ logger } = await import('../logger.mjs'));
  } catch { /* run without the middleware if any module is unavailable */ }

  if (applyCors) {
    if (applyCors(req, res, { env: process.env })) return;
  }
  if (ensureCsrfCookie && req.method === 'GET') {
    ensureCsrfCookie(req, res);
  }
  const rateTier = url.pathname === '/api/chat/stream' || url.pathname === '/api/chat'
    ? 'chat'
    : (req.method !== 'GET' && req.method !== 'HEAD' ? 'write' : 'read');
  if (checkRateLimit) {
    const limit = checkRateLimit(req, rateTier, { env: process.env });
    if (!limit.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil(limit.retryAfterMs / 1000),
      });
      res.end(JSON.stringify({ error: 'rate_limited', retryAfterMs: limit.retryAfterMs }));
      logger?.().warn('http.rate_limited', { route: url.pathname, tier: rateTier });
      return;
    }
  }
  if (verifyCsrf && !verifyCsrf(req, { skip: csrfDefaultSkip })) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'csrf_token_missing_or_invalid' }));
    logger?.().warn('http.csrf_blocked', { route: url.pathname });
    return;
  }

  // ── Auth endpoints (always public) ──────────────────────────────────────
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const auth = getAuthConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      configured: auth.tokenConfigured,
      authenticated: isAuthenticated(req),
      auth,
    }));
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body || '{}');
        if (!validateToken(token)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid token' }));
          return;
        }
        const sessionToken = createSession();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookieHeader(sessionToken),
        });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader(),
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ── Webhook ingestion (public — signature-verified per provider) ─────────
  if (url.pathname.startsWith('/api/webhooks/') && req.method === 'POST') {
    await getWebhookHandler()(req, res);
    return;
  }

  // ── Slack slash commands (public — HMAC-verified) ────────────────────────
  if (url.pathname === '/api/slack/commands' && req.method === 'POST') {
    await getSlackCommandHandler()(req, res);
    return;
  }

  // ── Auth gate for all /api/* routes ─────────────────────────────────────
  if (url.pathname.startsWith('/api/') && !isAuthenticated(req)) {
    rejectUnauthorized(res);
    return;
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url.pathname === '/api/registry' && req.method === 'GET') {
    try {
      const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mcpServers: registry.mcpServers ?? {}, models: registry.models ?? {} }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/status') {
    try {
      const status = await buildStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/doctor') {
    try {
      const { readState } = await import('../doctor/index.mjs');
      const { recent } = await import('../doctor/audit.mjs');
      const { getTotalDailySpend, getDailySpend, totalBudget, personaBudget, dayKey } = await import('../cost-ledger.mjs');
      const { listOnboardedPersonas } = await import('../roles/manifest.mjs');
      const { listPending } = await import('../roles/gateway.mjs');
      const { existsSync: fsExists, readFileSync: fsRead } = await import('node:fs');
      const { join: pathJoin } = await import('node:path');
      const { homedir: osHome } = await import('node:os');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const watcher = url.searchParams.get('watcher') || undefined;
      const personas = listOnboardedPersonas();
      const costsByPersona = {};
      for (const p of personas) {
        const spend = getDailySpend({ personaId: p });
        if (spend.invocations > 0 || spend.costUsd > 0) {
          costsByPersona[p] = { spent: spend.costUsd, cap: personaBudget(p), invocations: spend.invocations };
        }
      }
      const total = getTotalDailySpend();
      const approvalPath = pathJoin(osHome(), '.cx', 'approval-pending.jsonl');
      let approvals = [];
      if (fsExists(approvalPath)) {
        approvals = fsRead(approvalPath, 'utf8').split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean)
          .slice(-25).reverse();
      }
      const pendingRoleInvocations = listPending({ unresolved: true }).slice(-25).reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        daemon: readState(),
        audit: recent({ watcher, limit }),
        cost: { dayKey: dayKey(), total: { spent: total.costUsd, cap: totalBudget(), invocations: total.invocations }, byPersona: costsByPersona },
        approvals,
        pendingRoleInvocations,
        onboardedPersonas: personas,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname.startsWith('/api/overrides/') && req.method === 'GET') {
    try {
      const { describeOverrides, resolveOverride, readResolved, listBackups, SUPPORTED_CATEGORIES } = await import('../overrides/resolver.mjs');
      const segs = url.pathname.replace(/^\/api\/overrides\//, '').split('/');
      const category = segs[0];
      if (!category || !SUPPORTED_CATEGORIES.includes(category)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `unknown category: ${category}. Use ${SUPPORTED_CATEGORIES.join(', ')}` }));
        return;
      }
      if (segs.length === 1) {
        const root = ROOT_DIR;
        const overrides = describeOverrides(root)[category] || [];
        const cwdOverrides = describeOverrides(process.cwd())[category] || [];
        let originals = [];
        try {
          const dir =
            category === 'contracts' || category === 'role-manifests'
              ? join(root, 'agents')
              : category === 'agents'
                ? join(root, 'agents', 'prompts')
                : join(root, category);
          if (existsSync(dir)) {
            const walk = (rel = '') => {
              const cur = join(dir, rel);
              for (const name of readdirSync(cur)) {
                const full = join(cur, name);
                const relPath = rel ? `${rel}/${name}` : name;
                if (statSync(full).isDirectory()) { walk(relPath); continue; }
                if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
                originals.push(relPath);
              }
            };
            walk();
          }
        } catch { /* best effort */ }
        const items = originals.map((name) => ({
          name,
          hasOverride: overrides.includes(name) || cwdOverrides.includes(name),
          source: overrides.includes(name) || cwdOverrides.includes(name) ? 'override' : 'original',
        }));
        for (const ov of [...overrides, ...cwdOverrides]) {
          if (!originals.includes(ov)) items.push({ name: ov, hasOverride: true, source: 'override', custom: true });
        }
        items.sort((a, b) => a.name.localeCompare(b.name));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ category, items }));
        return;
      }
      const name = segs.slice(1).join('/').replace(/\.[a-zA-Z0-9]+$/, '');
      const action = url.searchParams.get('action');
      if (action === 'backups') {
        const backups = listBackups(process.cwd(), category, name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ category, name, backups: backups.map((b) => ({ filename: b.filename, mtimeMs: b.mtimeMs, size: b.size })) }));
        return;
      }
      const tryRoot = (root) => {
        const r = resolveOverride(root, category, name);
        if (r.path) return { ...r, content: readFileSync(r.path, 'utf8') };
        return null;
      };
      const result = tryRoot(process.cwd()) || tryRoot(ROOT_DIR);
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found', category, name }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ category, name, source: result.source, content: result.content, path: result.path }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname.startsWith('/api/overrides/') && (req.method === 'PUT' || req.method === 'POST')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { applyEdit, restoreFromBackup, SUPPORTED_CATEGORIES } = await import('../overrides/resolver.mjs');
        const segs = url.pathname.replace(/^\/api\/overrides\//, '').split('/');
        const category = segs[0];
        if (!SUPPORTED_CATEGORIES.includes(category)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `unknown category: ${category}` }));
          return;
        }
        const name = segs.slice(1).join('/').replace(/\.[a-zA-Z0-9]+$/, '');
        const action = url.searchParams.get('action');
        const payload = JSON.parse(body || '{}');
        if (action === 'restore') {
          if (!payload.backupFilename) { res.writeHead(400); res.end(JSON.stringify({ error: 'backupFilename required' })); return; }
          const result = restoreFromBackup(process.cwd(), category, name, payload.backupFilename);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }
        if (typeof payload.content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'content (string) required' }));
          return;
        }
        const result = applyEdit(process.cwd(), category, name, payload.content);
        try {
          const auditDir = join(process.cwd(), '.cx');
          mkdirSync(auditDir, { recursive: true });
          appendFileSync(join(auditDir, 'audit.jsonl'), JSON.stringify({
            ts: new Date().toISOString(),
            action: `override.${category}.${name}.write`,
            backupPath: result.backupPath,
            bytes: result.wrote,
          }) + '\n');
        } catch { /* audit best-effort */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/project-config' && req.method === 'GET') {
    try {
      const { loadProjectConfig } = await import('../config/project-config.mjs');
      const result = loadProjectConfig(process.cwd(), process.env);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/project-config' && (req.method === 'PUT' || req.method === 'PATCH')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { writeProjectConfig, findProjectConfigPath, PROJECT_CONFIG_FILENAME } = await import('../config/project-config.mjs');
        const cfgPath = findProjectConfigPath(process.cwd()) || join(process.cwd(), PROJECT_CONFIG_FILENAME);
        writeProjectConfig(cfgPath, payload);
        try {
          const auditDir = join(process.cwd(), '.cx');
          mkdirSync(auditDir, { recursive: true });
          const entry = JSON.stringify({
            ts: new Date().toISOString(),
            action: 'project-config.write',
            path: cfgPath,
            keys: Object.keys(payload || {}),
          }) + '\n';
          writeFileSync(join(auditDir, 'audit.jsonl'), entry, { flag: 'a' });
        } catch { /* audit is best-effort */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: cfgPath }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/performance/reviews' && req.method === 'GET') {
    try {
      const dir = join(HOME, '.cx', 'performance-reviews');
      if (!existsSync(dir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reviews: [], total: 0, mockFiltered: 0, generatorImplemented: false }));
        return;
      }
      const allFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
      // Filter out test/mock fixtures — anything matching `test-*-mock.json` or
      // `*-mock.json` is a seeded fixture, not a real session-end review.
      // The real generator isn't wired yet; until it is, this endpoint should
      // return an honest empty list rather than parade fake data.
      const realFiles = allFiles.filter((f) => !/(^test-|-mock\.json$)/i.test(f));
      const files = realFiles
        .map((f) => {
          try {
            const full = join(dir, f);
            const stat = statSync(full);
            const body = JSON.parse(readFileSync(full, 'utf8'));
            return { filename: f, mtimeMs: stat.mtimeMs, ...body };
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reviews: files,
        total: files.length,
        mockFiltered: allFiles.length - realFiles.length,
        generatorImplemented: true,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/performance/feedback' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.agent || !payload.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent + text required' }));
          return;
        }
        const dir = join(process.cwd(), '.cx', 'feedback');
        mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString();
        const filename = `${ts.replace(/[:.]/g, '-')}-${payload.agent}.json`;
        writeFileSync(join(dir, filename), JSON.stringify({
          ts,
          agent: payload.agent,
          text: payload.text,
          proposedChanges: payload.proposedChanges || null,
        }, null, 2));
        appendFileSync(join(process.cwd(), '.cx', 'audit.jsonl'), JSON.stringify({
          ts,
          action: 'performance.feedback.submitted',
          agent: payload.agent,
          filename,
        }) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, filename }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/audit' && req.method === 'GET') {
    try {
      const auditPath = join(process.cwd(), '.cx', 'audit.jsonl');
      if (!existsSync(auditPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ entries: [], total: 0 }));
        return;
      }
      const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
      const raw = readFileSync(auditPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const entries = [];
      for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
        try { entries.push(JSON.parse(lines[i])); } catch { /* skip malformed */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries: entries.reverse(), total: lines.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/insights' && req.method === 'GET') {
    try {
      const { buildInsights } = await import('./insights.mjs');
      const data = await buildInsights({ env: process.env, cwd: process.cwd(), rootDir: ROOT_DIR });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/alias' && req.method === 'GET') {
    try {
      const { resolveAlias } = await import('../config/alias.mjs');
      const r = resolveAlias({ cwd: process.cwd(), env: process.env });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, value: 'Construct', source: 'default' }));
    }
    return;
  }

  if (url.pathname === '/api/mode' && req.method === 'GET') {
    try {
      const env = loadConstructEnv();
      const embedYamlPath = join(HOME, '.construct', 'embed.yaml');
      const embedStatus = resolveEmbedStatus(env);
      
      // Determine mode based on embed status and configuration
      let mode = 'init';
      if (embedStatus.level === 'running') {
        mode = 'embed';
      } else if (existsSync(embedYamlPath)) {
        mode = 'live';
      }
      
      // Get instance ID if set
      const instanceId = env.CONSTRUCT_INSTANCE_ID || null;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        mode,
        instanceId,
        embedStatus: embedStatus.level,
        embedYamlExists: existsSync(embedYamlPath),
        embedYamlPath
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/embed/boundary' && req.method === 'GET') {
    try {
      const env = loadConstructEnv();
      const instanceId = env.CONSTRUCT_INSTANCE_ID || 'default';
      const parentConstruct = env.CONSTRUCT_PARENT_INSTANCE || null;
      const parentUrl = env.CONSTRUCT_PARENT_URL || null;
      const isEmbedded = !!parentConstruct;
      const boundaryStatus = isEmbedded ? 'embedded' : 'standalone';
      const embedStatus = resolveEmbedStatus(env);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        boundaryStatus,
        instanceId,
        parentConstruct,
        parentUrl,
        isEmbedded,
        embedStatus: embedStatus.level,
        embedConfigExists: existsSync(join(HOME, '.construct', 'embed.yaml')),
        capabilities: {
          modeDetection: true,
          snapshotStatus: true,
          approvalQueue: true,
          configManagement: true
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/embed/boundary/register' && req.method === 'POST') {
    try {
      const chunks = [];
      await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      
      const { parentInstance, parentUrl, childInstanceId } = body;
      
      if (!parentInstance || !parentUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'parentInstance and parentUrl are required' }));
        return;
      }
      
      // In a real implementation, this would:
      // - Validate the parent is a legitimate Construct instance
      // - Store the parent registration in a boundary configuration
      // - Set up communication channels between parent and child
      // - Configure isolation boundaries
      
      // For now, just acknowledge the registration
      const configDir = join(HOME, '.construct');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      
      const boundaryConfig = {
        parentInstance,
        parentUrl,
        childInstanceId: childInstanceId || env.CONSTRUCT_INSTANCE_ID || 'default',
        registeredAt: new Date().toISOString(),
        boundaryVersion: '1.0'
      };
      
      const boundaryConfigPath = join(configDir, 'boundary-config.json');
      writeFileSync(boundaryConfigPath, JSON.stringify(boundaryConfig, null, 2));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        message: 'Boundary registration accepted',
        boundaryConfig,
        boundaryConfigPath
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/embed/status' && req.method === 'GET') {
    try {
      const env = loadConstructEnv();
      const status = resolveEmbedStatus(env);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/models/providers' && req.method === 'GET') {
    try {
      const { getProviderModelCatalog } = await import('../model-router.mjs');
      const catalog = getProviderModelCatalog({ env: process.env });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(catalog));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/models/pricing' && req.method === 'GET') {
    try {
      const idsParam = url.searchParams.get('ids') || '';
      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
      const { getPricingForModels } = await import('../model-pricing.mjs');
      const pricing = await getPricingForModels(ids);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pricing }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/providers/credentials/custom' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ providers: readCustomCredentials(), path: CUSTOM_CREDENTIALS_FILE }));
    return;
  }

  if (url.pathname === '/api/providers/billing' && req.method === 'GET') {
    try {
      const { loadProjectConfig } = await import('../config/project-config.mjs');
      const cfg = loadProjectConfig(process.cwd(), process.env);
      const costsCfg = cfg?.config?.costs ?? {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        global: costsCfg.billingMode ?? 'metered',
        providers: costsCfg.providers || {},
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/providers/credentials/op-status' && req.method === 'GET') {
    // Tells the dashboard whether the 1Password CLI is installed and an account
    // is signed in. No vault content is read here; this is just the availability
    // probe. The pull endpoint below is the only thing that touches secret data.
    try {
      const which = spawnSync('which', ['op'], { encoding: 'utf8' });
      if (which.status !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: false, signedIn: false, version: null, accounts: [] }));
        return;
      }
      const versionProc = spawnSync('op', ['--version'], { encoding: 'utf8', timeout: 2000 });
      const version = versionProc.status === 0 ? versionProc.stdout.trim() : null;
      const accountsProc = spawnSync('op', ['account', 'list', '--format=json'], { encoding: 'utf8', timeout: 3000 });
      let accounts = [];
      if (accountsProc.status === 0) {
        try {
          const parsed = JSON.parse(accountsProc.stdout || '[]');
          accounts = (Array.isArray(parsed) ? parsed : []).map((a) => ({
            url: a.url || null,
            email: a.email || null,
            user_uuid: a.user_uuid || null,
          }));
        } catch { accounts = []; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: true, signedIn: accounts.length > 0, version, accounts }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/fs/browse' && req.method === 'GET') {
    try {
      const { readdirSync, statSync } = await import('node:fs');
      const { resolve: pathResolve, dirname: pathDirname, join: pathJoin, sep: pathSep } = await import('node:path');
      const os = await import('node:os');
      const HOME_DIR = os.homedir();
      // Only roots the dashboard is allowed to expose. Loopback + same-user
      // already gates file access at the OS level, but cap the reach to the
      // user's HOME and the active project root anyway — surprise reads
      // outside those are almost certainly a typo.
      const allowedRoots = [HOME_DIR, ROOT_DIR];
      const rawPath = url.searchParams.get('path') || HOME_DIR;
      const target = pathResolve(rawPath.startsWith('~') ? pathJoin(HOME_DIR, rawPath.slice(1)) : rawPath);
      const inAllowed = allowedRoots.some((root) => target === root || target.startsWith(root + pathSep));
      if (!inAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `path outside allowed roots (${allowedRoots.join(', ')})` }));
        return;
      }
      let entries = [];
      try {
        entries = readdirSync(target, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
          }))
          .sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'dir' ? -1 : 1;
          });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      const parent = pathDirname(target);
      const parentAllowed = allowedRoots.some((root) => parent === root || parent.startsWith(root + pathSep));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        path: target,
        parent: parentAllowed && parent !== target ? parent : null,
        roots: allowedRoots,
        entries,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/intake/config' && req.method === 'GET') {
    try {
      const { loadIntakeConfig, INTAKE_DEPTH_GUIDANCE, INTAKE_HARD_MAX_DEPTH } = await import('../intake/intake-config.mjs');
      const config = loadIntakeConfig(ROOT_DIR, process.env);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        config,
        rootDir: ROOT_DIR,
        guidance: INTAKE_DEPTH_GUIDANCE,
        hardMaxDepth: INTAKE_HARD_MAX_DEPTH,
        defaults: { projectInbox: '.cx/inbox', docsIntake: 'docs/intake' },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/intake/list' && req.method === 'GET') {
    try {
      const { createIntakeQueue } = await import('../intake/queue.mjs');
      const queue = createIntakeQueue(ROOT_DIR, process.env);
      const items = queue.listPending();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items, total: items.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') {
    try {
      const probe = url.searchParams.get('probe') === '1';
      const { resolveProviders } = await import('../providers/registry.mjs');
      const { providers, sources, errors } = await resolveProviders({ rootDir: ROOT_DIR, env: process.env });
      const summary = await Promise.all(
        Object.entries(providers).map(async ([id, p]) => {
          const base = {
            id,
            displayName: p.meta.displayName,
            description: p.meta.description || null,
            capabilities: [...p.meta.capabilities],
            source: sources[id],
            configSchema: p.configSchema || null,
          };
          if (!probe) {
            return { ...base, health: null, status: 'unknown' };
          }
          let health = { ok: false, detail: 'health probe failed' };
          try { health = await p.health({}); } catch (err) { health = { ok: false, detail: err.message }; }
          const status = classifyProviderStatus(id, health.ok, process.env);
          // For not_configured, surface what's missing instead of the probe detail
          // (which may incorrectly read as healthy from an anonymous code path).
          const missing = status === 'not_configured' ? describeMissingCredentials(id, process.env) : null;
          const finalHealth = missing ? { ...health, ok: false, detail: missing } : health;
          return { ...base, health: finalHealth, status };
        })
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary, errors }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/beads' && req.method === 'GET') {
    try {
      // Resolve to the main repo when running from a worktree — the bd
      // database lives next to the canonical .git/, not the worktree's
      // private .git/ stub. git rev-parse --git-common-dir returns the
      // shared .git for both main and worktrees; its parent is the
      // main repo root.
      let bdCwd = ROOT_DIR;
      try {
        const commonDir = spawnSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: ROOT_DIR,
          encoding: 'utf8',
        });
        if (commonDir.status === 0) {
          const trimmed = commonDir.stdout.trim();
          const resolved = trimmed.startsWith('/') ? trimmed : join(ROOT_DIR, trimmed);
          const candidate = dirname(resolved);
          if (existsSync(join(candidate, '.beads'))) bdCwd = candidate;
        }
      } catch { /* fall back to ROOT_DIR */ }
      const result = spawnSync('bd', ['list', '--status', 'all', '--json'], {
        cwd: bdCwd,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 5000,
      });
      if (result.status !== 0) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `bd list failed: ${(result.stderr || result.stdout || '').slice(0, 300)}` }));
        return;
      }
      let raw = [];
      try { raw = JSON.parse(result.stdout); } catch (parseErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `bd list JSON parse failed: ${parseErr.message}` }));
        return;
      }
      const issues = raw.map(obj => ({
        id: obj.id,
        title: obj.title,
        description: obj.description || null,
        status: obj.status,
        priority: obj.priority,
        issue_type: obj.issue_type || null,
        owner: obj.owner || null,
        created_at: obj.created_at,
        updated_at: obj.updated_at,
        dependency_count: obj.dependency_count || 0,
        dependent_count: obj.dependent_count || 0,
        comment_count: obj.comment_count || 0,
        labels: Array.isArray(obj.labels) ? obj.labels : [],
      }));
      const byStatus = {};
      const byPriority = {};
      for (const it of issues) {
        byStatus[it.status] = (byStatus[it.status] || 0) + 1;
        byPriority[`P${it.priority}`] = (byPriority[`P${it.priority}`] || 0) + 1;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issues, counts: { total: issues.length, byStatus, byPriority } }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/providers/subscriptions' && req.method === 'GET') {
    try {
      const file = join(HOME, '.construct', 'provider-subscriptions.json');
      let data = { subscriptions: [] };
      if (existsSync(file)) {
        try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* fall back to empty */ }
        if (!Array.isArray(data.subscriptions)) data.subscriptions = [];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/providers/credentials' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ credentials: buildCredentialsView(process.env) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/providers/config-path' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      envPath: CONFIG_ENV_FILE,
      overridesPath: join(HOME, '.construct', 'providers.json'),
    }));
    return;
  }

  if (url.pathname === '/api/session-usage') {
    await handleSessionUsage(req, res);
    return;
  }

  if (url.pathname === '/api/artifacts') {
    await handleArtifacts(req, res);
    return;
  }

  if (url.pathname === '/api/approvals') {
    await handleApprovals(req, res);
    return;
  }

  // ── Recommendations API ────────────────────────────────────────────────────
  if (url.pathname === '/api/recommendations') {
    if (req.method === 'GET') {
      const { listActiveRecommendations, recommendationStats } = await import('../embed/recommendation-store.mjs');
      const priority = url.searchParams.get('priority') || undefined;
      const type = url.searchParams.get('type') || undefined;
      const limit = Number(url.searchParams.get('limit') || 50);
      const items = listActiveRecommendations({ priority, type, limit });
      const stats = recommendationStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items, stats }));
      return;
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      const chunks = [];
      await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
      const action = body.action || url.searchParams.get('action');
      const dedupKey = body.dedupKey || url.searchParams.get('dedupKey');
      if (!action || !dedupKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'action and dedupKey are required' }));
        return;
      }
      const { dismissRecommendation, reviveRecommendation } = await import('../embed/recommendation-store.mjs');
      try {
        if (action === 'dismiss') {
          const result = dismissRecommendation(dedupKey, { reason: body.reason, suppressDays: body.suppressDays });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } else if (action === 'revive') {
          const result = reviveRecommendation(dedupKey, { signalCount: body.signalCount, sourceSignalIds: body.sourceSignalIds });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `unknown action: ${action}` }));
        }
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'not found' }));
      }
      return;
    }
  }

  // ── Strategy API ───────────────────────────────────────────────────────────
  if (url.pathname === '/api/strategy') {
    if (req.method === 'GET') {
      const { readAllStrategies } = await import('../strategy-store.mjs');
      const result = await readAllStrategies(process.env);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ scopes: Object.fromEntries(result) }));
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const chunks = [];
      await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
      const content = (body.content || '').trim();
      const scope = (body.scope || 'product').trim();
      if (!content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'content is required' }));
        return;
      }
      const { writeStrategy } = await import('../strategy-store.mjs');
      await writeStrategy(content, scope, { updatedBy: 'dashboard', env: process.env });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  if (url.pathname === '/api/snapshots') {
    handleSnapshots(req, res);
    return;
  }

  // ── Knowledge API ──────────────────────────────────────────────────────
  if (url.pathname === '/api/knowledge/trends') {
    const { buildTrendReport } = await import('../knowledge/trends.mjs');
    const report = buildTrendReport(ROOT_DIR);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
    return;
  }

  if (url.pathname === '/api/knowledge/index') {
    const { buildCorpus } = await import('../knowledge/rag.mjs');
    const corpus = buildCorpus(ROOT_DIR);
    const sources = {};
    for (const c of corpus) sources[c.source] = (sources[c.source] || 0) + 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: corpus.length, sources }));
    return;
  }

  if (url.pathname === '/api/knowledge/ask' && req.method === 'POST') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', (c) => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
    const question = (body.question || '').trim();
    if (!question) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'question is required' }));
      return;
    }
    const { ask } = await import('../knowledge/rag.mjs');
    const result = await ask(question, { rootDir: ROOT_DIR });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // ── Workflow API ──────────────────────────────────────────────────────────
  if (url.pathname === '/api/workflow' && req.method === 'GET') {
    try {
      const planMd = existsSync(WORKFLOW_FILE) ? readFileSync(WORKFLOW_FILE, 'utf8') : '';
      const { loadWorkflow } = await import('../workflow-state.mjs');
      const wf = loadWorkflow(ROOT_DIR);
      const tasks = wf?.tasks ?? [];
      const phase = wf?.phase ?? null;
      const phases = wf?.phases ?? {};
      const status = wf?.status ?? null;
      const summary = planMd
        ? planMd.split('\n').slice(0, 30).filter(l => l.trim()).slice(0, 8).join('\n')
        : '';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        hasPlan: Boolean(planMd),
        planSummary: summary,
        planPath: WORKFLOW_FILE,
        workflowState: wf ? { status, phase, phases, tasks, currentTaskKey: wf.currentTaskKey } : null,
        taskCount: tasks.length,
        taskStatusCounts: {
          todo: tasks.filter(t => t.status === 'todo' || !t.status).length,
          inProgress: tasks.filter(t => t.status === 'in-progress').length,
          blocked: tasks.filter(t => t.status?.startsWith('blocked')).length,
          done: tasks.filter(t => t.status === 'done').length,
          skipped: tasks.filter(t => t.status === 'skipped').length,
        },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/config') {
    handleConfig(req, res);
    return;
  }

  // ── Terraform API ─────────────────────────────────────────────────────────
  if (url.pathname === '/api/terraform/files' && req.method === 'GET') {
    try {
      const files = terraformFiles(TERRAFORM_DIR, TERRAFORM_DIR);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, terraformDir: TERRAFORM_DIR }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/terraform/file') {
    if (req.method === 'GET') {
      const relPath = url.searchParams.get('path');
      if (!relPath) { res.writeHead(400); res.end(JSON.stringify({ error: 'path required' })); return; }
      try {
        const abs = assertTerraformPath(relPath);
        const content = readFileSync(abs, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: relPath, content }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST') {
      const chunks = [];
      await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
      try {
        const abs = assertTerraformPath(body.path || '');
        writeFileSync(abs, body.content ?? '', 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  if (url.pathname === '/api/terraform/run' && req.method === 'POST') {
    const chunks = [];
    await new Promise((resolve, reject) => { req.on('data', c => chunks.push(c)); req.on('end', resolve); req.on('error', reject); });
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }

    const subcommand = body.subcommand; // 'plan' | 'apply'
    const environment = body.environment || 'staging'; // 'staging' | 'production'

    if (!['plan', 'apply', 'validate', 'output'].includes(subcommand)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "subcommand must be 'plan', 'apply', 'validate', or 'output'" }));
      return;
    }

    const envDir = join(TERRAFORM_DIR, 'environments', environment);
    if (!existsSync(envDir)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Environment '${environment}' not found at ${envDir}` }));
      return;
    }

    // Stream output via SSE-style chunked response
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });

    const args = subcommand === 'plan'
      ? ['plan', `-chdir=${envDir}`, '-no-color']
      : subcommand === 'apply'
        ? ['apply', `-chdir=${envDir}`, '-no-color', '-auto-approve']
        : subcommand === 'validate'
          ? ['validate', `-chdir=${envDir}`, '-no-color']
          : ['output', `-chdir=${envDir}`, '-no-color'];

    res.write(`\u001b[90m$ terraform ${args.join(' ')}\u001b[0m\n\n`);

    const tf = spawn('terraform', args, {
      cwd: envDir,
      env: { ...process.env, TF_IN_AUTOMATION: '1' },
    });

    tf.stdout.on('data', chunk => { try { res.write(chunk); } catch {} });
    tf.stderr.on('data', chunk => { try { res.write(chunk); } catch {} });

    tf.on('close', (code) => {
      try {
        res.write(`\n\u001b[${code === 0 ? '32' : '31'}m\nExit code: ${code}\u001b[0m\n`);
        res.end();
      } catch {}
      notifyClients();
    });

    tf.on('error', (err) => {
      try { res.write(`\n❌ Failed to run terraform: ${err.message}\n`); res.end(); } catch {}
    });

    return;
  }

  if (url.pathname === '/api/chat/stream' && req.method === 'GET') {
    handleChatStream(req, res, { rootDir: ROOT_DIR });
    return;
  }

  if (url.pathname === '/api/chat/history' && req.method === 'GET') {
    handleChatHistory(req, res);
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    handleChat(req, res, { rootDir: ROOT_DIR });
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { promoteHeadhunt, updatePromotionChallenge } = await import('../headhunt.mjs');

        if (url.pathname === '/api/headhunt/promote') {
          if (!data.id) throw new Error('Missing overlay id');
          const request = promoteHeadhunt(data.id, { cwd: process.cwd(), owner: data.owner || null });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, request }));
          notifyClients();
        } else if (url.pathname === '/api/headhunt/challenge') {
          if (!data.id) throw new Error('Missing overlay id');
          if (!data.status) throw new Error('Missing challenge status');
          const request = updatePromotionChallenge(data.id, {
            cwd: process.cwd(),
            status: data.status,
            note: data.note || null,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, request }));
          notifyClients();
        } else if (url.pathname === '/api/registry/mcp') {
          const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
          if (!registry.mcpServers) registry.mcpServers = {};
          const { action, id, server } = data;
          if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid MCP server id');
          if (action === 'delete') {
            delete registry.mcpServers[id];
          } else if (action === 'save' && server && typeof server === 'object') {
            const entry = {};
            if (server.type === 'url') {
              if (!server.url) throw new Error('URL required for type=url');
              entry.type = 'url';
              entry.url = String(server.url);
              if (server.headers && typeof server.headers === 'object') entry.headers = server.headers;
            } else {
              if (!server.command) throw new Error('command required');
              entry.command = String(server.command);
              entry.args = Array.isArray(server.args) ? server.args.map(String) : [];
            }
            if (server.description) entry.description = String(server.description);
            registry.mcpServers[id] = entry;
          } else {
            throw new Error('action must be save or delete');
          }
          writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          notifyClients();
        } else if (url.pathname === '/api/registry/models') {
          const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
          const { tier, primary, fallback } = data;
          const VALID_TIERS = ['reasoning', 'standard', 'fast'];
          if (!VALID_TIERS.includes(tier)) throw new Error('tier must be reasoning, standard, or fast');
          if (!primary || typeof primary !== 'string') throw new Error('primary model required');
          if (!registry.models) registry.models = {};
          registry.models[tier] = {
            primary: String(primary),
            fallback: Array.isArray(fallback) ? fallback.map(String).filter(Boolean) : [],
          };
          writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          notifyClients();
        } else if (url.pathname === '/api/providers/billing') {
          // Persists per-provider billing mode into construct.config.json under
          // costs.providers.<id>.billingMode. Validates ids against the known
          // CREDENTIAL_MAP (built-in + custom) so we don't accept arbitrary
          // strings into the schema.
          const { provider, billingMode } = data;
          if (typeof provider !== 'string' || !provider) throw new Error('provider id required');
          const validProviders = new Set([
            ...credentialMap().map((c) => c.provider),
            'ollama', 'local', 'mistral', 'groq',
          ]);
          if (!validProviders.has(provider)) {
            throw new Error(`unknown provider '${provider}'. Add a custom provider first or use one of: ${[...validProviders].join(', ')}`);
          }
          if (!['metered', 'subscription', 'mixed'].includes(billingMode)) {
            throw new Error("billingMode must be 'metered', 'subscription', or 'mixed'");
          }
          const { loadProjectConfig, writeProjectConfig, findProjectConfigPath, PROJECT_CONFIG_FILENAME } = await import('../config/project-config.mjs');
          const cfgPath = findProjectConfigPath(process.cwd()) || join(process.cwd(), PROJECT_CONFIG_FILENAME);
          const { config } = loadProjectConfig(process.cwd(), process.env);
          const next = {
            ...config,
            costs: {
              ...(config.costs || {}),
              providers: {
                ...(config.costs?.providers || {}),
                [provider]: { billingMode },
              },
            },
          };
          writeProjectConfig(cfgPath, next);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, providers: next.costs.providers }));
          notifyClients();
        } else if (url.pathname === '/api/providers/credentials/op-pull') {
          // Resolve a 1Password secret reference (op://vault/item/field) and
          // store the result into ~/.construct/config.env via the same write
          // path as the manual editor. The op:// URI never leaves the machine
          // and the resolved value flows secret server-side → config.env
          // (chmod 0600) → process.env, identical to a manual paste.
          const isLocal = BIND_HOST === '127.0.0.1' || BIND_HOST === 'localhost' || BIND_HOST === '::1';
          if (isAuthConfigured()) {
            if (!isAuthenticated(req)) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Unauthorized' }));
              return;
            }
          } else if (!isLocal) {
            throw new Error('op-pull on non-localhost binds requires CONSTRUCT_DASHBOARD_TOKEN to be set');
          }
          const { envVar, opRef } = data;
          if (typeof envVar !== 'string' || !envVar) throw new Error('envVar required');
          if (!allowedCredentialEnvVars().has(envVar)) throw new Error(`envVar '${envVar}' is not in the credential allowlist`);
          if (typeof opRef !== 'string' || !opRef.startsWith('op://')) {
            throw new Error("opRef must be a 1Password secret reference starting with 'op://'");
          }
          if (!/^op:\/\/[\w\s\-._]+\/[\w\s\-._]+\/[\w\s\-._]+$/.test(opRef)) {
            throw new Error("opRef must look like 'op://vault/item/field' (letters, digits, spaces, _-.)");
          }
          const opRead = spawnSync('op', ['read', '--no-newline', opRef], { encoding: 'utf8', timeout: 10000 });
          if (opRead.status !== 0) {
            throw new Error(`op read failed: ${(opRead.stderr || opRead.stdout || '').trim().slice(0, 240)}`);
          }
          const resolved = opRead.stdout;
          if (!resolved) throw new Error('op read returned an empty value');

          const { writeEnvValues, loadConstructEnv } = await import('../env-config.mjs');
          mkdirSync(join(HOME, '.construct'), { recursive: true });
          writeEnvValues(CONFIG_ENV_FILE, { [envVar]: resolved });
          process.env[envVar] = resolved;
          try { chmodSync(CONFIG_ENV_FILE, 0o600); } catch { /* perms best-effort */ }

          const allowed = allowedCredentialEnvVars();
          const merged = loadConstructEnv({ rootDir: ROOT_DIR, warn: false });
          for (const [k, v] of Object.entries(merged)) {
            if (allowed.has(k) && k !== envVar) process.env[k] = v;
          }

          try {
            mkdirSync(join(HOME, '.cx'), { recursive: true });
            appendFileSync(CREDENTIAL_AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), action: 'set', envVar, source: '1password', opRef }) + '\n');
          } catch { /* audit best-effort */ }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, envVar }));
          notifyClients();
        } else if (url.pathname === '/api/providers/credentials/custom') {
          const { action, provider, label, kind, envVars } = data;
          const cleanedId = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
          if (!cleanedId || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(cleanedId)) {
            throw new Error('provider id required: lowercase letters, digits, hyphens (max 63 chars)');
          }
          if (BUILTIN_CREDENTIAL_MAP.some((b) => b.provider === cleanedId)) {
            throw new Error(`provider id '${cleanedId}' is built-in; pick a different id`);
          }
          const existing = readCustomCredentials();
          if (action === 'delete') {
            const next = existing.filter((e) => e.provider !== cleanedId);
            writeCustomCredentials(next);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, providers: next }));
            notifyClients();
          } else if (action === 'save') {
            if (typeof label !== 'string' || !label.trim()) throw new Error('label required');
            if (kind !== 'llm' && kind !== 'integration') throw new Error("kind must be 'llm' or 'integration'");
            if (!Array.isArray(envVars) || envVars.length === 0) throw new Error('envVars must be a non-empty array');
            const normalizedVars = envVars.map((v) => String(v || '').trim().toUpperCase());
            for (const v of normalizedVars) {
              if (!ENV_VAR_PATTERN.test(v)) throw new Error(`envVar '${v}' must match /^[A-Z][A-Z0-9_]{1,63}$/`);
              if (ENV_VAR_BLOCKLIST.has(v)) throw new Error(`envVar '${v}' is reserved by the OS shell and not allowed`);
              if (allowedCredentialEnvVars().has(v)) {
                // Only block when the existing owner is a different provider.
                const owner = credentialMap().find((c) => c.envVars.includes(v));
                if (owner && owner.provider !== cleanedId) {
                  throw new Error(`envVar '${v}' already declared by provider '${owner.provider}'`);
                }
              }
            }
            const next = existing.filter((e) => e.provider !== cleanedId).concat([{
              provider: cleanedId,
              label: label.trim(),
              kind,
              envVars: normalizedVars,
            }]);
            writeCustomCredentials(next);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, providers: next }));
            notifyClients();
          } else {
            throw new Error("action must be 'save' or 'delete'");
          }
        } else if (url.pathname === '/api/intake/config') {
          const { saveIntakeConfig } = await import('../intake/intake-config.mjs');
          const next = saveIntakeConfig(ROOT_DIR, {
            parentDirs: Array.isArray(data.parentDirs) ? data.parentDirs : undefined,
            maxDepth: data.maxDepth,
            includeProjectInbox: data.includeProjectInbox,
            includeDocsIntake: data.includeDocsIntake,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, config: next }));
          notifyClients();
        } else if (url.pathname === '/api/models/free/apply') {
          const { pollFreeModels, selectForTier } = await import('../model-free-selector.mjs');
          const { readOpenRouterApiKeyFromOpenCodeConfig } = await import('../model-router.mjs');
          const apiKey = process.env.OPENROUTER_API_KEY || readOpenRouterApiKeyFromOpenCodeConfig();
          if (!apiKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured. Set it under Providers → Credentials.' }));
          } else {
            const freeModels = await pollFreeModels(apiKey);
            if (!freeModels || freeModels.length === 0) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'OpenRouter returned no free models. Check the key and try again.' }));
            } else {
              const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
              if (!registry.models) registry.models = {};
              const selections = {};
              for (const tier of ['reasoning', 'standard', 'fast']) {
                const fallback = registry.models?.[tier]?.fallback ?? [];
                const id = selectForTier(freeModels, tier, fallback);
                if (id) {
                  selections[tier] = id;
                  registry.models[tier] = { primary: id, fallback };
                }
              }
              writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, selections, polledCount: freeModels.length }));
              notifyClients();
            }
          }
        } else if (url.pathname === '/api/providers/registry') {
          const { BUILT_INS } = await import('../providers/registry.mjs');
          const overridesPath = join(HOME, '.construct', 'providers.json');
          const { action, id, package: pkg, options } = data;
          if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid provider id');
          if (BUILT_INS.includes(id)) throw new Error(`cannot override built-in provider '${id}'`);

          let current = { providers: [] };
          if (existsSync(overridesPath)) {
            try { current = JSON.parse(readFileSync(overridesPath, 'utf8')); } catch { current = { providers: [] }; }
            if (!Array.isArray(current.providers)) current.providers = [];
          }

          if (action === 'delete') {
            current.providers = current.providers.filter(p => p?.id !== id);
          } else if (action === 'save') {
            if (!pkg || typeof pkg !== 'string') throw new Error('package required');
            const { validateProviderEntry } = await import('../providers/registry.mjs');
            const verdict = await Promise.race([
              validateProviderEntry({ id, package: pkg, options: options || {} }, { rootDir: ROOT_DIR, env: process.env }),
              new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'provider load timeout (5s)' }), 5000)),
            ]);
            if (!verdict.ok) throw new Error(`provider '${id}' failed to load: ${verdict.error}`);
            current.providers = current.providers.filter(p => p?.id !== id).concat([{ id, package: pkg, options: options || {} }]);
          } else {
            throw new Error('action must be save or delete');
          }

          mkdirSync(join(HOME, '.construct'), { recursive: true });
          const tmp = overridesPath + '.tmp';
          writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n');
          renameSync(tmp, overridesPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          notifyClients();
        } else if (url.pathname === '/api/providers/credentials') {
          // 127.0.0.1 already requires same-user file access to write config.env,
          // so no extra security comes from forcing a token on localhost. On any
          // non-loopback bind, require the dashboard token to gate writes.
          const isLocal = BIND_HOST === '127.0.0.1' || BIND_HOST === 'localhost' || BIND_HOST === '::1';
          if (isAuthConfigured()) {
            if (!isAuthenticated(req)) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Unauthorized' }));
              return;
            }
          } else if (!isLocal) {
            throw new Error('credential management on non-localhost binds requires CONSTRUCT_DASHBOARD_TOKEN to be set');
          }
          const { envVar, value } = data;
          if (typeof envVar !== 'string' || !envVar) throw new Error('envVar required');
          const allowed = allowedCredentialEnvVars();
          if (!allowed.has(envVar)) throw new Error(`envVar '${envVar}' is not in the credential allowlist`);
          if (value !== '' && typeof value !== 'string') throw new Error('value must be a string');

          const { writeEnvValues, parseEnvFile, loadConstructEnv } = await import('../env-config.mjs');
          mkdirSync(join(HOME, '.construct'), { recursive: true });
          const action = value === '' ? 'unset' : 'set';

          if (action === 'unset') {
            // writeEnvValues drops empty values, so passing '' deletes the key.
            writeEnvValues(CONFIG_ENV_FILE, { ...parseEnvFile(CONFIG_ENV_FILE), [envVar]: '' });
            delete process.env[envVar];
          } else {
            writeEnvValues(CONFIG_ENV_FILE, { [envVar]: value });
            process.env[envVar] = value;
          }
          try { chmodSync(CONFIG_ENV_FILE, 0o600); } catch { /* perms set best-effort */ }

          // Re-overlay so any non-targeted keys edited out-of-band also refresh.
          const merged = loadConstructEnv({ rootDir: ROOT_DIR, warn: false });
          for (const [k, v] of Object.entries(merged)) {
            if (allowed.has(k) && k !== envVar) process.env[k] = v;
          }

          try {
            mkdirSync(join(HOME, '.cx'), { recursive: true });
            appendFileSync(CREDENTIAL_AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), action, envVar }) + '\n');
          } catch { /* audit append best-effort */ }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          notifyClients();
        } else if (url.pathname === '/api/providers/subscriptions') {
          const subsPath = join(HOME, '.construct', 'provider-subscriptions.json');
          const { action, id, provider, name, config } = data;
          if (!id || typeof id !== 'string' || !/^[\w.-]+$/.test(id)) throw new Error('Invalid subscription id');

          let current = { subscriptions: [] };
          if (existsSync(subsPath)) {
            try { current = JSON.parse(readFileSync(subsPath, 'utf8')); } catch { current = { subscriptions: [] }; }
            if (!Array.isArray(current.subscriptions)) current.subscriptions = [];
          }

          if (action === 'delete') {
            current.subscriptions = current.subscriptions.filter(s => s?.id !== id);
          } else if (action === 'save') {
            if (!provider || typeof provider !== 'string') throw new Error('provider required');
            if (config && typeof config !== 'object') throw new Error('config must be an object');
            const entry = { id, provider, name: name || id, config: config || {} };
            current.subscriptions = current.subscriptions.filter(s => s?.id !== id).concat([entry]);
          } else {
            throw new Error('action must be save or delete');
          }

          mkdirSync(join(HOME, '.construct'), { recursive: true });
          const tmp = subsPath + '.tmp';
          writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n');
          renameSync(tmp, subsPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          notifyClients();
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = join(STATIC_DIR, filePath);

  if (!fullPath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(fullPath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(fullPath);
  const mime = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(fullPath));
});

watchFiles();

// ── Embed scheduler ──────────────────────────────────────────────────────────
// When CX_AUTO_EMBED=1, run `construct sync` at startup and on a fixed interval
// to keep the knowledge base current without manual intervention.
// Override interval via CX_EMBED_INTERVAL_MS (default: 30 minutes).
function runEmbedSync() {
  const syncScript = join(ROOT_DIR, 'scripts', 'sync-agents.mjs');
  if (!existsSync(syncScript)) return;
  try {
    spawnSync(process.execPath, [syncScript], {
      cwd: ROOT_DIR,
      stdio: 'ignore',
      timeout: 120_000,
      env: { ...process.env },
    });
  } catch {
    // non-fatal — next interval will retry
  }
}

// Load user env config into process.env so dashboard API endpoints that read
// from process.env (telemetry credentials, model provider keys, etc.) find them
// even when the server is started directly (not through bin/construct).
try {
  const { loadConstructEnv, getUserEnvPath } = await import('../env-config.mjs');
  const homeDir = HOME || homedir();
  const envPath = getUserEnvPath(homeDir);
  if (existsSync(envPath)) {
    const ENV = loadConstructEnv({ rootDir: ROOT_DIR, homeDir, env: process.env });
    for (const [key, value] of Object.entries(ENV)) {
      if (!(key in process.env)) process.env[key] = value;
    }
  }
} catch { /* non-fatal — env loading is best-effort */ }

if (process.env.CX_AUTO_EMBED === '1') {
  const intervalMs = parseInt(process.env.CX_EMBED_INTERVAL_MS ?? '', 10) || 30 * 60 * 1000;
  runEmbedSync();
  setInterval(runEmbedSync, intervalMs).unref();
  console.log(`Embed scheduler active — syncing every ${intervalMs / 60_000} min`);
}
server.listen(PORT, BIND_HOST, () => {
  console.log(`Construct dashboard running at http://${BIND_HOST}:${PORT}`);
});

// SIGTERM/SIGINT close the server cleanly so the process exits 0 instead of
// 143 — keeps shell tooling and supervisors from flagging normal shutdowns
// as failures.

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down dashboard...`);
  closeWatchers();
  for (const client of sseClients) {
    try { client.end(); } catch { /* ignore */ }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Subscribe to embed notification bus → SSE toast events ──────────────────
onEmbedNotification((event) => {
  notifyClients({ type: 'toast', ...event });
});
