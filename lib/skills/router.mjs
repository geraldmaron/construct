/**
 * lib/skills/router.mjs — keyword + entitlement skill suggestion for agents.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '../registry/loader.mjs';
import { loadArtifactManifest } from '../artifact-manifest.mjs';
import { resolveActiveScope } from '../scopes/loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Keyed by rootDir + the route file's own mtime: a first-root-wins cache with
// no invalidation would silently keep serving one project's routes to every
// other project/test in the same long-lived process, and would never notice
// a regenerated skills/routing.json (scripts/generate-skill-routing.mjs).

const _routesCache = new Map();

function loadRoutes(rootDir = ROOT) {
  const p = path.join(rootDir, 'skills', 'routing.json');
  const mtimeMs = fs.statSync(p).mtimeMs;
  const cacheKey = `${rootDir}::${mtimeMs}`;
  const cached = _routesCache.get(rootDir);
  if (cached && cached.key === cacheKey) return cached.routes;
  const routes = JSON.parse(fs.readFileSync(p, 'utf8')).routes || [];
  _routesCache.set(rootDir, { key: cacheKey, routes });
  return routes;
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// A keyword phrase's part matches a token either exactly, or — for a part
// >=5 chars — as a prefix of the token (so "secret" also matches "secrets").
// One direction only: a keyword's own word-stem can match its inflected
// forms, but a short fragment can never match anywhere inside an unrelated
// longer word — a bidirectional substring check ("rag" matching "storage",
// "average", "drag" because each merely contains the substring "rag") is
// exactly the false-positive class this replaces.

function partMatches(part, tokens) {
  return tokens.some((t) => t === part || (part.length >= 5 && t.startsWith(part)));
}

function keywordScore(kw, tokens) {
  const parts = kw.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  if (!parts.every((p) => partMatches(p, tokens))) {
    return parts.some((p) => partMatches(p, tokens)) ? 3 : 0;
  }
  // Adjacency bonus: the phrase's parts also appear as consecutive tokens in
  // the intent, not merely present anywhere in it.
  const adjacent = parts.length === 1 || tokens.some((_, i) => parts.every((p, j) => {
    const t = tokens[i + j];
    return t !== undefined && (t === p || (p.length >= 5 && t.startsWith(p)));
  }));
  return adjacent ? 10 : 7;
}

function scoreRoute(route, tokens) {
  let score = route.priority || 1;
  for (const kw of route.keywords || []) score += keywordScore(kw, tokens);
  return score;
}

export function suggestSkills({ intent = '', specialistId = null, limit = 5, rootDir = ROOT, cwd = null } = {}) {
  const routes = loadRoutes(rootDir);
  const tokens = tokenize(intent);
  const scored = routes
    .map((route) => ({ ...route, score: scoreRoute(route, tokens) }))
    .filter((r) => r.score > (r.priority || 1))
    .sort((a, b) => b.score - a.score);

  let entitled = null;
  if (specialistId) {
    const registry = loadRegistry({ rootDir });
    const id = specialistId.startsWith('cx-') ? specialistId : `cx-${specialistId}`;
    entitled = new Set(registry.specialists?.[id]?.skills || []);
  }

  const profile = cwd ? resolveActiveScope(cwd) : null;
  const baseline = new Set(profile?.defaultSkills || []);

  const manifest = loadArtifactManifest({ rootDir });
  for (const entry of Object.values(manifest.artifacts || {})) {
    if (entry.workflowSkill && (tokens.includes('prd') || tokens.includes('adr'))) {
      scored.push({ path: entry.workflowSkill, domain: 'workflow', score: 12, priority: 12 });
    }
  }

  const merged = new Map();
  for (const item of scored) {
    const prev = merged.get(item.path);
    if (!prev || item.score > prev.score) merged.set(item.path, item);
  }

  const results = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({
      path: r.path,
      domain: r.domain,
      score: r.score,
      entitled: entitled ? entitled.has(r.path) || baseline.has(r.path) : true,
    }));

  return { intent, suggestions: results };
}
