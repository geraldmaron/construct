/**
 * kernel/registry/workflow-registry.ts — every workflow this project can run:
 * the built-in ones under workflows/ and the project's under
 * .construct/workflows. Each is one directory with workflow.json and any
 * fixtures or schemas beside it, digested together.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleDigest, type DigestFile } from './digest.ts';
import { WORKFLOW_MANIFEST_FILE, type BundleOrigin, type RegisteredWorkflow } from './models.ts';
import { createSkillRegistry } from './skill-registry.ts';
import { bindWorkflow, workflowAlias } from './workflow-domains.ts';
import { validateWorkflowManifest } from './validation.ts';

/** `workflows/` beside the package root, whether running from src/ or dist/. */
export function builtinWorkflowsDir(): string {
  return fileURLToPath(new URL('../../../workflows/', import.meta.url));
}

export interface WorkflowRegistry {
  list(): readonly RegisteredWorkflow[];
  get(id: string, domain?: unknown): RegisteredWorkflow | null;
  file(id: string, relativePath: string): Uint8Array | null;
  problems(): readonly { readonly dir: string; readonly message: string }[];
}

const cache = new Map<string, RegisteredWorkflow>();

function walk(root: string, dir: string, out: DigestFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, path, out);
    else if (entry.isFile()) out.push({ relativePath: relative(root, path).split(sep).join('/'), bytes: readFileSync(path) });
  }
}

function load(dir: string, origin: BundleOrigin): RegisteredWorkflow | { readonly problem: string } | null {
  const manifestPath = join(dir, WORKFLOW_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const files: DigestFile[] = [];
  walk(dir, dir, files);
  const digest = bundleDigest(files);
  const cached = cache.get(digest);
  if (cached && cached.dir === dir) return cached;
  try {
    const manifest = validateWorkflowManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown, manifestPath);
    const entry: RegisteredWorkflow = { manifest, origin, dir, digest, files: files.map((f) => f.relativePath).sort() };
    cache.set(digest, entry);
    return entry;
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

function dirs(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    if (!lstatSync(root).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .map((e) => join(root, e.name))
    .sort();
}

export function createWorkflowRegistry(
  input: { readonly builtinDir?: string; readonly projectDir?: string | null } = {},
): WorkflowRegistry {
  const skills = createSkillRegistry({
    builtinDir: join(input.builtinDir ?? builtinWorkflowsDir(), '..', 'skills'),
    projectDir: input.projectDir ? join(input.projectDir, '..', 'skills') : null,
  });
  const workflows = new Map<string, RegisteredWorkflow>();
  const problems: { dir: string; message: string }[] = [];
  const sets: Array<[BundleOrigin, string[]]> = [
    ['builtin', dirs(input.builtinDir ?? builtinWorkflowsDir())],
    ['project', input.projectDir ? dirs(input.projectDir) : []],
  ];
  for (const [origin, list] of sets) {
    for (const dir of list) {
      const result = load(dir, origin);
      if (result === null) continue;
      if ('problem' in result) {
        problems.push({ dir, message: result.problem });
        continue;
      }
      const aliases = Object.keys(result.manifest.aliases ?? {});
      const collision =
        workflowAlias([...workflows.values()], result.manifest.id) ||
        aliases.find((id) => id === result.manifest.id || workflows.has(id) || workflowAlias([...workflows.values()], id));
      if (collision) {
        problems.push({ dir, message: `workflow ${result.manifest.id} collides with a reserved workflow alias` });
        continue;
      }
      if (workflows.has(result.manifest.id) && origin === 'project') {
        problems.push({ dir, message: `project workflow "${result.manifest.id}" shadows a built-in workflow; rename it or remove one` });
        continue;
      }
      workflows.set(result.manifest.id, result);
    }
  }
  return {
    list: () => [...workflows.values()].sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1)),
    get: (id, domain) => {
      const direct = workflows.get(id);
      if (direct) return typeof domain === 'string' && direct.manifest.domains ? bindWorkflow(direct, domain, undefined, skills) : direct;
      const alias = workflowAlias([...workflows.values()], id);
      if (!alias || (domain !== undefined && domain !== alias.domain)) return null;
      return bindWorkflow(alias.workflow, alias.domain, id, skills);
    },
    file: (id, relativePath) => {
      const w = workflows.get(id) ?? workflowAlias([...workflows.values()], id)?.workflow;
      if (!w || !w.files.includes(relativePath)) return null;
      return readFileSync(join(w.dir, relativePath));
    },
    problems: () => problems,
  };
}
