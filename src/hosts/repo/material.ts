/**
 * hosts/repo/material.ts — what a project's own files already say about it.
 *
 * The IO half of progressive discovery. Reads are narrow and named: the
 * README, agent instructions, contribution and architecture documents, an
 * ownership file, the package manifest, CI workflow names, and the names of
 * documentation files. Nothing is interpreted here; kernel/project/discovery.ts
 * turns this material into proposals with provenance. Symbolic links are
 * skipped, every file is capped, and a file that cannot be read is simply
 * absent from the material.
 */

import { lstatSync, openSync, readFileSync, closeSync, constants, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const MAX_MATERIAL_FILE_BYTES = 65_536;

export interface MaterialFile {
  /** Path relative to the project root, with forward slashes. */
  readonly path: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface PackageManifestFacts {
  readonly path: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly workspaces: boolean;
  readonly scripts: readonly string[];
}

export interface ProjectMaterial {
  readonly root: string;
  readonly readme: MaterialFile | null;
  readonly agentInstructions: readonly MaterialFile[];
  readonly contributing: MaterialFile | null;
  readonly architectureDocs: readonly MaterialFile[];
  readonly strategy: MaterialFile | null;
  readonly glossary: MaterialFile | null;
  readonly codeowners: MaterialFile | null;
  readonly manifest: PackageManifestFacts | null;
  readonly ciWorkflows: readonly string[];
  readonly docFiles: readonly string[];
  readonly hasTypeScript: boolean;
}

const README_NAMES = ['README.md', 'readme.md', 'README', 'README.rst', 'README.txt'];
const AGENT_NAMES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'GEMINI.md'];
const CONTRIBUTING_NAMES = ['CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
const ARCHITECTURE_NAMES = ['ARCHITECTURE.md', 'docs/ARCHITECTURE.md', 'docs/architecture.md', 'DESIGN.md', 'docs/design.md'];
const STRATEGY_NAMES = ['STRATEGY.md', 'docs/STRATEGY.md', 'docs/strategy.md'];
const GLOSSARY_NAMES = ['GLOSSARY.md', 'docs/GLOSSARY.md', 'docs/glossary.md'];
const CODEOWNERS_NAMES = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];

function isPlainFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function readCapped(root: string, rel: string): MaterialFile | null {
  const path = join(root, rel);
  if (!isPlainFile(path)) return null;
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const bytes = readFileSync(fd);
    const truncated = bytes.byteLength > MAX_MATERIAL_FILE_BYTES;
    const text = (truncated ? bytes.subarray(0, MAX_MATERIAL_FILE_BYTES) : bytes).toString('utf8');
    return { path: rel.replaceAll('\\', '/'), text, truncated };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function firstOf(root: string, names: readonly string[]): MaterialFile | null {
  for (const name of names) {
    const file = readCapped(root, name);
    if (file) return file;
  }
  return null;
}

/** Every named file that exists, once each: a case-insensitive filesystem serves two names from one file. */
function allOf(root: string, names: readonly string[]): MaterialFile[] {
  const seen = new Set<string>();
  const out: MaterialFile[] = [];
  for (const name of names) {
    if (seen.has(name.toLowerCase())) continue;
    const file = readCapped(root, name);
    if (!file) continue;
    seen.add(name.toLowerCase());
    out.push(file);
  }
  return out;
}

function readManifest(root: string): PackageManifestFacts | null {
  const file = readCapped(root, 'package.json');
  if (!file) return null;
  try {
    const raw = JSON.parse(file.text) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { path: file.path, name: null, description: null, workspaces: false, scripts: [] };
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

function listFiles(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && pattern.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Names (not contents) of documentation files, two levels under docs/. */
function listDocFiles(root: string): string[] {
  const docsDir = join(root, 'docs');
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(docsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && /\.(md|rst|txt)$/i.test(entry.name)) out.push(`docs/${entry.name}`);
    if (entry.isDirectory()) {
      for (const name of listFiles(join(docsDir, entry.name), /\.(md|rst|txt)$/i)) {
        out.push(`docs/${entry.name}/${name}`);
      }
    }
  }
  return out.sort().slice(0, 200);
}

export function gatherProjectMaterial(root: string): ProjectMaterial {
  const manifest = readManifest(root);
  return {
    root,
    readme: firstOf(root, README_NAMES),
    agentInstructions: allOf(root, AGENT_NAMES),
    contributing: firstOf(root, CONTRIBUTING_NAMES),
    architectureDocs: allOf(root, ARCHITECTURE_NAMES),
    strategy: firstOf(root, STRATEGY_NAMES),
    glossary: firstOf(root, GLOSSARY_NAMES),
    codeowners: firstOf(root, CODEOWNERS_NAMES),
    manifest,
    ciWorkflows: listFiles(join(root, '.github', 'workflows'), /\.ya?ml$/).map((n) => `.github/workflows/${n}`),
    docFiles: listDocFiles(root),
    hasTypeScript: isPlainFile(join(root, 'tsconfig.json')),
  };
}

export function relativeTo(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}
