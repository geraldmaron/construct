/**
 * lib/registry/assemble.mjs — Runtime merge of modular org files into registry v3.
 *
 * Walks specialists/org/{groups,teams,specialists,contracts,policies}, then
 * merges two user/project extension tiers on top, builtin -> user -> project
 * (ADR-0052's precedence model, applied here to the org registry): a home-level
 * custom org tree (~/.construct/org/**, construct-rf26.13 — a user's personal
 * custom specialists/teams shared across all their projects), then the existing
 * .cx/org project overlay (highest precedence). Later tiers win on id collision.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from '../paths.mjs';
import { configPath } from '../config-dir.mjs';

function customOrgRoot() {
  return path.join(homeDir(), '.construct', 'org');
}

function readJsonDir(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace(/\.json$/, '');
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const entityId = raw.id || id;
    const { id: _drop, ...rest } = raw;
    out[entityId] = { id: entityId, ...rest };
  }
  return out;
}

function mergeOverlaySection(base, overlaySection) {
  if (!overlaySection) return;
  for (const [id, value] of Object.entries(overlaySection)) {
    base[id] = { ...base[id], ...value };
  }
}

function mergeOrgOverlay(orgRoot, overlayRoot) {
  if (!fs.existsSync(overlayRoot)) return;
  const sections = ['groups', 'teams', 'specialists', 'contracts', 'policies'];
  for (const section of sections) {
    const overlayDir = path.join(overlayRoot, section);
    if (!fs.existsSync(overlayDir)) continue;
    const baseDir = path.join(orgRoot, section === 'groups' ? 'groups' : section);
    const base = readJsonDir(baseDir);
    for (const name of fs.readdirSync(overlayDir)) {
      if (!name.endsWith('.json')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(overlayDir, name), 'utf8'));
      const entityId = raw.id || name.replace(/\.json$/, '');
      const { id: _drop, ...rest } = raw;
      base[entityId] = { ...(base[entityId] || {}), id: entityId, ...rest };
    }
    for (const [id, value] of Object.entries(base)) {
      writeMerged(baseDir, id, value);
    }
  }
}

function writeMerged() {
  // overlay merge is in-memory only; no disk write
}

export function orgDirMtime(rootDir) {
  const orgRoot = path.join(rootDir, 'specialists', 'org');
  if (!fs.existsSync(orgRoot)) return 0;
  let max = 0;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.json')) max = Math.max(max, fs.statSync(p).mtimeMs);
    }
  };
  walk(orgRoot);
  const homeOrg = customOrgRoot();
  if (fs.existsSync(homeOrg)) walk(homeOrg);
  const overlay = configPath(rootDir, 'org');
  if (fs.existsSync(overlay)) walk(overlay);
  return max;
}

export function assembleRegistry(rootDir) {
  const orgRoot = path.join(rootDir, 'specialists', 'org');
  const overlayRoot = configPath(rootDir, 'org');

  if (!fs.existsSync(orgRoot)) {
    throw new Error(`Modular org not found: ${orgRoot}. Run node scripts/migrate-org-modular.mjs`);
  }

  const groups = readJsonDir(path.join(orgRoot, 'groups'));
  const squads = readJsonDir(path.join(orgRoot, 'teams'));
  const specialists = readJsonDir(path.join(orgRoot, 'specialists'));
  const contracts = readJsonDir(path.join(orgRoot, 'contracts'));
  const policies = readJsonDir(path.join(orgRoot, 'policies'));

  const homeOrgRoot = customOrgRoot();
  if (fs.existsSync(homeOrgRoot)) {
    for (const [id, val] of Object.entries(readJsonDir(path.join(homeOrgRoot, 'groups')))) {
      groups[id] = { ...groups[id], ...val };
    }
    for (const [id, val] of Object.entries(readJsonDir(path.join(homeOrgRoot, 'teams')))) {
      squads[id] = { ...squads[id], ...val };
    }
    for (const [id, val] of Object.entries(readJsonDir(path.join(homeOrgRoot, 'specialists')))) {
      specialists[id] = { ...specialists[id], ...val };
    }
    mergeOverlaySection(contracts, readJsonDir(path.join(homeOrgRoot, 'contracts')));
    mergeOverlaySection(policies, readJsonDir(path.join(homeOrgRoot, 'policies')));
  }

  if (fs.existsSync(overlayRoot)) {
    for (const [id, val] of Object.entries(readJsonDir(path.join(overlayRoot, 'groups')))) {
      groups[id] = { ...groups[id], ...val };
    }
    for (const [id, val] of Object.entries(readJsonDir(path.join(overlayRoot, 'teams')))) {
      squads[id] = { ...squads[id], ...val };
    }
    for (const [id, val] of Object.entries(readJsonDir(path.join(overlayRoot, 'specialists')))) {
      specialists[id] = { ...specialists[id], ...val };
    }
    mergeOverlaySection(contracts, readJsonDir(path.join(overlayRoot, 'contracts')));
    mergeOverlaySection(policies, readJsonDir(path.join(overlayRoot, 'policies')));
  }

  const teams = { ...groups, ...squads };

  for (const [specId, spec] of Object.entries(specialists)) {
    if (!spec.team && spec.teamId) spec.team = spec.teamId;
    if (!spec.teamId && spec.team) spec.teamId = spec.team;
    specialists[specId] = spec;
  }

  return {
    version: 3,
    teams,
    specialists,
    contracts,
    policies,
  };
}

export function listTeamsFromRegistry(registry, { kind } = {}) {
  const entries = Object.entries(registry.teams || {}).map(([id, team]) => ({ id, ...team }));
  if (kind === 'group') return entries.filter((t) => t.kind === 'group');
  if (kind === 'squad') return entries.filter((t) => t.kind === 'squad');
  return entries;
}

export function listGroupsHierarchical(registry) {
  const groups = listTeamsFromRegistry(registry, { kind: 'group' });
  const squads = listTeamsFromRegistry(registry, { kind: 'squad' });
  return groups.map((group) => ({
    ...group,
    squads: squads.filter((s) => s.groupId === group.id),
  }));
}
