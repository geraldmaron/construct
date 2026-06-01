/**
 * lib/document-extract/whisper-client.mjs — invoke whisper.cpp on audio/video.
 *
 * Returns `{ markdown, metadata, droppedInfo }` matching the shape returned
 * by docling-client for symmetry with the document-extract dispatcher.
 *
 * Strategy: run whisper-cli with the source file → text transcript. The
 * transcript is wrapped as a fenced "## Transcript" section in markdown so
 * the format-converter pipeline downstream gets a uniform shape.
 *
 * 2026-06 notes:
 *   - whisper.cpp + Metal hits ~10× real-time on M-series for large-v3.
 *     Default model is `base.en` for speed; override via
 *     CONSTRUCT_WHISPER_MODEL for non-English or higher-quality runs.
 *   - Non-audio formats are rejected up front so the docling sidecar stays
 *     the single owner of PDF/Office/HTML parsing.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { ensureWhisperRuntime } from '../runtime/whisper-bootstrap.mjs';

const CLI_TIMEOUT_MS = 600_000;

function runWhisperCli({ binary, modelPath, sourcePath, outputBase }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', sourcePath,
      '-otxt',
      '-of', outputBase,
      '-l', 'auto',
      '-nt',
    ];
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`whisper-cli timeout after ${CLI_TIMEOUT_MS}ms`));
    }, CLI_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`whisper-cli exited ${code}: ${stderr.slice(-500)}`));
      else resolve({ stdout, stderr });
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function extractViaWhisper(filePath, { runtimeDir, model } = {}) {
  const absolutePath = path.resolve(filePath);
  const { binary, modelPath, model: resolvedModel } = await ensureWhisperRuntime({ runtimeDir, model });
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'construct-whisper-'));
  const outputBase = path.join(tmpDir, 'transcript');
  try {
    const { stderr } = await runWhisperCli({ binary, modelPath, sourcePath: absolutePath, outputBase });
    const transcript = readFileSync(`${outputBase}.txt`, 'utf8').trim();
    const detectedLanguage = stderr.match(/auto-detected language: (\w+)/)?.[1] || null;
    const markdown = `## Transcript\n\n${transcript}\n`;
    return {
      markdown,
      metadata: {
        sourcePath: absolutePath,
        whisperModel: resolvedModel,
        binarySource: binary,
        detectedLanguage,
      },
      droppedInfo: transcript.length === 0
        ? [{ kind: 'empty-transcript', count: 1, reason: 'whisper-cli returned no text — silent file, unsupported codec, or model mismatch.', recoverable: true }]
        : [],
    };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
}
