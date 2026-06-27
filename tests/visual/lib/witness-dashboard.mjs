/**
 * tests/visual/lib/witness-dashboard.mjs — live browser dashboard for visual test runs.
 *
 * Serves a structured transcript with stage blocks, clickable editor links, and
 * evidence paths. Opened automatically when visual-live-runner runs with --watch.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripAnsi } from './depth-rubric.mjs';

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const REPO_ROOT = path.resolve(ASSETS_DIR, '..', '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function pickPort(preferred = 9333) {
  return preferred;
}

function serveAsset(res, fileName) {
  const filePath = path.join(ASSETS_DIR, fileName);
  if (!filePath.startsWith(ASSETS_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(fileName);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
}

export function createWitnessDashboard({
  port = pickPort(),
  host = '127.0.0.1',
  repoRoot = REPO_ROOT,
} = {}) {
  const clients = new Set();
  const history = [];

  const broadcast = (payload) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    history.push(payload);
    for (const res of clients) {
      try { res.write(line); } catch { clients.delete(res); }
    }
  };

  const server = http.createServer((req, res) => {
    const url = req.url?.split('?')[0] || '/';
    if (url === '/' || url === '/index.html') {
      serveAsset(res, 'witness-dashboard.html');
      return;
    }
    if (url === '/styles.css') {
      serveAsset(res, 'witness-styles.css');
      return;
    }
    if (url === '/client.js') {
      serveAsset(res, 'witness-client.js');
      return;
    }
    if (url === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      for (const item of history) {
        res.write(`data: ${JSON.stringify(item)}\n\n`);
      }
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  const dashboardUrl = `http://${host}:${port}`;

  const start = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(dashboardUrl);
    });
  });

  const stop = () => new Promise((resolve) => {
    for (const res of clients) {
      try { res.end(); } catch { /* ignore */ }
    }
    clients.clear();
    server.close(() => resolve());
  });

  const init = (extra = {}) => {
    broadcast({
      type: 'init',
      repoRoot,
      dashboardUrl,
      ...extra,
    });
  };

  const witness = {
    paceMs: 700,
    onAction(kind, detail) {
      broadcast({ type: 'action', kind, detail });
    },
    onOutput(_stream, chunk) {
      broadcast({ type: 'output', text: stripAnsi(chunk) });
    },
    onEvent(event) {
      if (event.type === 'text') {
        broadcast({ type: 'log', kind: 'stream', message: `+${(event.text || '').length} chars` });
      }
      if (event.type === 'tool_call') {
        broadcast({ type: 'log', kind: 'tool', message: event.title || event.id });
      }
    },
    stage(name) {
      broadcast({ type: 'stage', name });
    },
    stageResult(name, ok) {
      broadcast({ type: 'stage-result', name, ok });
    },
    depth(role, grade, detail) {
      broadcast({ type: 'depth', role, grade, detail });
    },
    summary(body) {
      broadcast({ type: 'summary', ok: !!body.ok, body });
    },
    log(kind, message) {
      broadcast({ type: 'log', kind, message });
    },
  };

  return { server, url: dashboardUrl, start, stop, witness, broadcast, init };
}

export async function openWitnessInBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return true;
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    return true;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  return true;
}

export function createDashboardWitness(opts = {}) {
  return createWitnessDashboard(opts);
}
