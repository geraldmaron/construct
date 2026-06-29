/**
 * lib/certification/specialist-contracts.mjs — deterministic specialist contract checks.
 *
 * Per-specialist gates for certification preflight and construct audit specialists:
 * frontmatter keys, tool allowlist vs registry, anti-fabrication section, perspective fields.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { validatePromptContent } from '../specialists/prompt-schema.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'org'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function parseTools(claudeTools) {
  return String(claudeTools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

export function checkSpecialistContract(agent, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const specialistId = `cx-${agent.name}`;
  const promptPath = path.join(root, agent.promptFile ?? '');
  const checks = [];

  if (!agent.promptFile || !fs.existsSync(promptPath)) {
    checks.push({ id: 'prompt-exists', pass: false, detail: 'prompt file missing' });
    return { specialistId, pass: false, checks };
  }

  const content = fs.readFileSync(promptPath, 'utf8');
  const validation = validatePromptContent({ content, id: specialistId, registryEntry: agent });
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

  const registryTools = parseTools(agent.claudeTools);
  checks.push({
    id: 'tools-declared',
    pass: registryTools.length > 0,
    detail: registryTools.length ? `${registryTools.length} tools in registry` : 'registry claudeTools empty',
  });

  const pass = checks.every((c) => c.pass);
  return { specialistId, pass, checks };
}

export function auditSpecialistContracts({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root });
  const results = Object.values(registry.specialists ?? {}).map((agent) => checkSpecialistContract(agent, { rootDir: root }));
  const failures = results.filter((r) => !r.pass);
  return {
    pass: failures.length === 0,
    count: results.length,
    failures,
    results,
  };
}
