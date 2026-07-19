/**
 * 03c-root-layout.mjs — Phase 3c: tool-repo root layout hygiene.
 *
 * Enforces the owned root/publish disposition matrix, then flags legacy
 * top-level directories, phantom npm pack paths, stale README structure
 * descriptions, and runtime imports of the retired root providers/ tree.
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
const DISPOSITION_PATH = fileURLToPath(new URL('./root-disposition.json', import.meta.url));
const REQUIRED_DISPOSITION_FIELDS = [
  'path', 'owner', 'class', 'consumers', 'published', 'action', 'replacement', 'evidence',
];
const REQUIRED_CANDIDATE_EVIDENCE = ['staticImports', 'dynamicLookups', 'npmPack', 'tests'];

const RETIRED_DIR_DESCRIPTION_KEYS = new Set(['agents', 'site', 'claude', 'codex', 'telemetry']);

const RUNTIME_SCAN_DIRS = ['bin', 'lib', 'scripts', 'apps'];
const RUNTIME_EXTS = ['.mjs', '.js'];
const RUNTIME_EXCLUDE = /(node_modules|\.git|audit-artifacts|lib\/providers\/contract\/adapters)/;
const LEGACY_IMPORT_RE = /from\s+['"](\.[^'"]*\/providers\/(?:lib|github|jira|slack|confluence|git)\/[^'"]*)['"]/;

function trackedRootEntries(rootDir) {
  try {
    const out = execSync('git ls-tree --name-only HEAD', {
      cwd: rootDir,
      encoding: 'utf8',
    });
    return new Set(out.trim().split('\n').filter((entry) => entry && fs.existsSync(path.join(rootDir, entry))));
  } catch {
    return null;
  }
}

function loadDisposition() {
  return JSON.parse(fs.readFileSync(DISPOSITION_PATH, 'utf8'));
}

function packageFileEntries(rootDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return pkg.files ?? [];
}

function localRootEntries(rootDir, tracked) {
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name !== '.git' && !tracked.has(name))
    .sort();
}

function matchesLocalRule(name, pattern) {
  if (!pattern.includes('*')) return name === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

function dispositionRowProblems(row, validClasses, validActions, pathField = 'path') {
  const problems = [];
  for (const field of REQUIRED_DISPOSITION_FIELDS) {
    const actual = field === 'path' ? pathField : field;
    if (!Object.hasOwn(row, actual)) problems.push(`missing ${actual}`);
  }
  if (row.owner === '') problems.push('owner is empty');
  if (!validClasses.has(row.class)) problems.push(`invalid class ${JSON.stringify(row.class)}`);
  if (!validActions.has(row.action)) problems.push(`invalid action ${JSON.stringify(row.action)}`);
  if (!Array.isArray(row.consumers)) problems.push('consumers is not an array');
  if (typeof row.published !== 'boolean') problems.push('published is not boolean');
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) problems.push('evidence is empty');
  if (['relocate', 'merge', 'delete'].includes(row.action)) {
    for (const field of REQUIRED_CANDIDATE_EVIDENCE) {
      if (typeof row.candidateEvidence?.[field] !== 'string' || row.candidateEvidence[field].trim() === '') {
        problems.push(`candidateEvidence.${field} is empty`);
      }
    }
  }
  if (['relocate', 'merge'].includes(row.action) && !row.replacement) problems.push('replacement is empty');
  if (row.class === 'local' && row.action === 'delete' && row.ownership === 'unproven' && row.removalAuthorized !== false) {
    problems.push('unproven local state must set removalAuthorized=false');
  }
  return problems;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function rootDispositionReport(rootDir = REPO_ROOT) {
  const manifest = loadDisposition();
  const tracked = trackedRootEntries(rootDir) ?? new Set();
  const packageFiles = packageFileEntries(rootDir);
  const rootRows = manifest.trackedRoots ?? [];
  const packageRows = manifest.packageFiles ?? [];
  const localRules = manifest.localRootRules ?? [];
  const classifiedRoots = new Set(rootRows.map((row) => row.path));
  const classifiedPackageFiles = new Set(packageRows.map((row) => row.path));
  const localEntries = localRootEntries(rootDir, tracked);
  const validClasses = new Set(manifest.classes ?? []);
  const validActions = new Set(manifest.actions ?? []);

  return {
    manifest,
    trackedRoots: [...tracked].sort(),
    packageFiles,
    localEntries,
    unclassifiedTrackedRoots: [...tracked].filter((entry) => !classifiedRoots.has(entry)).sort(),
    staleTrackedRootRows: rootRows.map((row) => row.path).filter((entry) => !tracked.has(entry)).sort(),
    unclassifiedPackageFiles: packageFiles.filter((entry) => !classifiedPackageFiles.has(entry)).sort(),
    stalePackageFileRows: packageRows.map((row) => row.path).filter((entry) => !packageFiles.includes(entry)).sort(),
    unclassifiedLocalEntries: localEntries.filter(
      (entry) => !localRules.some((rule) => matchesLocalRule(entry, rule.pattern)),
    ),
    duplicateTrackedRootRows: duplicateValues(rootRows.map((row) => row.path)),
    duplicatePackageFileRows: duplicateValues(packageRows.map((row) => row.path)),
    duplicateLocalRules: duplicateValues(localRules.map((row) => row.pattern)),
    invalidRows: [
      ...rootRows.map((row) => ({ section: 'trackedRoots', target: row.path, problems: dispositionRowProblems(row, validClasses, validActions) })),
      ...packageRows.map((row) => ({ section: 'packageFiles', target: row.path, problems: dispositionRowProblems(row, validClasses, validActions) })),
      ...localRules.map((row) => ({ section: 'localRootRules', target: row.pattern, problems: dispositionRowProblems(row, validClasses, validActions, 'pattern') })),
    ].filter((row) => row.problems.length > 0),
    candidates: {
      trackedRoots: rootRows.filter((row) => row.action !== 'retain').map((row) => row.path),
      packageFiles: packageRows.filter((row) => row.action !== 'retain').map((row) => row.path),
      localEntries: localRules.filter((row) => row.action === 'delete').map((row) => ({
        pattern: row.pattern,
        ownership: row.ownership,
        removalAuthorized: row.removalAuthorized,
      })),
    },
  };
}

export function rootDispositionFindings(rootDir = REPO_ROOT) {
  const report = rootDispositionReport(rootDir);
  const rows = [];
  const categories = [
    ['unclassified-root', report.unclassifiedTrackedRoots, 'Tracked root has no disposition'],
    ['stale-root-disposition', report.staleTrackedRootRows, 'Disposition names a root absent from HEAD'],
    ['unclassified-package-file', report.unclassifiedPackageFiles, 'package.json files entry has no disposition'],
    ['stale-package-disposition', report.stalePackageFileRows, 'Disposition names an entry absent from package.json files'],
    ['unclassified-local-root', report.unclassifiedLocalEntries, 'Local root residue has no ownership rule'],
    ['duplicate-root-disposition', report.duplicateTrackedRootRows, 'Tracked-root disposition is duplicated'],
    ['duplicate-package-disposition', report.duplicatePackageFileRows, 'Package-files disposition is duplicated'],
    ['duplicate-local-rule', report.duplicateLocalRules, 'Local-root rule is duplicated'],
  ];
  for (const [type, targets, evidence] of categories) {
    for (const target of targets) {
      rows.push({
        type,
        target,
        severity: 'high',
        tier: 'mechanical',
        evidence: `${evidence}: ${target}`,
        recommendation: 'Update scripts/audit/root-disposition.json with an owned, evidenced disposition.',
      });
    }
  }
  for (const invalid of report.invalidRows) {
    rows.push({
      type: 'invalid-root-disposition',
      target: `${invalid.section}:${invalid.target}`,
      severity: 'high',
      tier: 'mechanical',
      evidence: invalid.problems.join('; '),
      recommendation: 'Complete the disposition row and candidate evidence.',
    });
  }
  return rows;
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

// A relative specifier matching /providers/(lib|github|...)/ is only a legacy-root import
// when it actually resolves outside lib/providers/ (the current, retained provider tree) —
// the same substring appears in in-tree specifiers like '../../providers/github/index.mjs'
// written from lib/workplace-loop/sources/, which resolves to lib/providers/github/.

function legacyProviderImports(rootDir) {
  const currentProvidersDir = path.join(rootDir, 'lib', 'providers');
  const hits = [];
  for (const base of RUNTIME_SCAN_DIRS) {
    for (const file of walk(path.join(rootDir, base))) {
      const rel = path.relative(rootDir, file);
      if (rel.startsWith('tests/')) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const match = line.match(LEGACY_IMPORT_RE);
        if (!match) return;
        const resolved = path.resolve(path.dirname(file), match[1]);
        if (resolved.startsWith(currentProvidersDir + path.sep)) return;
        hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
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
  const rows = rootDispositionFindings(rootDir);
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
  const disposition = rootDispositionReport(REPO_ROOT);
  const report = {
    legacyRootDirs: legacyRootDirs(REPO_ROOT),
    phantomPackPaths: phantomPackPaths(REPO_ROOT),
    staleDirDescriptions: staleDirDescriptions(REPO_ROOT),
    legacyProviderImports: legacyProviderImports(REPO_ROOT),
    disposition: {
      trackedRoots: disposition.trackedRoots.length,
      packageFiles: disposition.packageFiles.length,
      localEntries: disposition.localEntries.length,
      candidates: disposition.candidates,
      driftFindings: rootDispositionFindings(REPO_ROOT),
    },
  };
  const findings = rootLayoutFindings(REPO_ROOT);
  recordFindings('03c-root-layout', findings);
  writeJson('root-layout.json', report);
  process.stdout.write(
    `[audit:03c] legacy dirs: ${report.legacyRootDirs.length}, phantom pack: ${report.phantomPackPaths.length}, ` +
    `stale auto-doc keys: ${report.staleDirDescriptions.length}, legacy imports: ${report.legacyProviderImports.length}, ` +
    `disposition drift: ${report.disposition.driftFindings.length}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
