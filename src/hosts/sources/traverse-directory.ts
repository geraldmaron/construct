/** Native local traversal stays inside one explicitly declared directory source. */
import { realpath, stat, readFile } from 'node:fs/promises';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { traverseReferences } from './traversal.ts';
import type { Source } from '../../kernel/state/sources.ts';
export async function traverseDirectory(input: { source: Source; from: string; sessionId: string; now: () => string; maxDocuments?: number }) {
  if (input.source.status !== 'active' || !input.source.canRead || input.source.kind !== 'directory' || !input.source.locator) throw new Error('native traversal requires an active readable directory source; other transports use their authorized host adapter');
  const root = await realpath(input.source.locator);
  const from = resolve(root, input.from);
  const allowed = async (ref: string) => {
    if (!isAbsolute(ref)) return { allowed: false, reason: 'remote and unscoped references require a separate authorized host adapter' };
    const rel = relative(root, ref);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || rel.split(sep).some((part) => part.startsWith('.') || part === 'node_modules')) return { allowed: false, reason: 'outside the declared directory or in excluded hidden metadata' };
    try { const real = await realpath(ref); const resolved = relative(root, real); return { allowed: !isAbsolute(resolved) && resolved !== '..' && !resolved.startsWith(`..${sep}`), reason: 'symlink target must remain inside the declared source' }; }
    catch { return { allowed: true, reason: 'authorized source path; read will record missing content' }; }
  };
  return traverseReferences({ roots: [from], now: input.now, maxDocuments: input.maxDocuments, adapter: {
    authorize: allowed,
    async read(ref, { signal, maxBytes }) {
      const real = await realpath(ref);
      if (!(await allowed(real)).allowed) return { outcome: 'denied', reason: 'path changed outside the declared source' };
      const info = await stat(real);
      if (!info.isFile()) return { outcome: 'missing', reason: 'reference is not a regular file' };
      if (info.size > maxBytes) return { outcome: 'unreachable', reason: 'file exceeds the remaining byte budget' };
      const text = await readFile(real, { encoding: 'utf8', signal });
      return { outcome: 'read', document: { ref, path: real, kind: 'file', provenance: 'witnessed', text }, operation: 'readFile', principal: `local:${String(process.getuid?.() ?? 'host')}`, sessionId: input.sessionId, scope: root, expiresAt: new Date(Date.parse(input.now()) + 60_000).toISOString() };
    },
  } });
}
