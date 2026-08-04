#!/usr/bin/env node
/**
 * capture-opencode-transcripts.mjs — record real `opencode run --format json`
 * transcripts as parser fixtures.
 *
 * Sibling in spirit to the capture-legacy-*-golden.mjs scripts, but the source
 * is a live external host rather than the archived predecessor, so it is
 * re-runnable rather than one-shot: point it at a new OpenCode version and diff
 * the fixtures to see exactly what moved.
 *
 * Defaults to local Ollama models. That is deliberate — these fixtures should
 * cost nothing to regenerate, or they will stop being regenerated.
 *
 *   node scripts/capture-opencode-transcripts.mjs
 *   node scripts/capture-opencode-transcripts.mjs --model ollama/qwen3.5:4b
 *
 * Requires a running OpenCode and, for the default models, a running Ollama.
 * The captured files are committed; tests never run this.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const binary = flag('binary', 'opencode');
const model = flag('model', 'ollama/qwen3.5:4b');
const toolModel = flag('tool-model', 'ollama/gpt-oss:20b');
const outDir = new URL('../tests/hosts/opencode/fixtures/', import.meta.url);

mkdirSync(outDir, { recursive: true });

function run({ name, prompt, model: runModel, files = {} }) {
  const workdir = mkdtempSync(path.join(tmpdir(), 'oc-capture-'));
  try {
    for (const [file, contents] of Object.entries(files)) {
      writeFileSync(path.join(workdir, file), contents);
    }
    // A git repo is what OpenCode snapshots against; without one the snapshot
    // field differs run to run for reasons unrelated to the host's behavior.
    spawnSync('git', ['init', '-q'], { cwd: workdir });

    const result = spawnSync(
      binary,
      ['run', '--dir', workdir, '--model', runModel, '--format', 'json', prompt],
      { encoding: 'utf8', cwd: workdir },
    );

    const target = new URL(`${name}.ndjson`, outDir);
    // The exit code is part of what these fixtures prove (see the
    // errors-do-not-set-exit-code expectation in src/hosts/opencode/pin.ts),
    // so it is recorded beside the transcript rather than thrown away.
    writeFileSync(target, result.stdout);
    writeFileSync(new URL(`${name}.exit`, outDir), `${result.status}\n`);
    process.stdout.write(
      `captured ${name}.ndjson  (exit ${result.status}, ${result.stdout.split('\n').filter(Boolean).length} lines)\n`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

process.stdout.write(`opencode: ${spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim()}\n`);

run({
  name: 'simple-text',
  model,
  prompt: 'Reply with exactly the word: READY',
});

run({
  name: 'tool-use',
  model: toolModel,
  files: { 'notes.txt': 'alpha\nbeta\ngamma\n' },
  prompt: 'Read the file notes.txt and tell me how many lines it has. Use your tools.',
});

run({
  name: 'model-not-found',
  model: 'ollama/does-not-exist-cx0',
  prompt: 'hello',
});

process.stdout.write('\ncapture-opencode-transcripts: done\n');
