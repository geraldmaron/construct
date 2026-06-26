/**
 * lib/registry/org-io.mjs — modular org filesystem helpers.
 *
 * Resolves entity JSON paths under specialists/org/** and assembles registry
 * snapshots from a git ref for diff tooling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ORG_SECTIONS = [
  ['groups', 'teams'],
  ['teams', 'teams'],
  ['specialists', 'specialists'],
  ['contracts', 'contracts'],
  ['policies', 'policies'],
];

export function findOrgEntityFile(rootDir, section, id) {
  const dir = path.join(rootDir, 'specialists', 'org', section);
  if (!fs.existsSync(dir)) return null;
  const direct = path.join(dir, `${id}.json`);
  if (fs.existsSync(direct)) return direct;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw.id === id || name.replace(/\.json$/, '') === id) return filePath;
    } catch { /* skip malformed */ }
  }
  return null;
}

export function findTeamFile(rootDir, teamId) {
  return findOrgEntityFile(rootDir, 'teams', teamId)
    || findOrgEntityFile(rootDir, 'groups', teamId);
}

export function removeOrgEntityFile(rootDir, section, id) {
  const filePath = findOrgEntityFile(rootDir, section, id);
  if (!filePath) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function assembleRegistryAtGitRef(rootDir, ref = 'HEAD') {
  const assembled = { version: 3, teams: {}, specialists: {}, contracts: {}, policies: {} };
  for (const [dirName, bucket] of ORG_SECTIONS) {
    let files = [];
    try {
      const out = execSync(`git ls-tree -r --name-only ${ref} -- specialists/org/${dirName}`, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      files = out ? out.split('\n').filter(Boolean) : [];
    } catch { /* no org at ref */ }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = execSync(`git show ${ref}:${file}`, {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const raw = JSON.parse(content);
        const entityId = raw.id || path.basename(file, '.json');
        const { id: _drop, ...rest } = raw;
        assembled[bucket][entityId] = { id: entityId, ...rest };
      } catch { /* skip unreadable */ }
    }
  }
  return assembled;
}
