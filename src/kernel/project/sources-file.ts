/**
 * kernel/project/sources-file.ts — committed source declarations.
 *
 * What each source is for and what it is authoritative for, with no
 * credentials: a locator that carries a password, or any key that names a
 * secret, is refused before the file is accepted. Sensitive locators belong in
 * local state, not here.
 */

import { AUTHORITY_LEVELS, SENSITIVITIES, type AuthorityLevel, type Sensitivity } from '../state/sources.ts';
import {
  ProjectFileError,
  expectFormat,
  expectRecord,
  isRecord,
  optionalString,
  refuseForbiddenKeys,
  stringList,
} from './files.ts';

export const SOURCES_FORMAT = 'construct-sources';
export const SOURCES_VERSION = 2;

export interface DeclaredSource {
  readonly id: string;
  readonly kind: string;
  readonly purpose: string;
  readonly locator: string | null;
  readonly authorityLevel: AuthorityLevel;
  readonly authoritativeFor: readonly string[];
  readonly notAuthoritativeFor: readonly string[];
  readonly freshnessHours: number | null;
  readonly sensitivity: Sensitivity;
  readonly read: boolean;
  readonly write: boolean;
}

export interface SourcesFile {
  readonly format: typeof SOURCES_FORMAT;
  readonly formatVersion: typeof SOURCES_VERSION;
  readonly sources: readonly DeclaredSource[];
}

export function emptySourcesFile(): SourcesFile {
  return { format: SOURCES_FORMAT, formatVersion: SOURCES_VERSION, sources: [] };
}

const SOURCE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i;

export function validateSourcesFile(raw: unknown, path: string): SourcesFile {
  const record = expectRecord(raw, path);
  expectFormat(record, path, SOURCES_FORMAT, SOURCES_VERSION);
  refuseForbiddenKeys(record, path);
  const list = record.sources;
  if (list === undefined) return emptySourcesFile();
  if (!Array.isArray(list)) throw new ProjectFileError(path, '"sources" must be a list');
  const seen = new Set<string>();
  const sources = list.map((item, i) => {
    const where = `${path} "sources[${String(i)}]"`;
    if (!isRecord(item)) throw new ProjectFileError(where, 'must be an object');
    const id = str(item, 'id', where);
    if (!SOURCE_ID.test(id)) throw new ProjectFileError(where, '"id" must be lowercase letters, digits, and dashes');
    if (seen.has(id)) throw new ProjectFileError(where, `source id "${id}" appears twice`);
    seen.add(id);
    const locator = optionalString(item, 'locator', where);
    if (locator !== null && USERINFO.test(locator)) {
      throw new ProjectFileError(where, '"locator" carries credentials; keep credentials with the host or connector, never in a committed file');
    }
    const authorityLevel = str(item, 'authorityLevel', where);
    if (!(AUTHORITY_LEVELS as readonly string[]).includes(authorityLevel)) {
      throw new ProjectFileError(where, `"authorityLevel" must be one of ${AUTHORITY_LEVELS.join(' | ')}`);
    }
    const sensitivity = str(item, 'sensitivity', where);
    if (!(SENSITIVITIES as readonly string[]).includes(sensitivity)) {
      throw new ProjectFileError(where, `"sensitivity" must be one of ${SENSITIVITIES.join(' | ')}`);
    }
    const authoritativeFor = stringList(item, 'authoritativeFor', where);
    const notAuthoritativeFor = stringList(item, 'notAuthoritativeFor', where);
    const both = authoritativeFor.filter((t) => notAuthoritativeFor.includes(t));
    if (both.length) throw new ProjectFileError(where, `cannot be both authoritative and not for ${both.join(', ')}`);
    const freshness = item.freshnessHours ?? undefined;
    if (freshness !== undefined && (typeof freshness !== 'number' || !(freshness > 0))) {
      throw new ProjectFileError(where, '"freshnessHours" must be a positive number');
    }
    const caps = item.capabilities;
    if (caps !== undefined && !isRecord(caps)) throw new ProjectFileError(where, '"capabilities" must be an object');
    const read = caps?.read ?? true;
    const write = caps?.write ?? false;
    if (typeof read !== 'boolean' || typeof write !== 'boolean') {
      throw new ProjectFileError(where, '"capabilities.read" and "capabilities.write" must be true or false');
    }
    return {
      id,
      kind: str(item, 'kind', where),
      purpose: str(item, 'purpose', where),
      locator,
      authorityLevel: authorityLevel as AuthorityLevel,
      authoritativeFor,
      notAuthoritativeFor,
      freshnessHours: (freshness as number | undefined) ?? null,
      sensitivity: sensitivity as Sensitivity,
      read,
      write,
    };
  });
  return { format: SOURCES_FORMAT, formatVersion: SOURCES_VERSION, sources };
}

function str(item: Record<string, unknown>, key: string, where: string): string {
  const value = item[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectFileError(where, `"${key}" must be a non-empty string`);
  }
  return value;
}
