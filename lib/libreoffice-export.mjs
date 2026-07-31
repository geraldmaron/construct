/**
 * lib/libreoffice-export.mjs — LibreOffice headless conversion for formats Pandoc cannot write.
 *
 * Pandoc has no `.doc` writer and no `.odp` (OpenDocument Presentation) writer; Construct builds
 * the nearest Pandoc/pptxgenjs format first (DOCX for `.doc`, PPTX for `.odp`), then down-converts
 * via `soffice --headless --convert-to <ext>`. Binary is optional. `--norestore`
 * suppresses the crash-recovery dialog LibreOffice otherwise shows after any prior abnormal
 * exit or concurrent-instance profile-lock collision, which would otherwise surface as a GUI
 * window despite `--headless`. Invocations route through the legacy-tagged Provider Card in
 * lib/providers/libreoffice-export-provider.mjs (construct-tsyfe.6.7).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  convertOutputBasename,
  libreOfficeInstallHint,
  libreOfficePresent,
  libreOfficeUsable,
  resolveLibreOfficeBin,
  resolveLibreOfficeProvider,
  spawnLibreOfficeProvider,
} from './providers/libreoffice-export-provider.mjs';

export {
  libreOfficeInstallHint,
  libreOfficePresent,
  libreOfficeUsable,
  resolveLibreOfficeBin,
  resolveLibreOfficeProvider,
  spawnLibreOfficeProvider,
} from './providers/libreoffice-export-provider.mjs';

// `soffice --convert-to <ext>` writes `<inputbasename>.<ext>` into --outdir; the target basename
// may differ, so the produced file is renamed to the caller's outputPath when they diverge.

export function convertViaLibreOffice({
  inputPath,
  outputPath,
  toFormat,
  env = process.env,
  spawnFn,
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

  const { result } = spawnLibreOfficeProvider([
    '--headless',
    '--norestore',
    '--convert-to', toFormat,
    '--outdir', outDir,
    path.resolve(inputPath),
  ], { env, spawnFn, bin: soffice });

  if (result.status !== 0) {
    return {
      ok: false,
      message: `LibreOffice conversion failed (exit ${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`,
    };
  }

  const expected = path.join(outDir, convertOutputBasename(inputPath, toFormat));
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

export function convertDocxToDoc({ docxPath, outputPath, env = process.env, spawnFn } = {}) {
  return convertViaLibreOffice({ inputPath: docxPath, outputPath, toFormat: 'doc', env, spawnFn });
}
