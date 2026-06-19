/**
 * lib/chat/web-launcher.mjs — start dashboard server and open /chat for construct chat --web.
 *
 * Reuses lib/service-manager.mjs startDashboard so the browser surface shares auth,
 * CSRF, and static hosting with the operations dashboard.
 */

import { spawn } from 'node:child_process';
import { startDashboard, readDashboardState } from '../service-manager.mjs';

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* browser open is best-effort */
  }
}

export async function runWebChat({
  cwd = process.cwd(),
  env = process.env,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  let dash = readDashboardState();
  if (!dash?.port) {
    const result = await startDashboard({ rootDir: cwd, preferredPort: parseInt(env.PORT || env.DASHBOARD_PORT || '4242', 10) });
    if (result.started || result.reused) {
      dash = { port: result.port, url: result.url || `http://127.0.0.1:${result.port}` };
    } else {
      errorOutput.write(`Failed to start dashboard: ${result.reason || 'unknown error'}\n`);
      return 1;
    }
  }

  const base = dash.url || `http://127.0.0.1:${dash.port}`;
  const chatUrl = `${base.replace(/\/$/, '')}/chat/`;
  output.write(`Construct web chat: ${chatUrl}\n`);
  output.write('Press Ctrl-C to stop the dashboard server.\n');
  openBrowser(chatUrl);

  await new Promise((resolve) => {
    process.on('SIGINT', resolve);
    process.on('SIGTERM', resolve);
  });
  return 0;
}
