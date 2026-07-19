/**
 * lib/libreoffice-export.mjs — LibreOffice headless conversion for formats Pandoc cannot write.
 *
 * Pandoc has no `.doc` writer and no `.odp` (OpenDocument Presentation) writer; Construct builds
 * the nearest Pandoc/pptxgenjs format first (DOCX for `.doc`, PPTX for `.odp`), then down-converts
 * via `soffice --headless --convert-to <ext>`. Binary is optional (ADR-0024). `--norestore`
 * suppresses the crash-recovery dialog LibreOffice otherwise shows after any prior abnormal
 * exit or concurrent-instance profile-lock collision, which would otherwise surface as a GUI
 * window despite `--headless`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

/**
 * Check that the resolved binary can start in headless mode. macOS can expose
 * an installed app binary that aborts immediately under a restricted runner;
 * existence alone must not make the export path invoke it repeatedly.
 */
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
  return 'Install LibreOffice to enable legacy .doc export (e.g. `brew install --cask libreoffice` on macOS, `apt install libreoffice` on Debian/Ubuntu, or https://www.libreoffice.org/download/). Override with CONSTRUCT_LIBREOFFICE_BIN.';
}

// `soffice --convert-to <ext>` writes `<inputbasename>.<ext>` into --outdir; the target basename
// may differ, so the produced file is renamed to the caller's outputPath when they diverge.

export function convertViaLibreOffice({
  inputPath,
  outputPath,
  toFormat,
  env = process.env,
  spawnFn = spawnSync,
} = {}) {
  const soffice = resolveLibreOfficeBin(env);
  if (!soffice) {
    return {
      ok: false,
      message: libreOfficeInstallHint(),
      missing: ['libreoffice'],
    };
  }
  if (!fs.existsSync(inputPath)) {
    return { ok: false, message: `LibreOffice intermediate missing: ${inputPath}` };
  }
  if (!libreOfficeUsable(env, { spawnFn })) {
    return {
      ok: false,
      message: 'LibreOffice is installed but cannot start headlessly in this environment; use a supported runner or set CONSTRUCT_LIBREOFFICE_BIN to a usable binary.',
      missing: ['libreoffice (headless launch unavailable)'],
    };
  }

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  const result = spawnFn(soffice, [
    '--headless',
    '--norestore',
    '--convert-to', toFormat,
    '--outdir', outDir,
    path.resolve(inputPath),
  ], { encoding: 'utf8', env });

  if (result.status !== 0) {
    return {
      ok: false,
      message: `LibreOffice conversion failed (exit ${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`,
    };
  }

  const expected = path.join(outDir, `${path.parse(inputPath).name}.${toFormat}`);
  if (!fs.existsSync(expected)) {
    return {
      ok: false,
      message: `LibreOffice did not produce expected output: ${expected}`,
    };
  }

  if (path.resolve(expected) !== path.resolve(outputPath)) {
    fs.renameSync(expected, outputPath);
  }

  return {
    ok: true,
    outputPath,
    engine: 'libreoffice',
    message: `Wrote ${path.relative(process.cwd(), outputPath)}`,
  };
}

export function convertDocxToDoc({ docxPath, outputPath, env = process.env, spawnFn = spawnSync } = {}) {
  return convertViaLibreOffice({ inputPath: docxPath, outputPath, toFormat: 'doc', env, spawnFn });
}
