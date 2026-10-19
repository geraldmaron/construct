/**
 * kernel/project/unsupported-files.ts — recognize a project config in a
 * format this version does not read.
 *
 * Recognition only: a format stamp that is not the current one. Nothing here
 * parses another schema or deletes; `reset` names these exact targets and
 * asks first.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_CONFIG_FORMAT, PROJECT_CONFIG_VERSION } from './config.ts';
import { projectDir, projectFilePath } from './layout.ts';

export interface UnsupportedTarget {
  readonly path: string;
  readonly what: string;
}

/** Construct-owned files under this project's `.construct/` in a format this version does not read. */
export function detectUnsupportedProjectFiles(root: string): UnsupportedTarget[] {
  const found: UnsupportedTarget[] = [];
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
