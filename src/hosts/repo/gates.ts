/**
 * hosts/repo/gates.ts — what a consumer repository's own files say, read from
 * disk.
 *
 * This is the IO half of the enablement audit. Every judgement lives in
 * kernel/run/repoaudit.ts, which reasons over the RepoFacts this module
 * gathers and never touches a filesystem itself — the same split
 * hosts/repo/evidence.ts already draws for the tracker reconcile, kept here
 * for the same reason: the kernel seam forbids the kernel the filesystem, so
 * whatever stats and reads a path the caller supplies lives under hosts/.
 *
 * Reads are narrow and named rather than a general walk: package.json,
 * .github/workflows, a fixed list of eslint config names, tsconfig.json.
 * hosts/sources.ts's own directory walk was built for a different job and
 * explicitly skips dot-prefixed entries — exactly the files an enablement
 * audit exists to check — so it is not reused here; reusing it would mean
 * silently never seeing a CI workflow or a lint config at all.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoFacts, RepoFactsResult } from '../../kernel/run/repoaudit.ts';

const ESLINT_CONFIG_NAMES = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.eslintrc',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
];

interface PackageManifest {
  readonly scripts?: Record<string, unknown>;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
}

/**
 * package.json, parsed once. A manifest that does not parse is reported the
 * same as one with no scripts rather than thrown: a malformed file in the
 * repository being audited must not crash the audit that is checking it, and
 * "no scripts declared" is still an honest reading of it.
 */
function readManifest(root: string): PackageManifest | null {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
  } catch {
    return {};
  }
}

function scriptsOf(manifest: PackageManifest): Record<string, string> {
  const scripts: Record<string, string> = {};
  for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
    if (typeof value === 'string') scripts[name] = value;
  }
  return scripts;
}

function listCiWorkflows(root: string): string[] {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => `.github/workflows/${entry.name}`)
      .sort();
  } catch {
    // A directory that exists but cannot be listed reads the same as one
    // holding no workflow files: the audit says what it found, not why a
    // read failed partway.
    return [];
  }
}

function findEslintConfig(root: string): string | null {
  for (const name of ESLINT_CONFIG_NAMES) {
    if (existsSync(join(root, name))) return name;
  }
  return null;
}

function declaresTypeScript(manifest: PackageManifest | null): boolean {
  if (!manifest) return false;
  return Boolean(manifest.dependencies?.typescript) || Boolean(manifest.devDependencies?.typescript);
}

/**
 * Read what one repository's own files say about the gates it carries.
 * Never throws: a root that cannot be read is the unreachable answer, which
 * is a result, not an error — the same discipline hosts/sources.ts's
 * surveySource holds for a declared source it cannot walk.
 */
export function gatherRepoFacts(root: string): RepoFactsResult {
  let stat;
  try {
    stat = statSync(root);
  } catch (error) {
    return { outcome: 'unreachable', root, reason: (error as Error).message };
  }
  if (!stat.isDirectory()) {
    return { outcome: 'unreachable', root, reason: `${root} is not a directory` };
  }

  const manifest = readManifest(root);
  const packageJson: RepoFacts['packageJson'] = manifest
    ? { path: join(root, 'package.json'), scripts: scriptsOf(manifest) }
    : null;

  return {
    outcome: 'read',
    root,
    packageJson,
    ciWorkflowFiles: listCiWorkflows(root),
    eslintConfigPath: findEslintConfig(root),
    isTypeScriptProject: existsSync(join(root, 'tsconfig.json')) || declaresTypeScript(manifest),
  };
}
