/**
 * Spawn `lib/server/index.mjs` at a random port for one test suite and
 * return a fetch wrapper + base URL. Auto-stops on test exit.
 *
 * The server binds module-load-time so we run it as a child process rather
 * than import it as a library. Auth is the existing cookie-based flow; the
 * harness exposes helpers to log in + reuse the session.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SERVER_PATH = join(REPO_ROOT, 'lib', 'server', 'index.mjs');
const READY_TIMEOUT_MS = 20_000;

function pickPort() {
  return 40_000 + Math.floor(Math.random() * 10_000);
}

async function waitForReady(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/auth/status`);
      if (r.status === 200 || r.status === 401) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Spawn the server. Returns { url, fetch, close, child, home } or null when
 * the server fails to come up. `seedHome(home)` runs before the spawn so
 * tests can drop config files (~/.construct/config.env, etc.) into the
 * isolated HOME the server will read.
 */
export async function withDashboardServer(t, { extraEnv = {}, seedHome } = {}) {
  const port = pickPort();
  const home = mkdtempSync(join(tmpdir(), 'cx-dash-server-'));
  if (typeof seedHome === 'function') seedHome(home);
  const cookies = new Map();

  const env = {
    ...process.env,
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    HOME: home,
    NODE_ENV: 'test',
    CONSTRUCT_SKIP_POSTINSTALL: '1',
    ...extraEnv,
  };

  const child = spawn(process.execPath, [SERVER_PATH], {
    env,
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  if (t && t.after) {
    t.after(() => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    });
  }

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const url = `http://127.0.0.1:${port}`;
  const ready = await waitForReady(url);
  if (!ready) {
    try { child.kill('SIGTERM'); } catch { /* */ }
    if (t && t.skip) t.skip(`Dashboard server did not bind in time. Stderr:\n${stderr.substring(0, 400)}`);
    return null;
  }

  function captureCookies(res) {
    const set = res.headers.get('set-cookie');
    if (set) {
      for (const piece of set.split(/,(?=[^,;]+=)/)) {
        const [pair] = piece.split(';', 1);
        const [name, value] = pair.split('=', 2);
        if (name && value != null) cookies.set(name.trim(), value);
      }
    }
  }

  function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function fetchWrapped(path, init = {}) {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) headers.set('cookie', cookieHeader());
    const csrf = cookies.get('cx_csrf');
    if (csrf && init.method && init.method !== 'GET') {
      headers.set('x-construct-csrf', csrf);
    }
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const res = await fetch(`${url}${path}`, { ...init, headers });
    captureCookies(res);
    return res;
  }

  return {
    url,
    fetch: fetchWrapped,
    home,
    child,
    close: () => { try { child.kill('SIGTERM'); } catch { /* */ } },
  };
}
