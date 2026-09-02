/**
 * kernel/registry/skill-registry.ts — every skill this project can resolve:
 * the ones the package ships and the ones the project authors under
 * .construct/skills. Metadata is cheap and loaded once per digest; a body
 * loads only when a step selects the skill.
 */

import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { listShippedSkills, readShippedSkill, type ShippedSkill } from '../skills/bundle.ts';
import { bundleDigest } from './digest.ts';
import { SKILL_MANIFEST_FILE, type BundleOrigin, type RegisteredSkill } from './models.ts';
import { checkFrontmatterAgreement, validateSkillManifest, ManifestError } from './validation.ts';

export interface SkillRegistry {
  list(): readonly RegisteredSkill[];
  get(id: string): RegisteredSkill | null;
  /** The SKILL.md body, loaded on demand. */
  body(id: string): string | null;
  /** A reference, script, asset, schema, or eval file by relative path, loaded on demand. */
  file(id: string, relativePath: string): Uint8Array | null;
  /** Skills present on disk that carry no Construct manifest: portable only, never resolvable for a workflow. */
  portableOnly(): readonly { readonly name: string; readonly origin: BundleOrigin; readonly dir: string }[];
  /** Problems found while loading, by directory. Loading never throws for one bad skill. */
  problems(): readonly { readonly dir: string; readonly message: string }[];
}

export interface SkillRegistryInput {
  readonly builtinDir?: string;
  readonly projectDir?: string | null;
}

const cache = new Map<string, RegisteredSkill>();

function frontmatterVersion(skill: ShippedSkill): { name: string; version: string | null; description: string } {
  return { name: skill.name, version: skill.version, description: skill.description };
}

function register(skill: ShippedSkill, origin: BundleOrigin): RegisteredSkill | { readonly problem: string } | null {
  const manifestPath = join(skill.dir, SKILL_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const digest = bundleDigest([...skill.files, { relativePath: SKILL_MANIFEST_FILE, bytes: readFileSync(manifestPath) }]);
  const cached = cache.get(digest);
  if (cached && cached.dir === skill.dir) return cached;
  try {
    const manifest = validateSkillManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown, manifestPath);
    checkFrontmatterAgreement(frontmatterVersion(skill), manifest, manifestPath);
    if (manifest.id !== skill.name) throw new ManifestError(manifestPath, `manifest id "${manifest.id}" does not match the directory "${skill.name}"`);
    const entry: RegisteredSkill = {
      manifest,
      origin,
      dir: skill.dir,
      digest,
      description: skill.description,
      files: [...skill.files.map((f) => f.relativePath), SKILL_MANIFEST_FILE].sort(),
    };
    cache.set(digest, entry);
    return entry;
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

function listDir(dir: string): ShippedSkill[] {
  if (!existsSync(dir)) return [];
  try {
    if (!lstatSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .map((e) => readShippedSkill(e.name, dir))
    .filter((s): s is ShippedSkill => s !== null);
}

export function createSkillRegistry(input: SkillRegistryInput = {}): SkillRegistry {
  const skills = new Map<string, RegisteredSkill>();
  const portable: { name: string; origin: BundleOrigin; dir: string }[] = [];
  const problems: { dir: string; message: string }[] = [];
  const sets: Array<[BundleOrigin, ShippedSkill[]]> = [
    ['builtin', input.builtinDir === undefined ? listShippedSkills() : listShippedSkills(input.builtinDir)],
    ['project', input.projectDir ? listDir(input.projectDir) : []],
  ];
  for (const [origin, list] of sets) {
    for (const skill of list) {
      const result = register(skill, origin);
      if (result === null) {
        portable.push({ name: skill.name, origin, dir: skill.dir });
        continue;
      }
      if ('problem' in result) {
        problems.push({ dir: skill.dir, message: result.problem });
        continue;
      }
      if (skills.has(result.manifest.id) && origin === 'project') {
        problems.push({ dir: skill.dir, message: `project skill "${result.manifest.id}" shadows a built-in skill; rename it or remove one` });
        continue;
      }
      skills.set(result.manifest.id, result);
    }
  }
  return {
    list: () => [...skills.values()].sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1)),
    get: (id) => skills.get(id) ?? null,
    body: (id) => {
      const s = skills.get(id);
      if (!s) return null;
      return readFileSync(join(s.dir, 'SKILL.md'), 'utf8');
    },
    file: (id, relativePath) => {
      const s = skills.get(id);
      if (!s || !s.files.includes(relativePath)) return null;
      return readFileSync(join(s.dir, relativePath));
    },
    portableOnly: () => portable,
    problems: () => problems,
  };
}
