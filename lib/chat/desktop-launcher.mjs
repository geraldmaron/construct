/**
 * lib/chat/desktop-launcher.mjs — start dashboard and open Construct chat in the native window.
 *
 * Launch order when the construct-chat binary is missing: build it from the Tauri
 * source on disk (dev/branch path), else download the prebuilt release asset, else
 * fail loudly with remediation. Chrome app-mode is never an implicit substitute —
 * the native window is the contract, and `construct chat --web` is the explicit
 * browser path.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import { startDashboard, readDashboardState } from '../service-manager.mjs';
import { hasGuiDisplay, resolveDesktopBinary } from './desktop-binary.mjs';
import { buildDesktopBinary, hasDesktopSource } from './desktop-build.mjs';

async function ensureDashboard({ cwd, env, errorOutput }) {
  let dash = readDashboardState();
  if (dash?.port) return dash;

  const result = await startDashboard({
    rootDir: cwd,
    preferredPort: parseInt(env.PORT || env.DASHBOARD_PORT || '4242', 10),
  });
  if (result.started || result.reused) {
    return { port: result.port, url: result.url || `http://127.0.0.1:${result.port}` };
  }
  errorOutput.write(`Failed to start dashboard: ${result.reason || 'unknown error'}\n`);
  return null;
}

function waitForChild(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 0);
    };

    if (child) {
      child.on('exit', (code) => finish(code));
      child.on('error', () => finish(1));
    }

    const onSignal = () => {
      try { child?.kill('SIGTERM'); } catch { /* already exited */ }
      finish(0);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    if (!child) finish(0);
  });
}

function spawnDesktopBinary(bin, chatUrl, env) {
  if (/\.(mjs|cjs|js)$/i.test(bin)) {
    return spawn(process.execPath, [bin, '--url', chatUrl], {
      env: { ...env, CONSTRUCT_CHAT_URL: chatUrl },
      stdio: 'ignore',
      detached: false,
    });
  }
  return spawn(bin, ['--url', chatUrl], {
    env: { ...env, CONSTRUCT_CHAT_URL: chatUrl },
    stdio: 'ignore',
    detached: false,
  });
}

async function tryDownloadBinary(env) {
  try {
    const { downloadDesktopBinary } = await import('../install/desktop-binary-download.mjs');
    const result = await downloadDesktopBinary({ homeDir: os.homedir(), env });
    if (result.status === 'downloaded') return resolveDesktopBinary();
  } catch {
    /* fall through to loud failure below */
  }
  return null;
}

function resolveBinaryToLaunch({ cwd, env, output, errorOutput }) {
  const existing = resolveDesktopBinary({ repoRoot: cwd, env });
  if (existing) return existing;

  if (hasDesktopSource(cwd)) {
    const built = buildDesktopBinary({ repoRoot: cwd, env, output, errorOutput });
    if (built.ok) return built.binaryPath;
    errorOutput.write(`Could not build the Construct Chat window: ${built.reason}\n`);
    return null;
  }

  return null;
}

export async function runDesktopChat({
  cwd = process.cwd(),
  env = process.env,
  output = process.stdout,
  errorOutput = process.stderr,
  binaryPath = null,
  dashOverride = null,
} = {}) {
  if (!hasGuiDisplay(env)) {
    errorOutput.write('No graphical display available. Use `construct chat --plain` for terminal mode.\n');
    return 1;
  }

  let bin = binaryPath || resolveBinaryToLaunch({ cwd, env, output, errorOutput });

  if (!bin && !hasDesktopSource(cwd)) {
    bin = await tryDownloadBinary(env);
  }

  if (!bin) {
    errorOutput.write(
      'The Construct Chat native window is unavailable.\n'
      + 'Build it with: npm run build:chat-desktop (requires the Rust toolchain from https://rustup.rs)\n'
      + 'Or open chat in a browser tab with: construct chat --web\n',
    );
    return 1;
  }

  const dash = dashOverride || await ensureDashboard({ cwd, env, errorOutput });
  if (!dash) return 1;

  const base = (dash.url || `http://127.0.0.1:${dash.port}`).replace(/\/$/, '');
  const chatUrl = `${base}/chat/?surface=desktop`;

  const child = spawnDesktopBinary(bin, chatUrl, env);
  return waitForChild(child);
}
