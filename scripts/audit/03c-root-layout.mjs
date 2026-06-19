/**
 * 03c-root-layout.mjs — Phase 3c: tool-repo root layout hygiene.
 *
 * Flags legacy top-level directories, phantom npm pack paths, stale README
 * structure descriptions, and runtime imports of the retired root providers/ tree.
 * Read-only. Run: node scripts/audit/03c-root-layout.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from './lib/handlers.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const LEGACY_ROOT_DIRS = ['dashboard', 'providers'];

const RETIRED_DIR_DESCRIPTION_KEYS = new Set(['agents', 'site', 'claude', 'codex', 'telemetry']);

const RUNTIME_SCAN_DIRS = ['bin', 'lib', 'scripts', 'apps'];
const RUNTIME_EXTS = ['.mjs', '.js'];
const RUNTIME_EXCLUDE = /(node_modules|\.git|audit-artifacts|lib\/providers\/contract\/adapters)/;
const LEGACY_IMPORT_RE = /from\s+['"][^'"]*\/providers\/(lib|github|jira|slack|confluence|git)\//;

function trackedRootEntries(rootDir) {
  try {
    const out = execSync('git ls-tree --name-only HEAD', {
      cwd: rootDir,
      encoding: 'utf8',
    });
    return new Set(out.trim().split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

function legacyRootDirs(rootDir) {
  const tracked = trackedRootEntries(rootDir);
  const hits = [];
  for (const name of LEGACY_ROOT_DIRS) {
    const full = path.join(rootDir, name);
    if (!fs.existsSync(full)) continue;
    if (tracked && !tracked.has(name)) continue;
    hits.push(name);
  }
  return hits;
}

function phantomPackPaths(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const files = pkg.files ?? [];
  const hits = [];
  for (const entry of files) {
    if (!entry.endsWith('/**') && !entry.endsWith('/')) continue;
    const dir = entry.replace(/\/\*\*$/, '').replace(/\/$/, '');
    const full = path.join(rootDir, dir);
    if (!fs.existsSync(full)) hits.push(entry);
  }
  return hits;
}

function staleDirDescriptions(rootDir) {
  const autoDocsPath = path.join(rootDir, 'lib', 'auto-docs.mjs');
  if (!fs.existsSync(autoDocsPath)) return [];
  const src = fs.readFileSync(autoDocsPath, 'utf8');
  const block = src.match(/const DIR_DESCRIPTIONS = \{([\s\S]*?)\};/);
  if (!block) return [];
  const keys = [...block[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
  return keys.filter((k) => RETIRED_DIR_DESCRIPTION_KEYS.has(k));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (RUNTIME_EXCLUDE.test(full)) continue;
    if (e.isDirectory()) walk(full, out);
    else if (RUNTIME_EXTS.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

function legacyProviderImports(rootDir) {
  const hits = [];
  for (const base of RUNTIME_SCAN_DIRS) {
    for (const file of walk(path.join(rootDir, base))) {
      const rel = path.relative(rootDir, file);
      if (rel.startsWith('tests/')) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (LEGACY_IMPORT_RE.test(line)) {
          hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
        }
      });
    }
  }
  return hits;
}

function rootPackTarballs(rootDir) {
  const hits = [];
  for (const name of fs.readdirSync(rootDir)) {
    if (!name.endsWith('.tgz') && !name.endsWith('.tar.gz')) continue;
    const full = path.join(rootDir, name);
    if (!fs.statSync(full).isFile()) continue;
    hits.push(name);
  }
  return hits;
}

export function rootLayoutFindings(rootDir = REPO_ROOT) {
  const rows = [];
  for (const dir of legacyRootDirs(rootDir)) {
    rows.push({
      type: 'legacy-root-dir',
      target: dir,
      severity: 'high',
      tier: 'mechanical',
      evidence: `Legacy directory ${dir}/ at repo root — superseded by apps/ or lib/ layout`,
      recommendation: `Remove ${dir}/ from the repository (git rm -r ${dir}/).`,
    });
  }
  for (const entry of phantomPackPaths(rootDir)) {
    rows.push({
      type: 'packaging-phantom',
      target: entry,
      severity: 'medium',
      tier: 'mechanical',
      evidence: `package.json files includes ${entry} but path does not exist`,
      recommendation: `Remove ${entry} from package.json files or restore the directory.`,
    });
  }
  for (const key of staleDirDescriptions(rootDir)) {
    rows.push({
      type: 'stale-auto-doc',
      target: `DIR_DESCRIPTIONS.${key}`,
      severity: 'low',
      tier: 'mechanical',
      evidence: `lib/auto-docs.mjs DIR_DESCRIPTIONS still lists retired key "${key}"`,
      recommendation: `Remove or update DIR_DESCRIPTIONS.${key} in lib/auto-docs.mjs.`,
    });
  }
  for (const hit of legacyProviderImports(rootDir)) {
    rows.push({
      type: 'import-legacy-path',
      target: `${hit.file}:${hit.line}`,
      severity: 'high',
      tier: 'mechanical',
      evidence: hit.text,
      recommendation: 'Import from lib/providers/contract/ instead of root providers/.',
    });
  }
  for (const name of rootPackTarballs(rootDir)) {
    rows.push({
      type: 'root-pack-tarball',
      target: name,
      severity: 'low',
      tier: 'mechanical',
      evidence: 'npm pack output at repo root — gitignored but pollutes the workspace',
      recommendation: `Remove ${name} (npm run clean:artifacts) and pack to a temp dir in scripts.`,
    });
  }
  return rows;
}

function main() {
  const report = {
    legacyRootDirs: legacyRootDirs(REPO_ROOT),
    phantomPackPaths: phantomPackPaths(REPO_ROOT),
    staleDirDescriptions: staleDirDescriptions(REPO_ROOT),
    legacyProviderImports: legacyProviderImports(REPO_ROOT),
  };
  const findings = rootLayoutFindings(REPO_ROOT);
  recordFindings('03c-root-layout', findings);
  writeJson('root-layout.json', report);
  process.stdout.write(
    `[audit:03c] legacy dirs: ${report.legacyRootDirs.length}, phantom pack: ${report.phantomPackPaths.length}, ` +
    `stale auto-doc keys: ${report.staleDirDescriptions.length}, legacy imports: ${report.legacyProviderImports.length}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
