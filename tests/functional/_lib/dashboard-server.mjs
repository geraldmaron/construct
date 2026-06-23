/**
 * Spawn `lib/server/index.mjs` at a random port for one test suite and
 * return a fetch wrapper + base URL. Auto-stops on test exit.
 *
 * The server binds module-load-time so we run it as a child process rather
 * than import it as a library. Auth is the existing cookie-based flow; the
 * harness exposes helpers to log in + reuse the session.
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withNextBuildLock } from './next-build-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SERVER_PATH = join(REPO_ROOT, 'lib', 'server', 'index.mjs');
const STATIC_INDEX = join(REPO_ROOT, 'lib', 'server', 'static', 'index.html');
const READY_TIMEOUT_MS = 20_000;

// The dashboard static export is a build artifact (gitignored, not tracked)
// shipped via the npm package; a fresh dev checkout has no static tree until
// `construct dashboard:sync --build` runs. Dashboard tests require the static
// tree present, so the harness builds on first use and caches the promise
// across concurrent suites sharing the dashboard server.
//
// The cross-process lock serializes against the dashboard-build suite, which
// runs `next build` against the same distDir in a sibling node:test worker.
// After acquiring it, re-check the static tree: a concurrent builder may have
// produced it during the wait, making a rebuild redundant.

let dashboardBuildPromise = null;

function ensureDashboardBuilt() {
  if (existsSync(STATIC_INDEX)) return Promise.resolve(true);
  if (dashboardBuildPromise) return dashboardBuildPromise;
  dashboardBuildPromise = withNextBuildLock(REPO_ROOT, () => {
    if (existsSync(STATIC_INDEX)) return true;
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'bin', 'construct'), 'dashboard:sync', '--build'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 240_000, stdio: 'pipe' },
    );
    return result.status === 0 && existsSync(STATIC_INDEX);
  }).catch(() => false);
  return dashboardBuildPromise;
}

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
  const built = await ensureDashboardBuilt();
  if (!built) {
    if (t && t.skip) t.skip('Dashboard static build is unavailable — run `construct dashboard:sync --build`.');
    return null;
  }
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
