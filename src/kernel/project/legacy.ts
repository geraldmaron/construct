/**
 * kernel/project/legacy.ts — recognize files an earlier Construct wrote.
 *
 * Recognition only: a known path, or a format stamp that is not the current
 * one. Nothing here parses an old schema or reads old contents, and nothing
 * here deletes; `reset` names these exact targets and asks first.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from '../paths.ts';
import { PROJECT_CONFIG_FORMAT, PROJECT_CONFIG_VERSION } from './config.ts';
import { projectDir, projectFilePath } from './layout.ts';

export interface LegacyTarget {
  readonly path: string;
  readonly what: string;
}

const LEGACY_PROJECT_FILE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['settings.json', 'a project settings file from an earlier alpha'],
];

/** Old Construct-owned files under this project's `.construct/`. */
export function detectLegacyProjectFiles(root: string): LegacyTarget[] {
  const found: LegacyTarget[] = [];
  const dir = projectDir(root);
  for (const [name, what] of LEGACY_PROJECT_FILE_NAMES) {
    const path = join(dir, name);
    if (existsSync(path)) found.push({ path, what });
  }
  const projectFile = projectFilePath(root);
  const stamp = readFormatStamp(projectFile);
  if (stamp !== null && (stamp.format !== PROJECT_CONFIG_FORMAT || stamp.version !== PROJECT_CONFIG_VERSION)) {
    found.push({
      path: projectFile,
      what: `a project config in format ${stamp.format ?? 'unknown'} ${stamp.version === null ? '' : String(stamp.version)}`.trim(),
    });
  }
  return found;
}

/**
 * Old per-user Construct databases. These are named so a person can remove
 * them; this version never opens them.
 */
export function detectLegacyHomeState(paths: Paths): LegacyTarget[] {
  const found: LegacyTarget[] = [];
  for (const candidate of [join(paths.dataDir, 'construct.db'), join(paths.stateDir, 'construct.db')]) {
    if (existsSync(candidate)) found.push({ path: candidate, what: 'a per-user Construct database from an earlier alpha' });
  }
  return found;
}

function readFormatStamp(path: string): { format: string | null; version: number | null } | null {
  try {
    if (!lstatSync(path).isFile()) return null;
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { format: null, version: null };
    const record = raw as Record<string, unknown>;
    return {
      format: typeof record.format === 'string' ? record.format : null,
      version: typeof record.formatVersion === 'number' ? record.formatVersion : null,
    };
  } catch {
    return { format: null, version: null };
  }
}
