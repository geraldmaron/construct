/**
 * lib/packs/core-pack.mjs — programmatic builtin core pack loader.
 *
 * Reads the canonical registry and wraps its Worker Profiles and prompts as
 * the @construct/core pack. This is the builtin tier pack that provides
 * default Worker Profiles and reasoning frameworks
 * shipped with Construct.
 *
 * `embedBindings` ships default per-profile provider read/
 * search grants and write-proposal grants for the built-in profiles most
 * likely to run embedded: product-manager, operations, engineer.
 * These are defaults only — a project may override them via a project-tier
 * pack (.construct/packs) under the same Worker Profile id.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

// Default per-profile embed bindings. Read/search only — no
// worker gets an autonomous write; `proposals` names the write kinds a
// worker may propose, and every proposal still passes through
// AuthorityGuard's approval-queued path before anything executes.
const DEFAULT_EMBED_BINDINGS = Object.freeze({
  'product-manager': {
    providers: [
      { id: 'atlassian-jira', capabilities: ['read', 'search'] },
      { id: 'atlassian-confluence', capabilities: ['read', 'search'] },
    ],
    proposals: ['atlassian-jira.createIssue'],
  },
  'operations': {
    providers: [
      { id: 'atlassian-jira', capabilities: ['read', 'search'] },
      { id: 'atlassian-confluence', capabilities: ['read', 'search'] },
      { id: 'slack', capabilities: ['read', 'search'] },
    ],
    proposals: ['atlassian-jira.createIssue', 'slack.postMessage'],
  },
  'engineer': {
    providers: [
      { id: 'github', capabilities: ['read', 'search'] },
      { id: 'atlassian-jira', capabilities: ['read', 'search'] },
    ],
    proposals: ['github.createIssue'],
  },
});

export function loadCorePack(rootDir = PACKAGE_ROOT) {
  const workerProfileDir = join(rootDir, 'registry', 'worker-profiles');
  const promptDir = join(workerProfileDir, 'prompts');

  const workerProfiles = existsSync(workerProfileDir)
    ? readdirSync(workerProfileDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : [];

  const prompts = {};
  for (const workerProfileId of workerProfiles) {
    if (existsSync(join(promptDir, `${workerProfileId}.md`))) {
      prompts[workerProfileId] = join('registry', 'worker-profiles', 'prompts', `${workerProfileId}.md`);
    }
  }

  // frameworks map keys by frontmatter `id` (not filename) so a project-tier
  // override in .construct/packs can declare the same id from a differently named
  // file and still win under mergePackTiers/resolveFramework precedence.
  const frameworks = {};

  // Only bind Worker Profiles actually present on disk — a stripped-down or
  // customized catalog should not surface bindings for profiles it
  // doesn't ship.
  const embedBindings = {};
  for (const [workerProfileId, binding] of Object.entries(DEFAULT_EMBED_BINDINGS)) {
    if (workerProfiles.includes(workerProfileId)) embedBindings[workerProfileId] = binding;
  }

  return {
    id: '@construct/core',
    version: '0.0.0',
    compatVersion: 1,
    workerProfiles,
    prompts,
    embedBindings,
    frameworks,
    _tier: 'builtin',
    _sourceDir: workerProfileDir,
  };
}
