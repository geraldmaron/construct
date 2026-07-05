/**
 * lib/registry/retired-paths.mjs — retired registry path needles for lint gates.
 *
 * specialists/registry.json and specialists/unified-registry.json were removed
 * in favor of modular specialists/org/** assembled by loadRegistry().
 */

import fs from 'node:fs';
import path from 'node:path';

export const RETIRED_REGISTRY_PATHS = Object.freeze([
  'specialists/registry.json',
  'specialists/unified-registry.json',
]);

export const RETIRED_REGISTRY_PATH_ALLOWLIST = Object.freeze([
  'CHANGELOG.md',
  'docs/decisions/adr/0037-specialist-prompt-format.md',
  'docs/decisions/adr/0031-browser-automation-is-opt-in.md',
  'docs/decisions/adr/0033-platform-capability-registry.md',
  'docs/decisions/adr/0046-modular-org-runtime-merge.md',
  'docs/decisions/rfc/0004-team-orchestration-integration.md',
  'docs/guides/concepts/teams.md',
  'lib/migrations/v2-unified-registry.mjs',
  'scripts/migrate-org-modular.mjs',
  'scripts/migrate-unified-registry.mjs',
  'scripts/migrate-specialist-prompt-frontmatter.mjs',
  'scripts/patch-registry-readers.mjs',
  'scripts/patch-registry-readers-v2.mjs',
  'tests/no-monolithic-registry.test.mjs',
  'tests/migration-round-trip.test.mjs',
  'tests/fixtures/mcp-tool-schemas/results/project_context.result.json',
]);

export function isRetiredRegistryPathAllowed(relPath) {
  if (RETIRED_REGISTRY_PATH_ALLOWLIST.includes(relPath)) return true;
  if (relPath.startsWith('docs/operations/audit/')) return true;
  if (relPath.startsWith('docs/notes/research/')) return true;
  if (relPath.startsWith('docs/specs/')) return true;
  if (relPath.startsWith('docs/decisions/')) return true;
  if (relPath.startsWith('lib/migrations/')) return true;
  if (relPath.endsWith('.bak')) return true;
  return false;
}

export function scanRetiredRegistryPathReferences(rootDir) {
  const root = path.resolve(rootDir);
  const hits = [];
  const SKIP_DIRS = new Set(['.git', 'node_modules', '.cx', 'dist', 'coverage', '.next', '.claude', '.codex', '.cursor', '.github', '.opencode']);
  const SKIP_FILES = new Set(['lib/registry/retired-paths.mjs']);
  const SKIP_PREFIXES = ['apps/docs/.claude/', 'apps/docs/.codex/', 'apps/docs/.opencode/'];
  const EXT = new Set(['.mjs', '.js', '.md', '.mdx', '.json']);
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (ent.isDirectory()) walk(abs);
      else if (EXT.has(path.extname(ent.name)) && !SKIP_FILES.has(rel) && !SKIP_PREFIXES.some((p) => rel.startsWith(p)) && !isRetiredRegistryPathAllowed(rel)) {
        const content = fs.readFileSync(abs, 'utf8');
        for (const needle of RETIRED_REGISTRY_PATHS) {
          if (content.includes(needle)) {
            hits.push({ file: rel, needle });
            break;
          }
        }
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return hits;
}
