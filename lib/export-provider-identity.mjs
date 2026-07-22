/**
 * lib/export-provider-identity.mjs — resolve export engine name and version for evidence fields.
 *
 * Maps landed export-result engine labels to a provider identity record. Version strings come
 * from the same --version probes lib/document-export.mjs uses for detect(), without duplicating
 * install hints or spawn wiring.
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

import { pptxgenPresent } from './deck-export-pptx.mjs';

const require = createRequire(import.meta.url);

function whichBin(name, env = process.env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

function engineVersion(name, env = process.env) {
  const bin = whichBin(name, env);
  if (!bin) return null;
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  const line = (result.stdout || '').trim().split('\n')[0];
  return line || null;
}

function packageVersion(name) {
  try {
    const pkg = require(`${name}/package.json`);
    return pkg.version ? `${name} ${pkg.version}` : null;
  } catch {
    return null;
  }
}

export function resolveExportProviderIdentity(result, { env = process.env } = {}) {
  const engine = result?.engine || 'unknown';
  if (engine === 'pandoc' || engine === 'typst') {
    return { name: engine, version: engineVersion(engine, env) || `${engine} (version unknown)` };
  }
  if (engine === 'pptxgenjs') {
    return {
      name: 'pptxgenjs',
      version: pptxgenPresent() ? (packageVersion('pptxgenjs') || 'pptxgenjs (version unknown)') : 'pptxgenjs (not installed)',
    };
  }
  if (engine === 'libreoffice') {
    return { name: 'libreoffice', version: engineVersion('soffice', env) || engineVersion('libreoffice', env) || 'libreoffice (version unknown)' };
  }
  if (engine === 'copy' || engine === 'fragment') {
    return { name: 'construct', version: 'copy' };
  }
  if (engine === 'construct-html') {
    const pkgVersion = packageVersion('@geraldmaron/construct');
    return {
      name: 'construct-html-sanitizer',
      version: pkgVersion || 'construct-html-sanitizer (version unknown)',
    };
  }
  return { name: String(engine), version: 'unknown' };
}
