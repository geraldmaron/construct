/**
 * lib/install/desktop-binary-download.mjs — downloads the Construct chat desktop binary.
 *
 * Fetches the platform-matching construct-chat binary from the latest GitHub
 * release and writes it to ~/.construct/bin/. Called by `construct install --scope=user`.
 * Network failures are non-fatal: returns { status: 'skipped', reason } so the
 * rest of setup can proceed without the desktop binary.
 */

import fs from 'node:fs';
import path from 'node:path';

const GITHUB_REPO = 'geraldmaron/construct';

function assetName() {
  const plat = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (plat === 'win32') return 'construct-chat-windows-x64.exe';
  if (plat === 'darwin') return `construct-chat-darwin-${arch}`;
  return `construct-chat-linux-${arch}`;
}

function destBinaryName() {
  return process.platform === 'win32' ? 'construct-chat.exe' : 'construct-chat';
}

async function fetchRelease(env) {
  const headers = { 'User-Agent': 'construct-installer/1.0' };
  if (env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text().then((t) => t.slice(0, 120))}`);
  return res.json();
}

async function downloadAsset(url, dest, env) {
  const headers = {
    'User-Agent': 'construct-installer/1.0',
    'Accept': 'application/octet-stream',
  };
  if (env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
}

// Returns { status: 'downloaded'|'skipped'|'failed' }; 'skipped' and 'failed' are both non-fatal.
export async function downloadDesktopBinary({ homeDir, env = process.env } = {}) {
  const binDir = path.join(homeDir, '.construct', 'bin');
  const dest = path.join(binDir, destBinaryName());
  const name = assetName();

  let release;
  try {
    release = await fetchRelease(env);
  } catch (err) {
    return { status: 'skipped', reason: `GitHub API unreachable: ${err.message}` };
  }

  const asset = release.assets?.find((a) => a.name === name);
  if (!asset) {
    return {
      status: 'skipped',
      reason: `No desktop binary in ${release.tag_name} for this platform (looked for ${name})`,
    };
  }

  fs.mkdirSync(binDir, { recursive: true });

  try {
    await downloadAsset(asset.browser_download_url, dest, env);
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* best effort */
    }
  }

  return { status: 'downloaded', dest, version: release.tag_name };
}
