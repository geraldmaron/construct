/**
 * host-surface.mjs — what release and conformance tooling share about this
 * tree's built-in surface and a person's host state: the surface digest a
 * release manifest names, and the Cursor CLI snapshot a live run restores.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillRegistry } from '../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../src/kernel/registry/workflow-registry.ts';
import { bundleDigest } from '../src/kernel/registry/digest.ts';
import { modelFacingDigest } from '../src/hosts/mcp/server.ts';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The built-in skill and workflow registries, with no project overlay. */
export function builtins() {
  return { skills: createSkillRegistry({ projectDir: null }), workflows: createWorkflowRegistry({ projectDir: null }) };
}

/** Runtime and invocation bytes are part of the evaluated surface too. A validator
 * or host adapter change cannot inherit an earlier routing pass merely because
 * the tool descriptions stayed the same. Only repository code paths are read.
 */
export function executionSurfaceDigest(root = ROOT) {
  const files = [];
  const walk = (path) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push({ relativePath: name.replaceAll('\\', '/'), bytes: readFileSync(join(root, name)) });
    }
  };
  for (const path of ['src', 'bin', 'scripts']) if (existsSync(join(root, path))) walk(path);
  for (const path of ['package.json', 'package-lock.json'])
    if (existsSync(join(root, path))) files.push({ relativePath: path, bytes: readFileSync(join(root, path)) });
  return bundleDigest(files);
}

/** The model-facing and execution digest of this tree's built-in surface. */
export function descriptionsDigest() {
  const { skills, workflows } = builtins();
  return bundleDigest([
    { relativePath: 'model-facing', bytes: Buffer.from(modelFacingDigest('interactive', skills, workflows)) },
    { relativePath: 'execution', bytes: Buffer.from(executionSurfaceDigest()) },
  ]);
}

/** The keys of ~/.cursor/cli-config.json a run's --model can change. */
const CURSOR_SELECTION = ['model', 'selectedModel'];

/** What the person's Cursor CLI state holds that a run may change, so it can be put back. */
export function cursorSnapshot(home = homedir()) {
  const configPath = join(home, '.cursor', 'cli-config.json');
  let config = null;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    config = null;
  }
  const list = (dir) => {
    try {
      return readdirSync(dir).flatMap((a) => {
        const full = join(dir, a);
        return statSync(full).isDirectory() ? [full, ...readdirSync(full).map((b) => join(full, b))] : [full];
      });
    } catch {
      return [];
    }
  };
  const selection = Object.fromEntries(
    CURSOR_SELECTION.filter((key) => config && Object.hasOwn(config, key)).map((key) => [key, config[key]]),
  );
  return {
    configPath,
    selection,
    chats: new Set(list(join(home, '.cursor', 'chats'))),
    projects: new Set(list(join(home, '.cursor', 'projects'))),
  };
}

/** Put the model selection back as it was, removing a key the run added, and move what the run added under ~/.cursor into its trace directory. */
export function restoreCursor(before, traceDir, home = homedir()) {
  try {
    const config = JSON.parse(readFileSync(before.configPath, 'utf8'));
    for (const key of CURSOR_SELECTION) {
      if (Object.hasOwn(before.selection, key)) config[key] = before.selection[key];
      else delete config[key];
    }
    writeFileSync(before.configPath, `${JSON.stringify(config, null, 2)}\n`);
  } catch {
    // No config to restore.
  }
  const after = cursorSnapshot(home);
  const moved = [];
  for (const [kind, set, was] of [
    ['chats', after.chats, before.chats],
    ['projects', after.projects, before.projects],
  ]) {
    for (const path of set) {
      if (was.has(path) || [...set].some((p) => p !== path && path.startsWith(`${p}/`) && !was.has(p))) continue;
      const target = join(traceDir, 'cursor', kind, relative(join(home, '.cursor', kind), path));
      mkdirSync(join(target, '..'), { recursive: true });
      try {
        renameSync(path, target);
      } catch {
        cpSync(path, target, { recursive: true });
        rmSync(path, { recursive: true, force: true });
      }
      moved.push(target);
    }
  }
  return moved;
}
