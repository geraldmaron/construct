/**
 * lib/libreoffice-export.mjs — LibreOffice headless conversion for formats Pandoc cannot write.
 *
 * Pandoc has no `.doc` writer and no `.odp` (OpenDocument Presentation) writer; Construct builds
 * the nearest Pandoc/pptxgenjs format first (DOCX for `.doc`, PPTX for `.odp`), then down-converts
 * via `soffice --headless --convert-to <ext>`. Binary is optional (ADR-0024).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOFFICE_CANDIDATES = [
  'soffice',
  'libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];

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

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  const result = spawnFn(soffice, [
    '--headless',
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
