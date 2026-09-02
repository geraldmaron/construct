/**
 * tests/kernel/registry/support.ts — fixture skill and workflow directories.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tmp(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-registry-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function skillManifest(id: string, version: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'construct-skill', formatVersion: 1, id, title: id, version, category: 'method', owner: 'test',
    activation: ['when asked'], standDown: ['otherwise'], interactionClasses: ['manage'],
    capabilities: ['read_project_context'], actionTiers: ['observe', 'draft'], ...extra,
  };
}

export function writeSkill(root: string, id: string, version: string, opts: { manifest?: Record<string, unknown> | null; body?: string; frontmatterVersion?: string; references?: Record<string, string> } = {}): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const fmVersion = opts.frontmatterVersion ?? version;
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: ${id} does a thing\nlicense: Apache-2.0\nmetadata:\n  version: ${fmVersion}\n---\n\n# ${id}\n\n${opts.body ?? 'Body.'}\n`, 'utf8');
  if (opts.manifest !== null) writeFileSync(join(dir, 'construct.skill.json'), JSON.stringify(opts.manifest ?? skillManifest(id, version), null, 2), 'utf8');
  for (const [name, text] of Object.entries(opts.references ?? {})) {
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(join(dir, 'references', name), text, 'utf8');
  }
  return dir;
}

export function workflowManifest(id: string, version: string, steps: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'construct-workflow', formatVersion: 1, id, title: id, version, purpose: 'test',
    activation: ['when asked'], standDown: ['otherwise'], interactionClass: 'manage',
    inputSchema: { target: 'string' }, requiredInputs: ['target'], steps,
    triggers: ['manual'], deliverable: { kind: 'review', schema: 'review/v1' }, ...extra,
  };
}

export function step(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, title: id, needs: [], skill: null, capabilities: ['read_project_context'], tier: 'observe', inputs: {}, outputs: ['out'], validators: [], ...extra };
}

export function writeWorkflow(root: string, id: string, manifest: Record<string, unknown>): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'workflow.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return dir;
}
