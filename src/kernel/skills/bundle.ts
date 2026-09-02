/**
 * kernel/skills/bundle.ts — the skills this package ships, and planting one
 * into a host's skills directory byte for byte.
 *
 * A skill folder is SKILL.md plus optional references/, scripts/, assets/,
 * schemas/, and evals/. Planting copies exactly those bytes; verifying
 * compares them. The registry (which resolves versions and digests) builds on
 * this; nothing here interprets a skill's content.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_FILENAME = 'SKILL.md';
export const OPERATIONAL_SKILL = 'construct';
export const SKILL_BUNDLE_DIRS = ['references', 'scripts', 'assets', 'schemas', 'evals'] as const;

/** `skills/` beside the package root, whether running from src/ or dist/. */
export function shippedSkillsDir(): string {
  return fileURLToPath(new URL('../../../skills/', import.meta.url));
}

export interface SkillFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface ShippedSkill {
  readonly name: string;
  readonly dir: string;
  readonly description: string;
  readonly version: string | null;
  readonly files: readonly SkillFile[];
}

const decoder = new TextDecoder();

function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  const lines = m[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    let value = kv[2]!.trim();
    // A folded or literal block, or a plain scalar that wraps onto indented
    // lines, is one value; the host's YAML reader sees all of it, so must we.
    const block = value === '>-' || value === '>' || value === '|';
    const buf: string[] = block ? [] : [value];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) {
      buf.push(lines[i + 1]!.trim());
      i += 1;
    }
    value = buf.join(' ');
    out[kv[1]!] = value.replace(/^["']|["']$/g, '');
  }
  const meta = /^metadata:\s*\n((?:[ \t]+.*\n?)+)/m.exec(m[1]!);
  if (meta) {
    const v = /^\s+version:\s*(\S+)/m.exec(meta[1]!);
    if (v) out['metadata.version'] = v[1]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

function walk(root: string, dir: string, out: SkillFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(root, path, out);
    else if (entry.isFile()) out.push({ relativePath: relative(root, path).split(sep).join('/'), bytes: readFileSync(path) });
  }
}

export function readShippedSkill(name: string, skillsDir: string = shippedSkillsDir()): ShippedSkill | null {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return null;
  const dir = join(skillsDir, name);
  const skillPath = join(dir, SKILL_FILENAME);
  try {
    if (!lstatSync(skillPath).isFile()) return null;
  } catch {
    return null;
  }
  const files: SkillFile[] = [{ relativePath: SKILL_FILENAME, bytes: readFileSync(skillPath) }];
  for (const sub of SKILL_BUNDLE_DIRS) {
    const subDir = join(dir, sub);
    if (existsSync(subDir) && lstatSync(subDir).isDirectory()) walk(dir, subDir, files);
  }
  files.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  const fm = frontmatter(decoder.decode(files[0]!.bytes));
  return { name, dir, description: fm.description ?? '', version: fm['metadata.version'] ?? null, files };
}

export function listShippedSkills(skillsDir: string = shippedSkillsDir()): ShippedSkill[] {
  let names: string[];
  try {
    names = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return names.map((n) => readShippedSkill(n, skillsDir)).filter((s): s is ShippedSkill => s !== null);
}

export type PlantState = 'current' | 'diverged' | 'absent';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** How the installed copy compares with the shipped one. */
export function skillState(skill: ShippedSkill, installDir: string): { readonly state: PlantState; readonly why: string } {
  const target = join(installDir, skill.name);
  if (!existsSync(join(target, SKILL_FILENAME))) return { state: 'absent', why: `${target} has no ${SKILL_FILENAME}` };
  for (const file of skill.files) {
    const path = join(target, file.relativePath);
    if (!existsSync(path)) return { state: 'diverged', why: `${file.relativePath} is missing from the installed copy` };
    if (!sameBytes(readFileSync(path), file.bytes)) return { state: 'diverged', why: `${file.relativePath} differs from the shipped copy` };
  }
  return { state: 'current', why: 'every shipped file is present and byte-identical' };
}

export interface PlantResult {
  readonly outcome: 'planted' | 'kept' | 'refused';
  readonly path: string;
  readonly why: string;
}

/**
 * Plant a skill. A current copy is kept; a diverged copy is refused unless
 * forced, because it may carry someone's edits; a link at the target is
 * always refused.
 */
export function plantSkill(skill: ShippedSkill, installDir: string, options: { readonly force?: boolean } = {}): PlantResult {
  const target = join(installDir, skill.name);
  try {
    if (lstatSync(target).isSymbolicLink()) return { outcome: 'refused', path: target, why: 'the target is a symbolic link' };
  } catch {
    // absent: fine
  }
  const current = skillState(skill, installDir);
  if (current.state === 'current') return { outcome: 'kept', path: target, why: 'already current' };
  if (current.state === 'diverged' && !options.force) {
    return { outcome: 'refused', path: target, why: `${current.why}; pass --force to overwrite it` };
  }
  for (const file of skill.files) {
    const path = join(target, file.relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
  }
  return { outcome: 'planted', path: target, why: current.state === 'absent' ? 'installed' : 'overwritten' };
}

export function removeSkill(name: string, installDir: string): { readonly removed: boolean; readonly why: string } {
  const target = join(installDir, name);
  if (!existsSync(join(target, SKILL_FILENAME))) return { removed: false, why: `${target} holds no skill` };
  rmSync(target, { recursive: true, force: true });
  return { removed: true, why: `removed ${target}` };
}
