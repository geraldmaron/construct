/**
 * lib/chat/desktop-launcher.mjs — start dashboard and open Construct chat in a desktop window.
 *
 * Prefers the Tauri construct-chat binary; falls back to Chromium --app mode (chromeless
 * window) when the binary is not built. Reuses startDashboard for auth, CSRF, and hosting.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startDashboard, readDashboardState } from '../service-manager.mjs';
import { resolveAppWindowBrowser, spawnAppWindow } from './app-window.mjs';
import {
  desktopBinaryInstallHint,
  hasGuiDisplay,
  resolveDesktopBinary,
} from './desktop-binary.mjs';

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

function waitForChild(child, { signalHandlers = true } = {}) {
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

    if (signalHandlers) {
      const onSignal = () => {
        try { child?.kill('SIGTERM'); } catch { /* already exited */ }
        finish(0);
      };
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    }

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

  const dash = dashOverride || await ensureDashboard({ cwd, env, errorOutput });
  if (!dash) return 1;

  const base = (dash.url || `http://127.0.0.1:${dash.port}`).replace(/\/$/, '');
  const chatUrl = `${base}/chat/?surface=desktop`;

  const tauriBin = binaryPath || resolveDesktopBinary();
  if (tauriBin) {
    output.write(`Construct chat window: ${chatUrl}\n`);
    const child = spawnDesktopBinary(tauriBin, chatUrl, env);
    return waitForChild(child);
  }

  const appBrowser = resolveAppWindowBrowser();
  if (appBrowser) {
    output.write(`Construct chat window: ${chatUrl}\n`);
    output.write(`(Tauri binary not built — using app window via ${appBrowser.split('/').pop()})\n`);
    output.write('Build the native shell with: npm run build:chat-desktop\n');
    output.write('Press Ctrl-C to stop the dashboard server.\n');
    let child;
    try {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-chat-'));
      child = spawnAppWindow(appBrowser, chatUrl, { env, userDataDir: tempDir });
      child.on('exit', () => {
        try { fs.rmSync(tempDir, { recursive: true }); } catch { /* ignore cleanup errors */ }
      });
    } catch (err) {
      errorOutput.write(`Failed to open app window: ${err.message}\n`);
      return 1;
    }
    return waitForChild(child);
  }

  errorOutput.write(`${desktopBinaryInstallHint()}\n`);
  errorOutput.write('No Chromium-based browser found for app-window fallback. Use `construct chat --web`.\n');
  return 1;
}
