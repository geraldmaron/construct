/**
 * kernel/project/files.ts — reading and writing the committed project files safely.
 *
 * A checked-out `.construct/` is whatever the repository's author wrote, so a
 * file is read under guards: no symbolic link anywhere between the project
 * root and the file, the bytes opened with O_NOFOLLOW and read exactly once,
 * a size cap, and then a validator that owns the schema. Writes go through a
 * temporary file and a rename so a crash never leaves half a file.
 */

import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const MAX_PROJECT_FILE_BYTES = 1_048_576;

export class ProjectFileError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'ProjectFileError';
    this.path = path;
  }
}

export const UNSUPPORTED_PROJECT_FILE_MESSAGE =
  'This project file was written by a Construct format this version does not read.\n' +
  'Run `construct reset` to see exactly which files would be replaced, then confirm.';

export class UnsupportedProjectFileError extends Error {
  readonly path: string;
  readonly foundFormat: string | null;
  readonly foundVersion: number | null;

  constructor(path: string, foundFormat: string | null, foundVersion: number | null) {
    super(`${path}: ${UNSUPPORTED_PROJECT_FILE_MESSAGE}`);
    this.name = 'UnsupportedProjectFileError';
    this.path = path;
    this.foundFormat = foundFormat;
    this.foundVersion = foundVersion;
  }
}

/** The first symbolic link on the way from `root` to `file`, or null. */
export function symlinkBetween(root: string, file: string): string | null {
  const rel = relative(root, file);
  if (rel.startsWith('..') || rel === '') return null;
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return null;
}

/**
 * Read a project file's bytes once, or null when it does not exist. Refuses a
 * link anywhere on the path and a file over the size cap.
 */
export function readProjectFileBytes(root: string, file: string): Buffer | null {
  const link = symlinkBetween(root, file);
  if (link !== null) throw new ProjectFileError(file, `${link} is a symbolic link`);
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new ProjectFileError(file, 'is a symbolic link');
    throw error;
  }
  try {
    const bytes = readFileSync(fd);
    if (bytes.byteLength > MAX_PROJECT_FILE_BYTES) {
      throw new ProjectFileError(file, `is larger than ${String(MAX_PROJECT_FILE_BYTES)} bytes`);
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export type Validator<T> = (raw: unknown, path: string) => T;

/** Read and validate a JSON project file; null when absent. */
export function readJsonFile<T>(root: string, file: string, validate: Validator<T>): T | null {
  const bytes = readProjectFileBytes(root, file);
  if (bytes === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new ProjectFileError(file, `is not valid JSON (${(error as Error).message})`);
  }
  return validate(raw, file);
}

/** Write JSON atomically: temp file beside the target, then rename over it. */
export function writeJsonFile(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  renameSync(tmp, file);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function expectRecord(raw: unknown, path: string, what = 'the file'): Record<string, unknown> {
  if (!isRecord(raw)) throw new ProjectFileError(path, `${what} must be a JSON object`);
  return raw;
}

/**
 * Check a file's format stamp. A different id or version is refused as
 * unsupported (never migrated); a missing stamp is a malformed file.
 */
export function expectFormat(
  record: Record<string, unknown>,
  path: string,
  formatId: string,
  formatVersion: number,
): void {
  const format = typeof record.format === 'string' ? record.format : null;
  const version = typeof record.formatVersion === 'number' ? record.formatVersion : null;
  if (format === null && version === null) {
    throw new ProjectFileError(path, `carries no format stamp; expected ${formatId} ${String(formatVersion)}`);
  }
  if (format !== formatId || version !== formatVersion) {
    throw new UnsupportedProjectFileError(path, format, version);
  }
}

export function expectString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectFileError(path, `"${key}" must be a non-empty string`);
  }
  return value;
}

export function optionalString(record: Record<string, unknown>, key: string, path: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ProjectFileError(path, `"${key}" must be a string when present`);
  return value;
}

export function stringList(record: Record<string, unknown>, key: string, path: string): string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ProjectFileError(path, `"${key}" must be a list of strings`);
  }
  return value as string[];
}

/** Keys that never belong in a committed file, whatever their value. */
export const FORBIDDEN_FILE_KEY_WORDS = [
  'consent',
  'grant',
  'secret',
  'token',
  'apikey',
  'api_key',
  'password',
  'credential',
  'executable',
  'binary',
  'command',
  'externalwrite',
  'external_write',
] as const;

/**
 * Refuse any key, at any depth, whose name says it carries consent, a secret,
 * an executable, or an external-write switch. A committed file can describe a
 * project; it cannot authorize anything.
 */
export function refuseForbiddenKeys(value: unknown, path: string, trail = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => refuseForbiddenKeys(item, path, `${trail}[${String(i)}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, inner] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    const hit = FORBIDDEN_FILE_KEY_WORDS.find((word) => lowered.includes(word));
    if (hit) {
      throw new ProjectFileError(
        path,
        `"${trail ? `${trail}.` : ''}${key}" is not allowed in a committed file: a project file cannot grant consent, carry secrets, name an executable, or enable external writes`,
      );
    }
    refuseForbiddenKeys(inner, path, trail ? `${trail}.${key}` : key);
  }
}
