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

let _routes = null;

function loadRoutes(rootDir = ROOT) {
  if (_routes) return _routes;
  const p = path.join(rootDir, 'skills', 'routing.json');
  _routes = JSON.parse(fs.readFileSync(p, 'utf8')).routes || [];
  return _routes;
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreRoute(route, tokens) {
  let score = route.priority || 1;
  for (const kw of route.keywords || []) {
    const parts = kw.toLowerCase().split(/\s+/);
    if (parts.every((p) => tokens.some((t) => t.includes(p) || p.includes(t)))) score += 10;
    else if (parts.some((p) => tokens.includes(p))) score += 4;
  }
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
    if (entry.workflowSkill && tokens.some((t) => t.includes('prd') || t.includes('adr'))) {
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
