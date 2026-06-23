/**
 * lib/server/demo-preview.mjs — gated static serve for Playwright demo artifacts.
 *
 * When CONSTRUCT_DEMO_ARTIFACT_DIR is set, GET /demo-preview/<filename> serves
 * PDF/HTML (and sibling export assets) from that directory with path traversal
 * guards. Inactive when the env var is unset.
 */

import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_EXT = new Set(['.pdf', '.html', '.png', '.svg', '.webm', '.mp4', '.css', '.js']);

const MIME = {
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export function demoPreviewRootFromEnv(env = process.env) {
  const raw = env.CONSTRUCT_DEMO_ARTIFACT_DIR;
  if (!raw || !String(raw).trim()) return null;
  return path.resolve(String(raw));
}

export function resolveDemoPreviewPath(pathname, env = process.env) {
  const root = demoPreviewRootFromEnv(env);
  if (!root) return { ok: false, status: 404, message: 'Not found' };

  const prefix = '/demo-preview/';
  if (!pathname.startsWith(prefix)) return { ok: false, status: 404, message: 'Not found' };

  const name = decodeURIComponent(pathname.slice(prefix.length));
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }

  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }

  const fullPath = path.resolve(path.join(root, name));
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!fullPath.startsWith(rootWithSep) && fullPath !== root) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return { ok: false, status: 404, message: 'Not found' };
  }

  return { ok: true, filePath: fullPath, ext };
}

export function demoPreviewMime(ext) {
  return MIME[ext] ?? 'application/octet-stream';
}
