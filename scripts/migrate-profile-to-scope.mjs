#!/usr/bin/env node
/**
 * One-shot migration: profile vocabulary → scope. Run once then delete.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP = new Set(['node_modules', '.git', 'bun', 'archive', '.beads']);
const EXT = new Set(['.mjs', '.js', '.json', '.md', '.mdx', '.yml', '.yaml']);

const REPLACEMENTS = [
  [/lib\/profiles\//g, 'lib/scopes/'],
  [/\.\.\/profiles\//g, '../scopes/'],
  [/\.\.\/\.\.\/profiles\//g, '../../scopes/'],
  [/\.\/profiles\//g, './scopes/'],
  [/from '\.\/profiles\//g, "from './scopes/"],
  [/resolveActiveProfile/g, 'resolveActiveScope'],
  [/loadCustomProfile/g, 'loadCustomScope'],
  [/loadProfile/g, 'loadScope'],
  [/listProfiles/g, 'listScopes'],
  [/enrichProfile/g, 'enrichScope'],
  [/collectProfileRoleIds/g, 'collectScopeRoleIds'],
  [/profileTeamsById/g, 'scopeTeamsById'],
  [/resolveIntentTeamForProfile/g, 'resolveIntentTeamForScope'],
  [/classifyObjectiveForProfile/g, 'classifyObjectiveForScope'],
  [/resolveProfileTeamMeta/g, 'resolveScopeTeamMeta'],
  [/PROFILE_INTENT_TO_TEAM/g, 'SCOPE_INTENT_TO_TEAM'],
  [/profileTeamSource/g, 'scopeTeamSource'],
  [/readProfileFromProjectConfig/g, 'readScopeFromProjectConfig'],
  [/configProfileId/g, 'configScopeId'],
  [/DEFAULT_PROFILE_ID/g, 'DEFAULT_SCOPE_ID'],
  [/schemas\/profile\.schema\.json/g, 'schemas/scope.schema.json'],
  [/lint:profiles/g, 'lint:scopes'],
  [/lint-profiles\.mjs/g, 'lint-scopes.mjs'],
  [/\.cx\/profile\.json/g, '.cx/scope.json'],
  [/profile_show/g, 'scope_show'],
  [/profile_list/g, 'scope_list'],
  [/profile_drafts/g, 'scope_drafts'],
  [/profile_health/g, 'scope_health'],
  [/profile_create/g, 'scope_create'],
  [/profile_archive/g, 'scope_archive'],
  [/profileShow/g, 'scopeShow'],
  [/profileList/g, 'scopeList'],
  [/profileDrafts/g, 'scopeDrafts'],
  [/profileHealthTool/g, 'scopeHealthTool'],
  [/profileCreate/g, 'scopeCreate'],
  [/profileArchive/g, 'scopeArchive'],
  [/createDraftProfile/g, 'createDraftScope'],
  [/archiveProfile/g, 'archiveScope'],
  [/profileHealth/g, 'scopeHealth'],
  [/profile\.updated/g, 'scope.updated'],
  [/mcp\/tools\/profile\.mjs/g, 'mcp/tools/scope.mjs'],
  [/tools\/profile\.mjs/g, 'tools/scope.mjs'],
  [/construct profile /g, 'construct scope '],
  [/construct profile\n/g, 'construct scope\n'],
  [/"profile":\s*"rnd"/g, '"scope": "rnd"'],
  [/raw\?\.profile === 'string'/g, "raw?.scope === 'string'"],
  [/raw\?\.profile\b/g, 'raw?.scope'],
  [/tests\/profiles\//g, 'tests/scopes/'],
  [/tests\/profile-rebrand/g, 'tests/scope-rebrand'],
  [/tests\/profiles-teams/g, 'tests/scopes-teams'],
  [/profile-lifecycle/g, 'scope-lifecycle'],
  [/b1-profile-loader/g, 'b1-scope-loader'],
  [/headhunt-profile-teams/g, 'headhunt-scope-teams'],
  [/profile-ux-preview/g, 'scope-ux-preview'],
  [/mcp-profile-tools/g, 'mcp-scope-tools'],
  [/init-intake-archetype/g, 'init-intake-archetype'],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

let changed = 0;
for (const file of walk(ROOT)) {
  if (file.includes('migrate-profile-to-scope.mjs')) continue;
  if (file.includes('lib/profiles/')) continue;
  let text = fs.readFileSync(file, 'utf8');
  const orig = text;
  for (const [re, rep] of REPLACEMENTS) text = text.replace(re, rep);
  if (text !== orig) {
    fs.writeFileSync(file, text);
    changed++;
  }
}

console.log(`Updated ${changed} files`);
