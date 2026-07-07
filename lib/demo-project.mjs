/**
 * lib/demo-project.mjs — project-level demo plug-in scaffold (.cx/demos).
 *
 * `construct demo init --from-project` calls scaffoldProjectDemo to seed a
 * project-defined demo from real project signals (no fabricated scenario
 * content): a manifest (<name>.project.json) plus the demo script and terminal
 * tape stub it ships with, all under .cx/demos/. The manifest is
 * validated against schemas/project-demo.schema.json by a hand-rolled checker
 * (Construct stays dependency-free at startup — no ajv).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContextState } from './context-state.mjs';
import { configPath, CONFIG_DIR_NAME } from './config-dir.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const PROJECT_DEMO_SCHEMA = 'construct/project-demo/1';

export function projectDemosDir(cwd) {
  return configPath(cwd, 'demos');
}

export function projectDemoManifestPath(cwd, name) {
  return join(projectDemosDir(cwd), `${name}.project.json`);
}

export function projectDemoScriptRel(name) {
  return `${CONFIG_DIR_NAME}/demos/scripts/${name}.json`;
}

export function projectDemoTapeRel(name) {
  return `${CONFIG_DIR_NAME}/demos/tapes/${name}.tape`;
}

// The project name is read, never invented: prefer the durable context state,
// then package.json, and only then the directory basename as a last resort.

export function resolveProjectName(cwd) {
  const state = readContextState(cwd);
  if (state?.projectName && typeof state.projectName === 'string') return state.projectName;

  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg?.name && typeof pkg.name === 'string') return pkg.name;
    } catch { /* unreadable package.json falls through to the directory name */ }
  }

  return basename(cwd) || 'project';
}

function projectScriptSource(name, projectName) {
  return {
    name,
    title: `${projectName} demo — ${name}`,
    summary: `Project demo for ${projectName}: walk Construct's read-only status and capability surfaces.`,
    systemOverlay: `Demo mode for the ${projectName} project. Run the exact construct CLI commands from each step. Every command here is read-only and secret-free; report exactly what each command emits and do not invent output.`,
    tape: name,
    fallbackSurface: 'tape',
    steps: [
      {
        title: 'Status — system health',
        prompt: `Run construct status to show ${projectName}'s system health and configured credentials.`,
        command: 'node bin/construct status',
      },
      {
        title: 'Capability — what this install can do',
        prompt: 'Run construct capability describe --json to emit the read-only capability contract for this install.',
        command: 'node bin/construct capability describe --json',
      },
    ],
  };
}

function projectTapeSource(name, projectName) {
  return `Require node
Require vhs
# construct demo: ${name} — ${projectName} project plug-in
Output ${projectDemoTapeRel(name)}
Set FontSize 18
Set Width 1100
Set Height 600
Set TypingSpeed 60ms

Type "node bin/construct status"
Sleep 500ms
Enter
Sleep 2s

Type "node bin/construct capability describe --json"
Sleep 500ms
Enter
Sleep 2s
`;
}

export function buildProjectDemoManifest(name, { cwd, projectName, now = () => new Date() } = {}) {
  const resolvedProject = projectName || resolveProjectName(cwd);
  return {
    $schema: '../../schemas/project-demo.schema.json',
    schema: PROJECT_DEMO_SCHEMA,
    name,
    title: `${resolvedProject} demo — ${name}`,
    summary: `Project-defined Construct demo for ${resolvedProject}.`,
    project: resolvedProject,
    script: projectDemoScriptRel(name),
    tape: projectDemoTapeRel(name),
    fallbackSurface: 'tape',
    createdAt: now().toISOString(),
  };
}

// A hand-rolled validator against schemas/project-demo.schema.json. Construct
// stays dependency-free at startup, so this mirrors the schema's required
// fields, const, and patterns rather than loading ajv.

export function validateProjectDemoManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { valid: false, errors: ['manifest is not an object'] };

  if (manifest.schema !== PROJECT_DEMO_SCHEMA) errors.push(`schema must equal ${PROJECT_DEMO_SCHEMA}`);
  if (typeof manifest.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
    errors.push('name required, lowercase slug ([a-z0-9][a-z0-9-]*)');
  }
  if (typeof manifest.title !== 'string' || !manifest.title) errors.push('title required');
  if (typeof manifest.project !== 'string' || !manifest.project) errors.push('project required');
  if (typeof manifest.script !== 'string' || !/^\.cx\/demos\/scripts\/.+\.json$/.test(manifest.script)) {
    errors.push('script must be a .cx/demos/scripts/*.json path');
  }
  if (manifest.fallbackSurface && !['tape', 'playwright'].includes(manifest.fallbackSurface)) {
    errors.push('fallbackSurface must be tape or playwright');
  }

  return { valid: errors.length === 0, errors };
}

export function loadProjectDemoManifest(name, { cwd } = {}) {
  const manifestPath = projectDemoManifestPath(cwd, name);
  if (!existsSync(manifestPath)) return { ok: false, errors: [`project demo not found: ${name}`], manifestPath };
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const validated = validateProjectDemoManifest(manifest);
    if (!validated.valid) return { ok: false, errors: validated.errors, manifestPath };
    return { ok: true, manifest, manifestPath };
  } catch (err) {
    return { ok: false, errors: [err.message || 'invalid JSON'], manifestPath };
  }
}

export function scaffoldProjectDemo(name, { cwd, projectName, repoRoot = REPO_ROOT, now = () => new Date() } = {}) {
  if (!name) return { ok: false, message: 'A demo name is required: construct demo init <name> --from-project' };

  const manifestPath = projectDemoManifestPath(cwd, name);
  if (existsSync(manifestPath)) return { ok: false, message: `Project demo already exists: ${manifestPath}` };

  const resolvedProject = projectName || resolveProjectName(cwd);
  const demosDir = projectDemosDir(cwd);
  const scriptsDir = join(demosDir, 'scripts');
  const tapesDir = join(demosDir, 'tapes');
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(tapesDir, { recursive: true });

  const scriptPath = join(cwd, projectDemoScriptRel(name));
  const tapePath = join(cwd, projectDemoTapeRel(name));

  const script = projectScriptSource(name, resolvedProject);
  writeFileSync(scriptPath, `${JSON.stringify(script, null, 2)}\n`, 'utf8');
  writeFileSync(tapePath, projectTapeSource(name, resolvedProject), 'utf8');

  const manifest = buildProjectDemoManifest(name, { cwd, projectName: resolvedProject, now });
  const validated = validateProjectDemoManifest(manifest);
  if (!validated.valid) {
    return { ok: false, message: `Scaffolded manifest failed validation: ${validated.errors.join('; ')}` };
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    manifestPath,
    scriptPath,
    tapePath,
    project: resolvedProject,
    message: `Scaffolded project demo ${name} for ${resolvedProject}:\n  ${manifestPath}\n  ${scriptPath}\n  ${tapePath}`,
  };
}
