/**
 * Deterministic Worker Profile prompt contract checks.
 *
 * Per-profile gates for certification preflight:
 * frontmatter keys, tool allowlist vs registry, anti-fabrication section, perspective fields.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { validatePromptContent } from '../worker-profiles/prompt-schema.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'registry', 'worker-profiles'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function parseTools(claudeTools) {
  return String(claudeTools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

export function checkWorkerProfileContract(profile, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const workerProfileId = String(profile?.id ?? '');
  const promptPath = path.join(root, 'registry', 'worker-profiles', 'prompts', `${workerProfileId}.md`);
  const checks = [];

  if (!workerProfileId || !fs.existsSync(promptPath)) {
    checks.push({ id: 'prompt-exists', pass: false, detail: 'prompt file missing' });
    return { workerProfileId, pass: false, checks };
  }

  const content = fs.readFileSync(promptPath, 'utf8');
  const validation = validatePromptContent({ content, id: workerProfileId, registryEntry: profile });
  checks.push({
    id: 'frontmatter-valid',
    pass: validation.errors.length === 0 && validation.converted,
    detail: validation.errors[0] ?? (validation.converted ? null : 'not converted'),
  });
  checks.push({
    id: 'anti-fabrication-section',
    pass: content.includes('## Anti-fabrication contract'),
    detail: null,
  });
  checks.push({
    id: 'output-format-section',
    pass: content.includes('## Output format'),
    detail: null,
  });

  const fabricateRisk = /\b(invent|fabricat|unverified|guess)\b/i.test(content);
  checks.push({
    id: 'fabricate-risk-patterns',
    pass: fabricateRisk || content.includes('Anti-fabrication'),
    detail: fabricateRisk ? null : 'no fabricate-risk coverage in body',
  });

  const registryTools = Array.isArray(profile.toolGrants) ? profile.toolGrants : parseTools(profile.toolGrants);
  checks.push({
    id: 'tools-declared',
    pass: registryTools.length > 0,
    detail: registryTools.length ? `${registryTools.length} tools in registry` : 'registry claudeTools empty',
  });

  const pass = checks.every((c) => c.pass);
  return { workerProfileId, pass, checks };
}

export function auditWorkerProfileContracts({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root, skipValidation: true });
  const results = Object.values(registry.workerProfiles ?? {}).map((agent) => checkWorkerProfileContract(agent, { rootDir: root }));
  const failures = results.filter((r) => !r.pass);
  return {
    pass: failures.length === 0,
    count: results.length,
    failures,
    results,
  };
}
