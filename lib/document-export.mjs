/**
 * lib/document-export.mjs — markdown → PDF / DOCX / HTML export via external
 * binaries (Pandoc + Typst), per ADR-0024.
 *
 * Bound to system-binary tooling discovered at runtime, never bundled in core
 * (ADR-0001 zero-npm-core; ADR-0014 optional-capability pattern). Both engines
 * are spawned as separate processes — Pandoc isolates its GPLv2+ licence at
 * the process boundary; Typst is the Apache-2.0 PDF engine driven through
 * Pandoc's `--pdf-engine=typst` flag, so a single Pandoc invocation produces
 * every target format the contract supports.
 *
 * detect(format) reports availability without spawning the engine for real.
 * exportMarkdown({ inputPath, outputPath, format, env }) spawns the engine and
 * returns a structured result. Both surface actionable "install X" guidance
 * when a required binary is absent; neither throws on missing tooling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const EXPORT_FORMATS = ['pdf', 'docx', 'html'];

const FORMAT_ENGINES = {
  pdf: { engine: 'pandoc', pdfEngine: 'typst', extraBinaries: ['typst'] },
  docx: { engine: 'pandoc', pdfEngine: null, extraBinaries: [] },
  html: { engine: 'pandoc', pdfEngine: null, extraBinaries: [] },
};

function whichBin(name, env = process.env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  const first = (result.stdout || '').trim().split('\n')[0];
  return first || null;
}

function binVersion(name, args = ['--version'], env = process.env) {
  const r = spawnSync(name, args, { encoding: 'utf8', env });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').trim().split('\n')[0];
  return line || null;
}

function installHint(name) {
  if (name === 'pandoc') return 'Install pandoc to enable document export (e.g. `brew install pandoc` on macOS, `apt install pandoc` on Debian/Ubuntu, or https://pandoc.org/installing.html).';
  if (name === 'typst') return 'Install typst to enable PDF export via Pandoc (`brew install typst` on macOS, https://github.com/typst/typst/releases for binaries).';
  return `Install ${name} to enable this export format.`;
}

// detect returns the same structure regardless of format so callers can render
// availability uniformly. `present` is the single boolean a caller should gate
// on; `missing` enumerates the binaries to install when present is false.

export function detect(format, env = process.env) {
  const config = FORMAT_ENGINES[format];
  if (!config) return { ok: false, format, present: false, missing: [], message: `Unsupported format: ${format}. Supported: ${EXPORT_FORMATS.join(', ')}.` };
  const required = [config.engine, ...(config.extraBinaries || [])];
  const status = required.map((name) => ({ name, path: whichBin(name, env), version: null }));
  for (const s of status) if (s.path) s.version = binVersion(s.name, ['--version'], env);
  const missing = status.filter((s) => !s.path).map((s) => s.name);
  return {
    ok: true,
    format,
    present: missing.length === 0,
    binaries: status,
    missing,
    message: missing.length === 0
      ? `Ready: ${status.map((s) => `${s.name} (${s.version?.split(' ').slice(0, 2).join(' ') ?? 'unknown'})`).join(', ')}`
      : missing.map(installHint).join(' '),
  };
}

function defaultOutputPath(inputPath, format) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.${format}`);
}

// exportMarkdown is the single contract callers depend on (CLI / MCP / SDK).
// Returns { ok, format, inputPath, outputPath, engine, missing?, message }.
// ok=false with a populated `missing` means a required binary is absent — the
// caller surfaces `message` (which carries the install hint) instead of
// retrying or crashing.

export function exportMarkdown({ inputPath, outputPath, format, env = process.env, spawnFn = spawnSync } = {}) {
  if (!inputPath) return { ok: false, format, message: 'exportMarkdown: inputPath is required.' };
  if (!EXPORT_FORMATS.includes(format)) return { ok: false, format, inputPath, message: `Unsupported format: ${format}. Supported: ${EXPORT_FORMATS.join(', ')}.` };
  if (!fs.existsSync(inputPath)) return { ok: false, format, inputPath, message: `exportMarkdown: input does not exist: ${inputPath}` };

  const detection = detect(format, env);
  if (!detection.present) {
    return { ok: false, format, inputPath, missing: detection.missing, message: detection.message };
  }

  const config = FORMAT_ENGINES[format];
  const target = outputPath || defaultOutputPath(inputPath, format);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const args = ['-f', 'markdown', '-o', target, '--standalone'];
  if (config.pdfEngine) args.push(`--pdf-engine=${config.pdfEngine}`);
  args.push(inputPath);

  const result = spawnFn(config.engine, args, { encoding: 'utf8', env });
  if (result.status !== 0) {
    return {
      ok: false,
      format,
      inputPath,
      outputPath: target,
      engine: config.engine,
      message: `Export failed (${config.engine} exit ${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`,
    };
  }

  return {
    ok: true,
    format,
    inputPath,
    outputPath: target,
    engine: config.engine,
    pdfEngine: config.pdfEngine,
    message: `Wrote ${path.relative(process.cwd(), target)}`,
  };
}
