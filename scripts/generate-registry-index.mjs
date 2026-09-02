#!/usr/bin/env node
/**
 * generate-registry-index.mjs — the shipped registry index, produced from the
 * skill and workflow bundles in this checkout.
 *
 * `registry/index.json` lists every built-in skill and workflow with its
 * version and content digest, and is what a packaged install compares a
 * project's lock against without walking the bundles. `--check` regenerates
 * in memory and fails when the committed file differs: a bundle whose content
 * changed without a version bump, or a version bump nobody regenerated for,
 * both fail here and nowhere earlier.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSkillRegistry } from '../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../src/kernel/registry/workflow-registry.ts';

const OUT = fileURLToPath(new URL('../registry/index.json', import.meta.url));
const check = process.argv.includes('--check');

const skills = createSkillRegistry({ projectDir: null });
const workflows = createWorkflowRegistry({ projectDir: null });
const problems = [...skills.problems(), ...workflows.problems()];
if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`registry: ${p.dir}: ${p.message}\n`);
  process.exit(1);
}
const portable = skills.portableOnly();
if (portable.length > 0) {
  for (const p of portable) process.stderr.write(`registry: ${p.dir}: shipped without construct.skill.json; every shipped skill carries a manifest\n`);
  process.exit(1);
}

const index = {
  format: 'construct-registry-index',
  formatVersion: 1,
  skills: Object.fromEntries(skills.list().map((s) => [s.manifest.id, { version: s.manifest.version, digest: s.digest, category: s.manifest.category, title: s.manifest.title }])),
  workflows: Object.fromEntries(workflows.list().map((w) => [w.manifest.id, { version: w.manifest.version, digest: w.digest, title: w.manifest.title, interactionClass: w.manifest.interactionClass }])),
};
const text = `${JSON.stringify(index, null, 2)}\n`;

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    let detail = 'registry/index.json is absent';
    if (current) {
      try {
        const prev = JSON.parse(current);
        const diffs = [];
        for (const kind of ['skills', 'workflows']) {
          const ids = new Set([...Object.keys(prev[kind] ?? {}), ...Object.keys(index[kind])]);
          for (const id of ids) {
            const a = prev[kind]?.[id];
            const b = index[kind][id];
            if (!a) diffs.push(`${kind}/${id}: new`);
            else if (!b) diffs.push(`${kind}/${id}: removed`);
            else if (a.version === b.version && a.digest !== b.digest) diffs.push(`${kind}/${id}: content changed at version ${b.version} without a version bump`);
            else if (a.version !== b.version) diffs.push(`${kind}/${id}: ${a.version} -> ${b.version}`);
          }
        }
        detail = diffs.join('; ') || 'index text differs';
      } catch {
        detail = 'registry/index.json is not valid JSON';
      }
    }
    process.stderr.write(`generate-registry-index: stale — ${detail}\n  bump the version where content changed, then run: node scripts/generate-registry-index.mjs\n`);
    process.exit(1);
  }
  process.stdout.write(`generate-registry-index: current — ${Object.keys(index.skills).length} skill(s), ${Object.keys(index.workflows).length} workflow(s)\n`);
} else {
  writeFileSync(OUT, text, 'utf8');
  process.stdout.write(`generate-registry-index: wrote registry/index.json (${Object.keys(index.skills).length} skill(s), ${Object.keys(index.workflows).length} workflow(s))\n`);
}
