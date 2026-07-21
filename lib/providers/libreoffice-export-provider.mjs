/**
 * lib/providers/libreoffice-export-provider.mjs — legacy-compatibility Provider Card
 * identity and spawn wrapper for LibreOffice/soffice (construct-tsyfe.6.7).
 *
 * LibreOffice exists only because Pandoc has no `.doc` writer and no `.odp`
 * writer, and because PPTX diagram rasterization currently down-converts through
 * soffice before pdftoppm. It is a stopgap, not a first-class export renderer
 * like Pandoc, Typst, or pptxgenjs.
 *
 * Removal condition (behavior-based, no calendar expiration): keep until Pandoc
 * ships a native `.doc` writer, `.doc`/`.odp` export is dropped from Construct,
 * or PPTX diagram rasterization has a non-LibreOffice renderer.
 *
 * Call sites: lib/libreoffice-export.mjs (`convertViaLibreOffice`) and
 * lib/render-pipeline.mjs (PPTX-to-PNG diagram rasterization).
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findProviderCard } from './provider-card.mjs';

export const LIBREOFFICE_PROVIDER_ID = 'libreoffice';

export const LIBREOFFICE_REMOVAL_CONDITION =
  'Remove when Pandoc ships a native .doc writer, .doc/.odp export is dropped from Construct, or PPTX diagram rasterization no longer requires LibreOffice.';

const SOFFICE_CANDIDATES = [
  'soffice',
  'libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];

const usabilityCache = new Map();

function whichBin(name, env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function resolveLibreOfficeBin(env = process.env, { existsSyncFn = fs.existsSync } = {}) {
  const fromEnv = (env.CONSTRUCT_LIBREOFFICE_BIN || env.SOFFICE_BIN || '').trim();
  if (fromEnv && existsSyncFn(fromEnv)) return fromEnv;
  for (const candidate of SOFFICE_CANDIDATES) {
    if (candidate.includes('/') && existsSyncFn(candidate)) return candidate;
    const found = whichBin(candidate, env);
    if (found) return found;
  }
  return null;
}

export function libreOfficePresent(env = process.env, opts) {
  return Boolean(resolveLibreOfficeBin(env, opts));
}

export function libreOfficeUsable(env = process.env, opts = {}) {
  const { spawnFn = spawnSync, ...resolveOpts } = opts;
  const bin = resolveLibreOfficeBin(env, resolveOpts);
  if (!bin) return false;
  const cacheKey = `${bin}|${env.CONSTRUCT_LIBREOFFICE_BIN || env.SOFFICE_BIN || ''}`;
  if (usabilityCache.has(cacheKey)) return usabilityCache.get(cacheKey);
  const result = spawnFn(bin, ['--headless', '--norestore', '--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 5000,
    env,
  });
  const usable = result?.status === 0;
  usabilityCache.set(cacheKey, usable);
  return usable;
}

export function libreOfficeInstallHint() {
  const card = findProviderCard(LIBREOFFICE_PROVIDER_ID);
  if (card?.fallback?.description) return card.fallback.description;
  return 'Install LibreOffice to enable legacy .doc export (e.g. `brew install --cask libreoffice` on macOS, `apt install libreoffice` on Debian/Ubuntu, or https://www.libreoffice.org/download/). Override with CONSTRUCT_LIBREOFFICE_BIN.';
}

export function queryLibreOfficeProviderCard() {
  const card = findProviderCard(LIBREOFFICE_PROVIDER_ID);
  return {
    id: LIBREOFFICE_PROVIDER_ID,
    legacy: card?.legacy === true,
    removalCriteria: card?.removalCriteria ?? LIBREOFFICE_REMOVAL_CONDITION,
    card,
  };
}

function readLibreOfficeVersion(bin, env, card) {
  const hc = card?.healthCheck;
  const args = hc?.args ?? ['--headless', '--norestore', '--version'];
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: hc?.timeoutMs ?? 5000,
    env,
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function resolveLibreOfficeProvider(env = process.env, opts = {}) {
  const identity = queryLibreOfficeProviderCard();
  const binPath = resolveLibreOfficeBin(env, opts);
  const usable = binPath ? libreOfficeUsable(env, opts) : false;
  const version = binPath && usable ? readLibreOfficeVersion(binPath, env, identity.card) : null;
  return {
    ...identity,
    path: binPath,
    version,
    usable,
    installHint: libreOfficeInstallHint(),
  };
}

export function spawnLibreOfficeProvider(args, { env = process.env, spawnFn = spawnSync, bin, ...resolveOpts } = {}) {
  const identity = queryLibreOfficeProviderCard();
  const soffice = bin ?? resolveLibreOfficeBin(env, resolveOpts);
  if (!soffice) {
    return {
      ...identity,
      result: { status: 1, stdout: '', stderr: 'LibreOffice binary not found' },
      bin: null,
    };
  }
  const result = spawnFn(soffice, args, { encoding: 'utf8', env });
  return { ...identity, result, bin: soffice };
}

export function convertOutputBasename(inputPath, toFormat) {
  return `${path.parse(inputPath).name}.${toFormat}`;
}
