/**
 * kernel/project/constitution.ts — the committed, human-reviewable statement of
 * what the project is, what it is for, and what must not be violated.
 *
 * The file holds what a person has accepted. Inferred material lives in state
 * as proposed statements until it is confirmed; nothing here promotes it.
 */

import { PROJECT_SCALES, type ProjectScale } from '../state/profile.ts';
import {
  ProjectFileError,
  expectFormat,
  expectRecord,
  isRecord,
  optionalString,
  refuseForbiddenKeys,
  stringList,
} from './files.ts';

export const CONSTITUTION_FORMAT = 'construct-constitution';
export const CONSTITUTION_VERSION = 2;

export interface CanonicalArtifact {
  readonly path: string;
  readonly role: string;
}

export interface Owner {
  readonly name: string;
  readonly decides: readonly string[];
}

export interface GlossaryEntry {
  readonly term: string;
  readonly meaning: string;
}

export interface Constitution {
  readonly format: typeof CONSTITUTION_FORMAT;
  readonly formatVersion: typeof CONSTITUTION_VERSION;
  readonly name: string | null;
  readonly purpose: string | null;
  readonly scale: ProjectScale | null;
  readonly lifecycleStage: string | null;
  readonly primaryOutcome: string | null;
  readonly successMeasures: readonly string[];
  readonly principles: readonly string[];
  readonly constraints: readonly string[];
  readonly nonGoals: readonly string[];
  readonly canonicalArtifacts: readonly CanonicalArtifact[];
  readonly owners: readonly Owner[];
  readonly boundaries: readonly string[];
  readonly riskPosture: string | null;
  readonly reviewCadence: string | null;
  readonly glossary: readonly GlossaryEntry[];
  readonly unknowns: readonly string[];
}

export function emptyConstitution(name: string | null = null): Constitution {
  return {
    format: CONSTITUTION_FORMAT,
    formatVersion: CONSTITUTION_VERSION,
    name,
    purpose: null,
    scale: null,
    lifecycleStage: null,
    primaryOutcome: null,
    successMeasures: [],
    principles: [],
    constraints: [],
    nonGoals: [],
    canonicalArtifacts: [],
    owners: [],
    boundaries: [],
    riskPosture: null,
    reviewCadence: null,
    glossary: [],
    unknowns: [],
  };
}

const CONSTITUTION_KEYS = new Set<string>([
  'format', 'formatVersion', 'name', 'purpose', 'scale', 'lifecycleStage', 'primaryOutcome',
  'successMeasures', 'principles', 'constraints', 'nonGoals', 'canonicalArtifacts', 'owners',
  'boundaries', 'riskPosture', 'reviewCadence', 'glossary', 'unknowns',
]);

export function validateConstitution(raw: unknown, path: string): Constitution {
  const record = expectRecord(raw, path);
  expectFormat(record, path, CONSTITUTION_FORMAT, CONSTITUTION_VERSION);
  refuseForbiddenKeys(record, path);
  for (const key of Object.keys(record)) {
    if (!CONSTITUTION_KEYS.has(key)) throw new ProjectFileError(path, `unknown key "${key}"`);
  }
  const scale = optionalString(record, 'scale', path);
  if (scale !== null && !(PROJECT_SCALES as readonly string[]).includes(scale)) {
    throw new ProjectFileError(path, `"scale" must be one of ${PROJECT_SCALES.join(' | ')}`);
  }
  const canonicalArtifacts = listOf(record, 'canonicalArtifacts', path, (item, where) => ({
    path: requireField(item, 'path', where),
    role: requireField(item, 'role', where),
  }));
  const owners = listOf(record, 'owners', path, (item, where) => ({
    name: requireField(item, 'name', where),
    decides: stringList(item, 'decides', where),
  }));
  const glossary = listOf(record, 'glossary', path, (item, where) => ({
    term: requireField(item, 'term', where),
    meaning: requireField(item, 'meaning', where),
  }));
  const terms = glossary.map((g) => g.term.toLowerCase());
  const dup = terms.find((t, i) => terms.indexOf(t) !== i);
  if (dup) throw new ProjectFileError(path, `glossary term "${dup}" appears twice`);
  return {
    format: CONSTITUTION_FORMAT,
    formatVersion: CONSTITUTION_VERSION,
    name: optionalString(record, 'name', path),
    purpose: optionalString(record, 'purpose', path),
    scale: scale as ProjectScale | null,
    lifecycleStage: optionalString(record, 'lifecycleStage', path),
    primaryOutcome: optionalString(record, 'primaryOutcome', path),
    successMeasures: stringList(record, 'successMeasures', path),
    principles: stringList(record, 'principles', path),
    constraints: stringList(record, 'constraints', path),
    nonGoals: stringList(record, 'nonGoals', path),
    canonicalArtifacts,
    owners,
    boundaries: stringList(record, 'boundaries', path),
    riskPosture: optionalString(record, 'riskPosture', path),
    reviewCadence: optionalString(record, 'reviewCadence', path),
    glossary,
    unknowns: stringList(record, 'unknowns', path),
  };
}

function listOf<T>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  each: (item: Record<string, unknown>, where: string) => T,
): T[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ProjectFileError(path, `"${key}" must be a list`);
  return value.map((item, i) => {
    const where = `${path} "${key}[${String(i)}]"`;
    if (!isRecord(item)) throw new ProjectFileError(where, 'must be an object');
    return each(item, where);
  });
}

function requireField(item: Record<string, unknown>, key: string, where: string): string {
  const value = item[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectFileError(where, `"${key}" must be a non-empty string`);
  }
  return value;
}

/** The fields a constitution needs before onboarding counts as complete. */
export const CONSTITUTION_REQUIRED = ['name', 'purpose', 'scale', 'primaryOutcome'] as const;

export function constitutionCompleteness(c: Constitution): {
  readonly complete: boolean;
  readonly missing: readonly string[];
} {
  const missing = CONSTITUTION_REQUIRED.filter((field) => c[field] === null);
  return { complete: missing.length === 0, missing };
}
