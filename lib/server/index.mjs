/**
 * lib/server/index.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, statSync, watch, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { buildStatus as buildSharedStatus } from '../status.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const HOME = homedir();
const PORT = parseInt(process.env.PORT ?? '4242', 10);

const STATIC_DIR = join(__dirname, 'static');
const REGISTRY_FILE = join(ROOT_DIR, 'agents', 'registry.json');
const FEATURES_FILE = join(HOME, '.construct', 'features.json');
const WORKFLOW_FILE = join(process.cwd(), '.cx', 'workflow.json');
const SKILLS_DIR = join(ROOT_DIR, 'skills');
const COMMANDS_DIR = join(ROOT_DIR, 'commands');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
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

const sseClients = new Set();
const activeWatchers = [];
let watchRefreshTimer = null;

function notifyClients() {
  for (const res of sseClients) {
    try { res.write('data: refresh\n\n'); }
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
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

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

  if (url.pathname === '/api/session-usage') {
    await handleSessionUsage(req, res);
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { approveWorkflow, approveTask } = await import('../workflow-state.mjs');
        const { promoteHeadhunt, updatePromotionChallenge } = await import('../headhunt.mjs');

        if (url.pathname === '/api/workflow/approve') {
          const workflow = approveWorkflow(process.cwd(), data.note);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, workflow }));
          notifyClients();
        } else if (url.pathname === '/api/workflow/approve-task') {
          if (!data.key) throw new Error('Missing task key');
          const workflow = approveTask(process.cwd(), data.key, data.note);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, workflow }));
          notifyClients();
        } else if (url.pathname === '/api/headhunt/promote') {
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Construct dashboard running at http://127.0.0.1:${PORT}`);
});
