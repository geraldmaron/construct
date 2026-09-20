/**
 * hosts/repo/material.ts — what a project's own files already say about it.
 *
 * Reads are bounded and contained: every hop from the project root must stay
 * inside it, files are capped, and a path that cannot be read is reported
 * rather than treated as empty. Conventions (ADR directories, architecture
 * documents, agent instructions) are discovered from layout, not from a
 * closed filename list alone. Symbolic links are followed only when their
 * real path stays inside the root; two names for one real file are one file.
 */

import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { ContainmentError, inspectContained, readContainedFile } from '../../kernel/safety/containment.ts';

export const MAX_MATERIAL_FILE_BYTES = 65_536;
export const EXTRACTOR_VERSION = 'construct-discovery/3';

export interface MaterialFile {
  /** Path relative to the project root, with forward slashes. */
  readonly path: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly contentDigest: string;
  readonly viaSymlink: boolean;
  readonly size: number;
}

export interface PackageManifestFacts {
  readonly path: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly workspaces: boolean;
  readonly scripts: readonly string[];
}

export interface MaterialCoverage {
  readonly unread: readonly string[];
  readonly truncated: readonly string[];
  readonly failed: readonly { readonly path: string; readonly reason: string }[];
  readonly skippedOutside: readonly string[];
  readonly listed: readonly string[];
}

export interface ProjectMaterial {
  readonly root: string;
  readonly readme: MaterialFile | null;
  readonly agentInstructions: readonly MaterialFile[];
  readonly contributing: MaterialFile | null;
  readonly architectureDocs: readonly MaterialFile[];
  readonly decisionRecords: readonly MaterialFile[];
  readonly strategy: MaterialFile | null;
  readonly glossary: MaterialFile | null;
  readonly codeowners: MaterialFile | null;
  readonly manifest: PackageManifestFacts | null;
  readonly ciWorkflows: readonly string[];
  readonly docFiles: readonly string[];
  readonly hasTypeScript: boolean;
  readonly coverage: MaterialCoverage;
}

const README_NAMES = ['README.md', 'readme.md', 'README', 'README.rst', 'README.txt'];
const AGENT_NAMES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'GEMINI.md'];
const CONTRIBUTING_NAMES = ['CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
const ARCHITECTURE_NAMES = [
  'ARCHITECTURE.md',
  'docs/ARCHITECTURE.md',
  'docs/architecture.md',
  'docs/architecture-and-state-model.md',
  'DESIGN.md',
  'docs/design.md',
];
const STRATEGY_NAMES = ['STRATEGY.md', 'docs/STRATEGY.md', 'docs/strategy.md'];
const GLOSSARY_NAMES = ['GLOSSARY.md', 'docs/GLOSSARY.md', 'docs/glossary.md'];
const CODEOWNERS_NAMES = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const ADR_DIR_NAMES = ['docs/adr', 'docs/adrs', 'docs/decisions', 'adr', 'doc/adr'];
const SKIP_DIR = new Set(['.git', 'node_modules', '.construct', 'dist', '.cache', '.venv', '__pycache__']);

function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function toMaterial(root: string, rel: string, cap = MAX_MATERIAL_FILE_BYTES): MaterialFile | null {
  try {
    const read = readContainedFile(root, rel, cap);
    if (!read) return null;
    return {
      path: rel.replaceAll('\\', '/'),
      text: read.bytes.toString('utf8'),
      truncated: read.truncated,
      contentDigest: digestOf(read.bytes),
      viaSymlink: read.viaSymlink,
      size: read.size,
    };
  } catch (error) {
    if (error instanceof ContainmentError) return null;
    throw error;
  }
}

function firstOf(root: string, names: readonly string[], seenReal: Set<string>): MaterialFile | null {
  for (const name of names) {
    const file = readUnique(root, name, seenReal);
    if (file) return file;
  }
  return null;
}

function readUnique(root: string, rel: string, seenReal: Set<string>): MaterialFile | null {
  const inspect = inspectContained(root, rel);
  if (!inspect.ok) return null;
  if (seenReal.has(inspect.realPath)) return null;
  const file = toMaterial(root, rel);
  if (!file) return null;
  seenReal.add(inspect.realPath);
  return file;
}

function allOf(root: string, names: readonly string[], seenReal: Set<string>): MaterialFile[] {
  const out: MaterialFile[] = [];
  for (const name of names) {
    const file = readUnique(root, name, seenReal);
    if (file) out.push(file);
  }
  return out;
}

function readManifest(root: string, seenReal: Set<string>): PackageManifestFacts | null {
  const file = readUnique(root, 'package.json', seenReal);
  if (!file) return null;
  try {
    const raw = JSON.parse(file.text) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { path: file.path, name: null, description: null, workspaces: false, scripts: [] };
    }
    const record = raw as Record<string, unknown>;
    const scripts = record.scripts;
    return {
      path: file.path,
      name: typeof record.name === 'string' ? record.name : null,
      description: typeof record.description === 'string' ? record.description : null,
      workspaces: Array.isArray(record.workspaces) || (typeof record.workspaces === 'object' && record.workspaces !== null),
      scripts: scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts) ? Object.keys(scripts as object).sort() : [],
    };
  } catch {
    return { path: file.path, name: null, description: null, workspaces: false, scripts: [] };
  }
}

function listDir(root: string, relDir: string): Array<{ name: string; rel: string; directory: boolean; outside: boolean }> {
  const inspect = inspectContained(root, relDir);
  if (!inspect.ok) return [];
  const real = inspect.realPath;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(real, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ name: string; rel: string; directory: boolean; outside: boolean }> = [];
  for (const entry of entries) {
    const childRel = relDir === '.' ? entry.name : `${relDir.replaceAll('\\', '/')}/${entry.name}`;
    const child = inspectContained(root, childRel);
    if (!child.ok) {
      out.push({ name: entry.name, rel: childRel, directory: false, outside: true });
      continue;
    }
    out.push({
      name: entry.name,
      rel: childRel.replaceAll('\\', '/'),
      directory: child.stat.isDirectory(),
      outside: false,
    });
  }
  return out;
}

function discoverArchitecture(root: string, seenReal: Set<string>): MaterialFile[] {
  const named = allOf(root, ARCHITECTURE_NAMES, seenReal);
  const extra: MaterialFile[] = [];
  for (const entry of listDir(root, 'docs')) {
    if (entry.outside || entry.directory) continue;
    if (!/\.md$/i.test(entry.name)) continue;
    if (/architecture|design|invariants|state-model/i.test(entry.name) && !ARCHITECTURE_NAMES.includes(entry.rel)) {
      const file = readUnique(root, entry.rel, seenReal);
      if (file) extra.push(file);
    }
  }
  return [...named, ...extra];
}

function discoverDecisionRecords(root: string, seenReal: Set<string>): MaterialFile[] {
  const out: MaterialFile[] = [];
  for (const dir of ADR_DIR_NAMES) {
    for (const entry of listDir(root, dir)) {
      if (entry.outside || entry.directory) continue;
      if (!/\.(md|rst|txt)$/i.test(entry.name)) continue;
      const file = readUnique(root, entry.rel, seenReal);
      if (file) out.push(file);
    }
  }
  for (const entry of listDir(root, 'docs')) {
    if (entry.outside || entry.directory) continue;
    if (/^ADR[-_ ]?\d+/i.test(entry.name) || /^decision[-_]/i.test(entry.name)) {
      const file = readUnique(root, entry.rel, seenReal);
      if (file) out.push(file);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function listDocFiles(root: string, coverage: { skippedOutside: string[] }): string[] {
  const out: string[] = [];
  const docs = inspectContained(root, 'docs');
  if (!docs.ok) return out;
  const walk = (rel: string, depth: number): void => {
    if (depth > 3 || out.length >= 200) return;
    for (const entry of listDir(root, rel)) {
      if (entry.outside) {
        coverage.skippedOutside.push(entry.rel);
        continue;
      }
      if (SKIP_DIR.has(entry.name)) continue;
      if (entry.directory) walk(entry.rel, depth + 1);
      else if (/\.(md|rst|txt)$/i.test(entry.name)) out.push(entry.rel.replaceAll('\\', '/'));
    }
  };
  walk('docs', 0);
  return out.sort();
}

export function gatherProjectMaterial(root: string): ProjectMaterial {
  const seenReal = new Set<string>();
  const skippedOutside: string[] = [];
  const failed: Array<{ path: string; reason: string }> = [];
  const truncated: string[] = [];
  const unread: string[] = [];
  const listed: string[] = [];

  const take = (file: MaterialFile | null): MaterialFile | null => {
    if (!file) return null;
    listed.push(file.path);
    if (file.truncated) truncated.push(file.path);
    return file;
  };

  const manifest = readManifest(root, seenReal);
  const readme = take(firstOf(root, README_NAMES, seenReal));
  const agentInstructions = allOf(root, AGENT_NAMES, seenReal).map((f) => take(f)!);
  const contributing = take(firstOf(root, CONTRIBUTING_NAMES, seenReal));
  const architectureDocs = discoverArchitecture(root, seenReal).map((f) => take(f)!);
  const decisionRecords = discoverDecisionRecords(root, seenReal).map((f) => take(f)!);
  const strategy = take(firstOf(root, STRATEGY_NAMES, seenReal));
  const glossary = take(firstOf(root, GLOSSARY_NAMES, seenReal));
  const codeowners = take(firstOf(root, CODEOWNERS_NAMES, seenReal));
  const docFiles = listDocFiles(root, { skippedOutside });
  for (const p of docFiles) {
    if (!listed.includes(p)) unread.push(p);
  }

  const ts = inspectContained(root, 'tsconfig.json');
  const hasTypeScript = ts.ok && ts.stat.isFile();

  const ci = listDir(root, '.github/workflows')
    .filter((e) => !e.outside && !e.directory && /\.ya?ml$/.test(e.name))
    .map((e) => e.rel)
    .sort();

  return {
    root,
    readme,
    agentInstructions,
    contributing,
    architectureDocs,
    decisionRecords,
    strategy,
    glossary,
    codeowners,
    manifest,
    ciWorkflows: ci,
    docFiles,
    hasTypeScript,
    coverage: { unread, truncated, failed, skippedOutside, listed },
  };
}

export function relativeTo(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}
