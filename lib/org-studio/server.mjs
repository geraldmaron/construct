/**
 * lib/org-studio/server.mjs — the Construct Org Studio: a zero-dependency local web surface for
 * authoring specialists, teams, contracts, fences, and participation rules without editing JSON
 * (construct-d1r7.14; participation canvas construct-pteo2.15).
 *
 * ADR-0001 keeps npm out of core, so this is a plain node:http server plus a self-contained SPA
 * (app.html, all CSS/JS inline) — no framework, no build step, works air-gapped. Every write goes
 * through lib/registry/org-api.mjs, the single org-config writer (ADR-0072): the API here is a thin
 * JSON envelope over that module's create/update/remove/validate/import/export/preview functions, so
 * inline validation in the UI is byte-for-byte the same schema the CLI enforces. The server binds to
 * loopback only — it is a personal authoring tool, not a shared service — and refuses cross-origin
 * requests so a page in another tab cannot drive local org writes.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listEntities, getEntity, validateDraft, createEntity, updateEntity, removeEntity,
  exportOrg, importOrg, previewRoute, previewEffectiveFence,
  listParticipationRules, validateParticipationRule, upsertParticipationRule,
  removeParticipationRule, previewParticipation, participationEditorMeta,
} from '../registry/org-api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_HTML = path.join(HERE, 'app.html');
const KINDS = ['specialist', 'team', 'contract', 'fence', 'skill'];
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// A browser page on another origin must not be able to drive local org writes; a same-origin fetch
// omits Origin or sends one whose host matches the request Host. Non-browser clients (tests, curl)
// send no Origin and are allowed — the loopback bind is the real perimeter.

function crossOriginBlocked(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

function aggregateOrg(rootDir) {
  const out = {};
  for (const kind of KINDS) {
    const { items, count } = listEntities(kind, { rootDir });
    out[kind] = { items, count };
  }
  return out;
}

// Routes are matched against the decoded path segments so an id containing a slash or reserved
// character round-trips; every write path forwards straight to org-api and returns its result
// verbatim, letting the UI render org-api's { ok, errors } shape without a translation layer.

async function route(req, res, { rootDir }) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const scope = url.searchParams.get('scope') || 'project';
  const method = req.method;

  if (method === 'GET' && parts.length === 0) {
    const html = fs.readFileSync(APP_HTML, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(html);
    return;
  }

  if (parts[0] !== 'api') return json(res, 404, { error: 'not found' });

  if (method !== 'GET' && crossOriginBlocked(req)) return json(res, 403, { error: 'cross-origin request refused' });

  const seg = parts.slice(1);

  if (method === 'GET' && seg[0] === 'org') return json(res, 200, { scope, org: aggregateOrg(rootDir) });

  if (seg[0] === 'entities') {
    const kind = seg[1];
    if (!KINDS.includes(kind)) return json(res, 400, { error: `unknown kind: ${kind}` });
    if (method === 'GET' && seg.length === 2) return json(res, 200, listEntities(kind, { rootDir }));
    if (method === 'GET' && seg.length === 3) {
      const entity = getEntity(kind, seg[2], { rootDir });
      return entity ? json(res, 200, entity) : json(res, 404, { error: `${kind} not found: ${seg[2]}` });
    }
    if (method === 'POST' && seg.length === 2) return json(res, 200, createEntity(kind, await readBody(req), { rootDir, scope }));
    if (method === 'PUT' && seg.length === 3) return json(res, 200, updateEntity(kind, seg[2], await readBody(req), { rootDir, scope }));
    if (method === 'DELETE' && seg.length === 3) return json(res, 200, removeEntity(kind, seg[2], { rootDir, scope }));
  }

  // Participation rules (construct-pteo2.15) forward to org-api's dedicated
  // functions rather than /api/entities — a rule is a sub-object of its owning
  // specialist/team entry, not a standalone entity kind.

  if (seg[0] === 'participation') {
    if (method === 'GET' && seg[1] === 'meta') return json(res, 200, participationEditorMeta({ rootDir }));
    if (method === 'GET' && seg.length === 1) return json(res, 200, listParticipationRules({ rootDir }));
    if (method === 'POST' && seg.length === 2) return json(res, 200, upsertParticipationRule(seg[1], await readBody(req), { rootDir, scope }));
    if (method === 'DELETE' && seg.length === 3) return json(res, 200, removeParticipationRule(seg[1], seg[2], { rootDir, scope }));
  }
  if (method === 'POST' && seg[0] === 'validate' && seg[1] === 'participation') {
    const body = await readBody(req);
    return json(res, 200, validateParticipationRule(body.ownerId, body.rule, { rootDir }));
  }
  if (method === 'POST' && seg[0] === 'preview' && seg[1] === 'participation') {
    return json(res, 200, previewParticipation({ rootDir, ...(await readBody(req)) }));
  }

  if (method === 'POST' && seg[0] === 'validate' && KINDS.includes(seg[1])) {
    return json(res, 200, validateDraft(seg[1], await readBody(req), { rootDir }));
  }
  if (method === 'GET' && seg[0] === 'export') return json(res, 200, exportOrg({ rootDir, scope }));
  if (method === 'POST' && seg[0] === 'import') {
    return json(res, 200, importOrg(await readBody(req), { rootDir, scope, dryRun: url.searchParams.get('dryRun') === 'true' }));
  }
  if (method === 'POST' && seg[0] === 'preview' && seg[1] === 'route') return json(res, 200, previewRoute({ rootDir, ...(await readBody(req)) }));
  if (method === 'POST' && seg[0] === 'preview' && seg[1] === 'fence') return json(res, 200, previewEffectiveFence({ rootDir, ...(await readBody(req)) }));

  return json(res, 404, { error: 'not found' });
}

export function createOrgStudioServer({ rootDir = process.cwd() } = {}) {
  return http.createServer((req, res) => {
    route(req, res, { rootDir }).catch((err) => {
      const status = /too large|invalid JSON/.test(err.message) ? 400 : 500;
      json(res, status, { error: err.message });
    });
  });
}

export function startOrgStudio({ rootDir = process.cwd(), port = 4321, host = '127.0.0.1' } = {}) {
  const server = createOrgStudioServer({ rootDir });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address();
      resolve({ server, url: `http://${host}:${actual.port}`, port: actual.port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
