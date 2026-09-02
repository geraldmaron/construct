/**
 * kernel/registry/digest.ts — a deterministic digest over a bundle's files.
 *
 * Files are taken in sorted relative-path order; each contributes its path,
 * its byte length, and its bytes. Two bundles with the same files in any
 * traversal order digest the same; a changed byte, a renamed file, or an
 * added file changes the digest.
 */

import { createHash } from 'node:crypto';

export interface DigestFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export function bundleDigest(files: readonly DigestFile[]): string {
  const sorted = [...files].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  const hash = createHash('sha256');
  for (const f of sorted) {
    hash.update(f.relativePath);
    hash.update('\0');
    hash.update(String(f.bytes.byteLength));
    hash.update('\0');
    hash.update(f.bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
