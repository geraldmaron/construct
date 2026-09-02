/**
 * kernel/project-v1/context.ts — resolved project identity for the kernel.
 *
 * Host-specific env vars and discovery stay at HostIntegrationAdapter
 * boundaries. The kernel receives a ProjectContext, never CLAUDE_PROJECT_DIR
 * or similar sprinkled through application code.
 *
 * Resolution order (caller supplies what it already knows):
 *   1. host-provided project root
 *   2. explicit Construct project binding
 *   3. git / workspace root
 *   4. cwd only when semantically correct for the call
 */

import { realpathSync } from 'node:fs';
import { resolve, normalize, isAbsolute } from 'node:path';

export interface ProjectContext {
  /** Absolute, normalized project root. */
  readonly root: string;
  /** How the root was chosen, for doctor and provenance. */
  readonly rootSource:
    | 'host'
    | 'binding'
    | 'git'
    | 'cwd'
    | 'explicit';
}

export interface ResolveProjectContextInput {
  readonly hostProjectRoot?: string;
  readonly bindingRoot?: string;
  readonly gitRoot?: string;
  readonly cwd?: string;
  /** When true, allow cwd as last resort. Default false. */
  readonly allowCwdFallback?: boolean;
}

/**
 * Reject path traversal and non-absolute sneak paths. Symlinks are resolved
 * when the path exists so two views of one project share identity.
 */
export function normalizeProjectRoot(candidate: string): string {
  const absolute = isAbsolute(candidate) ? candidate : resolve(candidate);
  const normalized = normalize(absolute);
  try {
    return realpathSync(normalized);
  } catch {
    // Path may not exist yet during init; still return normalized absolute.
    return normalized;
  }
}

/**
 * Pick a project root by precedence. Throws when nothing resolvable is given.
 */
export function resolveProjectContext(input: ResolveProjectContextInput): ProjectContext {
  if (input.hostProjectRoot !== undefined && input.hostProjectRoot.trim() !== '') {
    return { root: normalizeProjectRoot(input.hostProjectRoot), rootSource: 'host' };
  }
  if (input.bindingRoot !== undefined && input.bindingRoot.trim() !== '') {
    return { root: normalizeProjectRoot(input.bindingRoot), rootSource: 'binding' };
  }
  if (input.gitRoot !== undefined && input.gitRoot.trim() !== '') {
    return { root: normalizeProjectRoot(input.gitRoot), rootSource: 'git' };
  }
  if (input.allowCwdFallback && input.cwd !== undefined && input.cwd.trim() !== '') {
    return { root: normalizeProjectRoot(input.cwd), rootSource: 'cwd' };
  }
  throw new Error(
    'no project root: provide a host project root, Construct binding, or git workspace root',
  );
}
