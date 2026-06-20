/**
 * lib/chat/app-window.mjs — open Construct chat in a dedicated browser app window.
 *
 * Uses Chromium --app mode when the Tauri construct-chat binary is not built yet.
 * Produces a chromeless window (no tabs/address bar) loading the local /chat/ URL.
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';

const MACOS_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Arc.app/Contents/MacOS/Arc',
];

const LINUX_BROWSERS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'brave-browser',
];

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveChromiumAppBinary() {
  if (process.env.CONSTRUCT_CHAT_APP_BROWSER) {
    return process.env.CONSTRUCT_CHAT_APP_BROWSER;
  }
  if (process.platform === 'darwin') {
    for (const candidate of MACOS_BROWSERS) {
      if (isExecutable(candidate)) return candidate;
    }
    return null;
  }
  if (process.platform === 'linux') {
    for (const name of LINUX_BROWSERS) {
      const paths = [`/usr/bin/${name}`, `/snap/bin/${name}`];
      for (const candidate of paths) {
        if (isExecutable(candidate)) return candidate;
      }
    }
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const candidates = [
      pathJoin(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      pathJoin(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      pathJoin(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const candidate of candidates) {
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function pathJoin(...parts) {
  return parts.filter(Boolean).join(process.platform === 'win32' ? '\\' : '/');
}

export function resolveAppWindowBrowser() {
  return resolveChromiumAppBinary();
}

export function spawnAppWindow(browserPath, url, { env = process.env } = {}) {
  const args = [`--app=${url}`, '--new-window'];
  return spawn(browserPath, args, {
    env,
    stdio: 'ignore',
    detached: true,
  });
}
