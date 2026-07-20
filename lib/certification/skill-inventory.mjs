/**
 * lib/certification/skill-inventory.mjs — machine-readable skill corpus inventory.
 *
 * Walks skills/**, extracts id, owning Worker Profiles, activation triggers,
 * inputs, outputs, and verification hooks. Flags orphan skills and conflicting
 * output contracts. Output feeds tests/certification/skills/inventory.json.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { artifactTypes, loadArtifactManifest } from '../artifact-manifest.mjs';
import { validateSkillEffectiveness } from '../validators/skill-effectiveness.mjs';
import { bindingForWorkerProfile } from '../roles/flavor-bindings.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'registry', 'worker-profiles'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function collectSkillFiles(skillsDir) {
  const results = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        const rel = prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, '');
        results.push(rel);
      }
    }
  };
  try { walk(skillsDir); } catch { /* skills dir missing */ }
  return results.sort();
}

function collectWorkerProfileIds(root) {
  try {
    return new Set(Object.keys(loadRegistry({ rootDir: root }).workerProfiles));
  } catch {
    return new Set();
  }
}

function roleBase(skillId) {
  const m = skillId.match(/^roles\/([^.]+)(?:\..*)?$/);
  return m ? m[1] : null;
}

function perspectiveBase(skillId) {
  const match = skillId.match(/^perspectives\/([^.]+)(?:\..*)?$/);
  return match ? match[1] : null;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw.startsWith('[')) {
      try { meta[key] = JSON.parse(raw); } catch { meta[key] = raw; }
    } else {
      meta[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: content.slice(match[0].length) };
}

function activationTriggers(meta, body) {
  const triggers = [];
  if (meta.description) triggers.push(meta.description);
  const useWhen = body.match(/^Use when:\s*(.+)$/m)?.[1];
  if (useWhen) triggers.push(useWhen.trim());
  return [...new Set(triggers.filter(Boolean))];
}

function verificationHooks(meta, body) {
  const hooks = [];
  if (meta.verificationBar) hooks.push({ kind: 'verificationBar', value: meta.verificationBar });
  if (/construct artifact validate/i.test(body)) hooks.push({ kind: 'cli', value: 'construct artifact validate' });
  if (/construct certify/i.test(body)) hooks.push({ kind: 'cli', value: 'construct certify' });
  if (/get_template\(/i.test(body)) hooks.push({ kind: 'mcp', value: 'get_template' });
  return hooks;
}

function resolveOwners(skillId, { registry, declaredSkills, ownerBases }) {
  if (skillId.startsWith('brand/')) return ['operations'];
  const owners = new Set();
  for (const [id, profile] of Object.entries(registry.workerProfiles ?? {})) {
    if ((profile.skillEmphasis ?? []).includes(skillId)) owners.add(`worker-profile:${profile.id || id}`);
  }
  const base = roleBase(skillId) || perspectiveBase(skillId);
  if (base && ownerBases.has(base)) {
    for (const [id, profile] of Object.entries(registry.workerProfiles ?? {})) {
      if ((profile.id || id) === base) owners.add(`worker-profile:${profile.id || id}`);
    }
    if (!owners.size) owners.add(`worker-profile:${base}`);
  }

  // Flavor bindings resolve overlays whose base does not name a Worker Profile.

  if (base && owners.size === 0) {
    const binding = bindingForWorkerProfile(base);
    if (binding?.workerProfileId) owners.add(`worker-profile:${binding.workerProfileId}`);
  }
  if (declaredSkills.has(skillId) && owners.size === 0) {
    for (const [id, profile] of Object.entries(registry.workerProfiles ?? {})) {
      if ((profile.skillEmphasis ?? []).includes(skillId)) owners.add(`worker-profile:${profile.id || id}`);
    }
  }
  return [...owners].sort();
}

function workflowSkillIds(manifest) {
  const ids = new Set();
  for (const entry of Object.values(manifest.artifacts ?? {})) {
    if (entry.workflowSkill) ids.add(entry.workflowSkill);
  }
  return ids;
}

function detectConflictingOutputs(skills) {
  const manifestTypes = new Set(artifactTypes());
  const byType = new Map();
  for (const skill of skills) {
    const type = skill.outputs?.artifactType;
    if (!type || !manifestTypes.has(type)) continue;
    if (!skill.id.startsWith('docs/') && !skill.id.includes('-workflow')) continue;
    const list = byType.get(type) ?? [];
    list.push(skill);
    byType.set(type, list);
  }
  const conflicts = [];
  for (const [artifactType, entries] of byType) {
    if (entries.length < 2) continue;
    const bars = new Set(entries.map((e) => e.verificationHooks.find((h) => h.kind === 'verificationBar')?.value ?? ''));
    if (bars.size <= 1) continue;
    conflicts.push({
      artifactType,
      skillIds: entries.map((e) => e.id),
      reason: 'divergent verificationBar across workflow skills',
    });
  }
  return conflicts;
}

export function defaultSkillInventoryPath(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'certification', 'skills', 'inventory.json');
}

export function buildSkillInventory({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const skillsDir = path.join(root, 'skills');
  const registry = loadRegistry({ rootDir: root });
  const manifest = loadArtifactManifest({ rootDir: root });
  const declaredSkills = new Set();
  for (const profile of Object.values(registry.workerProfiles ?? {})) {
    for (const skill of profile.skillEmphasis ?? []) declaredSkills.add(skill);
  }
  const ownerBases = new Set([
    ...Object.entries(registry.workerProfiles ?? {}).map(([id, profile]) => String(profile.id || id).replace(/^cx-/, '')),
    ...collectWorkerProfileIds(root),
  ]);
  const workflowIds = workflowSkillIds(manifest);

  const skills = collectSkillFiles(skillsDir).map((id) => {
    const filePath = path.join(skillsDir, `${id}.md`);
    const content = fs.readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(content);
    const owners = resolveOwners(id, { registry, declaredSkills, ownerBases });
    const hooks = verificationHooks(meta, body);
    return {
      id,
      owners,
      activationTriggers: activationTriggers(meta, body),
      inputs: Array.isArray(meta.inputs) ? meta.inputs : (meta.inputs ? [meta.inputs] : []),
      outputs: {
        artifactType: meta.artifactType ?? null,
        name: meta.name ?? null,
      },
      verificationHooks: hooks,
      workflowSkill: workflowIds.has(id),
    };
  });

  const blockingFindings = [];
  for (const skill of skills) {
    if (skill.owners.length === 0) {
      blockingFindings.push({ kind: 'no-owner', skillId: skill.id, severity: 'blocking' });
    }
  }
  for (const conflict of detectConflictingOutputs(skills)) {
    blockingFindings.push({
      kind: 'conflicting-output-contract',
      severity: 'blocking',
      artifactType: conflict.artifactType,
      skillIds: conflict.skillIds,
      reason: conflict.reason,
    });
  }

  const effectiveness = validateSkillEffectiveness({ rootDir: root });
  const effectivenessFindings = effectiveness.errors.map((message) => ({
    kind: 'effectiveness',
    severity: 'blocking',
    message,
  }));
  blockingFindings.push(...effectivenessFindings);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: 'lib/certification/skill-inventory.mjs',
    skillCount: skills.length,
    skills,
    blockingFindings,
    effectivenessFindings,
    digest: null,
  };
  const canonical = { ...payload, digest: undefined };
  payload.digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return payload;
}

export function validateSkillInventory({ rootDir, inventory: supplied, checkFreshness = true } = {}) {
  const root = findConstructRoot(rootDir);
  const inventoryPath = defaultSkillInventoryPath(root);
  const inventory = supplied ?? JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const errors = [];
  const warnings = [];

  if (inventory.version !== 1) errors.push('inventory.version must equal 1');
  if (!Array.isArray(inventory.skills) || inventory.skills.length === 0) errors.push('inventory.skills must be non-empty');

  const onDisk = new Set(collectSkillFiles(path.join(root, 'skills')));
  const indexed = new Set((inventory.skills ?? []).map((s) => s.id));
  for (const id of onDisk) {
    if (!indexed.has(id)) errors.push(`missing inventory entry: ${id}`);
  }
  for (const skill of inventory.skills ?? []) {
    if (!onDisk.has(skill.id)) errors.push(`stale inventory entry: ${skill.id}`);
    if (!Array.isArray(skill.owners)) errors.push(`${skill.id}: owners must be an array`);
    if (!Array.isArray(skill.activationTriggers)) errors.push(`${skill.id}: activationTriggers must be an array`);
  }

  for (const finding of inventory.blockingFindings ?? []) {
    if (finding.severity === 'blocking') {
      errors.push(`blocking finding: ${finding.kind} ${finding.skillId ?? finding.message ?? finding.artifactType ?? ''}`.trim());
    }
  }

  if (checkFreshness) {
    const fresh = buildSkillInventory({ rootDir: root });
    const freshCanonical = { ...fresh, digest: undefined, generatedAt: undefined };
    const committedCanonical = { ...inventory, digest: undefined, generatedAt: undefined };
    if (JSON.stringify(freshCanonical) !== JSON.stringify(committedCanonical)) {
      errors.push('inventory is stale — regenerate with node scripts/generate-skill-inventory.mjs');
    }
  }

  return {
    filePath: inventoryPath,
    skillCount: inventory.skills?.length ?? 0,
    blockingCount: (inventory.blockingFindings ?? []).filter((f) => f.severity === 'blocking').length,
    errors,
    warnings,
    pass: errors.length === 0,
  };
}

export function writeSkillInventory({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const inventory = buildSkillInventory({ rootDir: root });
  const inventoryPath = defaultSkillInventoryPath(root);
  fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return { inventoryPath, inventory };
}

export function runSkillInventoryAuditCli(args = [], { rootDir } = {}) {
  if (args.includes('--write')) {
    const { inventoryPath, inventory } = writeSkillInventory({ rootDir });
    process.stdout.write(`Wrote ${inventoryPath} (${inventory.skillCount} skills, ${inventory.blockingFindings.length} blocking findings)\n`);
    return validateSkillInventory({ rootDir, inventory, checkFreshness: false });
  }
  const checkFreshness = !args.includes('--no-freshness');
  const result = validateSkillInventory({ rootDir, checkFreshness });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`Skill inventory: ${result.skillCount} skills (${result.blockingCount} blocking findings recorded)\n`);
    if (result.errors.length) result.errors.forEach((error) => process.stderr.write(`  ✗ ${error}\n`));
    if (result.warnings.length) result.warnings.forEach((warning) => process.stderr.write(`  ⚠ ${warning}\n`));
    process.stdout.write(result.pass ? '  Result: PASS\n' : '  Result: FAIL\n');
  }
  if (!result.pass) process.exitCode = 1;
  return result;
}
