/**
 * lib/demo-script.mjs — load committed demo scripts.
 *
 * Scripts live in templates/demos/scripts/ (shipped) and .construct/demos/scripts/
 * (project overrides). Each script defines steps, system overlay, and optional
 * recording fallbacks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath } from './config-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

export function demoScriptSearchDirs({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  return [
    configPath(cwd, 'demos', 'scripts'),
    path.join(repoRoot, 'templates', 'demos', 'scripts'),
  ];
}

export function listDemoScripts({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const seen = new Set();
  const out = [];
  for (const dir of demoScriptSearchDirs({ cwd, repoRoot })) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const name = path.basename(file, '.json');
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out.sort();
}

export function resolveDemoScriptPath(name, { cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  for (const dir of demoScriptSearchDirs({ cwd, repoRoot })) {
    const candidate = path.join(dir, `${name}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadDemoScript(name, { cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const filePath = resolveDemoScriptPath(name, { cwd, repoRoot });
  if (!filePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const steps = Array.isArray(raw.steps) ? raw.steps.filter((s) => s && (s.prompt || s.command)) : [];
    const artifactReveal = raw.artifactReveal && typeof raw.artifactReveal === 'object'
      ? {
          mode: raw.artifactReveal.mode || 'constructPreview',
          staticDir: raw.artifactReveal.staticDir || '.',
          file: raw.artifactReveal.file || raw.artifactReveal.path || null,
          scroll: raw.artifactReveal.scroll !== false,
        }
      : null;

    return {
      name: raw.name || name,
      title: raw.title || name,
      summary: raw.summary || '',
      systemOverlay: raw.systemOverlay || '',
      tape: raw.tape || name,
      dashboardDemo: raw.dashboardDemo || null,
      recording: raw.recording || null,
      engine: raw.engine || null,
      artifactReveal,
      fallbackSurface: raw.fallbackSurface || 'tape',
      fixtures: raw.fixtures || {},
      steps,
      sourcePath: filePath,
    };
  } catch {
    return null;
  }
}

export function formatDemoWelcome(script) {
  const lines = [
    `Demo: ${script.title}`,
    script.summary,
    '',
    'Steps (use /demo next for the next prompt, /demo steps to replay):',
  ];
  script.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step.title || step.prompt?.slice(0, 60) || 'step'}`);
  });
  lines.push('', 'Type /demo next to see the first prompt, or describe what you want in your own words.');
  return lines.filter(Boolean).join('\n');
}

export function createDemoGuide(script) {
  let index = 0;
  return {
    script,
    currentIndex: () => index,
    steps: () => script.steps,
    reset() { index = 0; },
    next() {
      if (index >= script.steps.length) return null;
      const step = script.steps[index];
      index += 1;
      return { index, ...step };
    },
    peek() {
      if (index >= script.steps.length) return null;
      return { index: index + 1, ...script.steps[index] };
    },
  };
}
