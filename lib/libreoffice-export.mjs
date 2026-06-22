/**
 * lib/libreoffice-export.mjs — LibreOffice headless conversion for legacy .doc export.
 *
 * Pandoc has no `.doc` writer; Construct exports DOCX first, then down-converts via
 * `soffice --headless --convert-to doc`. Binary is optional (ADR-0024).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOFFICE_CANDIDATES = [
  'soffice',
  'libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];

function whichBin(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function resolveLibreOfficeBin(env = process.env) {
  const fromEnv = (env.CONSTRUCT_LIBREOFFICE_BIN || env.SOFFICE_BIN || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of SOFFICE_CANDIDATES) {
    if (candidate.includes('/') && fs.existsSync(candidate)) return candidate;
    const found = whichBin(candidate);
    if (found) return found;
  }
  return null;
}

export function libreOfficePresent(env = process.env) {
  return Boolean(resolveLibreOfficeBin(env));
}

export function libreOfficeInstallHint() {
  return 'Install LibreOffice to enable legacy .doc export (e.g. `brew install --cask libreoffice` on macOS, `apt install libreoffice` on Debian/Ubuntu, or https://www.libreoffice.org/download/). Override with CONSTRUCT_LIBREOFFICE_BIN.';
}

export function convertDocxToDoc({
  docxPath,
  outputPath,
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
  if (!fs.existsSync(docxPath)) {
    return { ok: false, message: `DOCX intermediate missing: ${docxPath}` };
  }

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  const result = spawnFn(soffice, [
    '--headless',
    '--convert-to', 'doc',
    '--outdir', outDir,
    path.resolve(docxPath),
  ], { encoding: 'utf8', env });

  if (result.status !== 0) {
    return {
      ok: false,
      message: `LibreOffice conversion failed (exit ${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`,
    };
  }

  const expected = path.join(outDir, `${path.parse(docxPath).name}.doc`);
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
