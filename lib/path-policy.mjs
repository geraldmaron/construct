/**
 * lib/path-policy.mjs — root containment for model-supplied file paths.
 *
 * MCP file tools take paths from model arguments. resolveWithinRoot pins each path to a
 * declared root: it rejects backslash/UNC separators, out-of-root absolute or ../ targets,
 * and symlinks whose real target escapes the root. Containment is checked on the realpath
 * of the longest existing ancestor, so a not-yet-existing target is still anchored through
 * real directories. On any escape it throws PathContainmentError whose message names the
 * denial; otherwise it returns the canonical absolute path.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

export class PathContainmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathContainmentError';
  }
}

// A target may not exist yet (a delete of an already-gone file, a path with a missing
// tail). Resolve symlinks on the longest existing prefix, then re-append the remaining
// segments, so the escape check still sees through real ancestors.

function canonical(p) {
  const abs = path.resolve(p);
  let cur = abs;
  const tail = [];
  while (true) {
    try {
      const real = realpathSync(cur);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

export function resolveWithinRoot(root, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathContainmentError('path denied: empty or non-string file path');
  }
  if (candidate.includes('\\')) {
    throw new PathContainmentError('path denied: backslash/UNC separators escape the allowed root');
  }
  const base = canonical(root);
  const requested = path.isAbsolute(candidate) ? candidate : path.join(path.resolve(root), candidate);
  const resolved = canonical(requested);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new PathContainmentError(`path denied: ${candidate} resolves outside the allowed root`);
  }
  return resolved;
}
