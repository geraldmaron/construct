import { execFileSync } from 'node:child_process';
import { sourceDigest, checkDelivery, digestBytes } from './delivery-evidence.mjs';
export { sourceDigest, checkDelivery } from './delivery-evidence.mjs';
/** Only current exact-package delivery evidence can satisfy this gate. */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descriptionsDigest } from './host-surface.mjs';
import { reviewDigest } from '../src/kernel/workflow/semantic-review.ts';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = digestBytes;
// The runner imports these fixture helpers; they are invocation bytes too.
export function surfaceDigest() {
  return reviewDigest({
    surface: descriptionsDigest(),
    helpers: Object.fromEntries(
      ['tests/kernel/state/support.ts', 'tests/kernel/registry/support.ts'].map((path) => [
        path,
        sha256(readFileSync(resolve(ROOT, path))),
      ]),
    ),
  });
}
export function repositoryFile(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw Error('evidence path must be repository relative');
  const path = realpathSync(resolve(root, name)),
    rel = relative(realpathSync(root), path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('evidence path escapes repository');
  return readFileSync(path);
}
/** Delivery consumes supplied evidence, never imports a maintainer-local harness. */
export async function checkRelease({ tier = 'delivery', root = ROOT, manifest: manifestPath, tarball } = {}) {
  if (tier === 'qualified' || tier === 'experimental-alpha')
    return {
      ok: false,
      problems: [
        `${tier} tier is retired; use delivery with --manifest and --tarball. Historical evidence cannot satisfy current delivery.`,
      ],
    };
  if (tier === 'delivery') {
    try {
      if (!manifestPath || !tarball) throw Error('delivery requires --manifest=<external manifest.json> and --tarball=<candidate.tgz>');
      const version = JSON.parse(readFileSync(resolve(root, 'package.json'))).version;
      const archive = resolve(tarball);
      const packed = JSON.parse(
        execFileSync('tar', ['-xOf', archive, 'package/package.json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 1024 * 1024,
          timeout: 30000,
        }),
      );
      if (packed.name !== '@geraldmaron/construct' || packed.version !== version)
        throw Error('tarball package identity differs from checkout');
      const path = resolve(manifestPath);
      return checkDelivery({
        manifest: JSON.parse(readFileSync(path)),
        version,
        source: sourceDigest(root),
        surface: surfaceDigest(),
        tarballSha256: sha256(readFileSync(archive)),
        read: (name) => repositoryFile(dirname(path), name),
      });
    } catch (e) {
      return { ok: false, problems: [e.message], tier: 'delivery' };
    }
  }
  return { ok: false, problems: ['unknown release tier; use delivery with --manifest and --tarball'] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    tier = args.find((a) => a.startsWith('--tier='))?.slice(7) ?? 'delivery';
  if (
    args.some((a) => !['--tier=', '--manifest=', '--tarball='].some((prefix) => a.startsWith(prefix))) ||
    ['--tier=', '--manifest=', '--tarball='].some((prefix) => args.filter((a) => a.startsWith(prefix)).length > 1)
  )
    throw Error('usage: node scripts/release-gate.mjs [--tier=delivery] --manifest=<path> --tarball=<path>');
  const r = await checkRelease({
    tier,
    manifest: args.find((a) => a.startsWith('--manifest='))?.slice(11),
    tarball: args.find((a) => a.startsWith('--tarball='))?.slice(10),
  });
  for (const p of r.problems) process.stderr.write(`release gate: ${p}\n`);
  if (r.ok) {
    console.log(`release gate: ${tier} evidence is current and meets its bounded policy; broader qualification is not inferred`);
  }
  process.exitCode = r.ok ? 0 : 1;
}
