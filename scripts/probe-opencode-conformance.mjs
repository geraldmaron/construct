#!/usr/bin/env node
/**
 * probe-opencode-conformance.mjs — check a live OpenCode against every
 * expectation the adapter depends on (src/hosts/opencode/pin.ts).
 *
 * The unit suite proves the adapter reduces a transcript correctly. It cannot
 * prove OpenCode still produces that transcript — only a live binary can, which
 * is why this is a script and not a test: the hermetic suite must not depend on
 * an external binary, a model, or a network.
 *
 * Run it after any OpenCode upgrade, and before trusting a run on a drifted
 * version:
 *
 *   node scripts/probe-opencode-conformance.mjs
 *   node scripts/probe-opencode-conformance.mjs --model ollama/qwen3.5:4b
 *
 * Exit codes: 0 all expectations hold. 1 at least one broke — read the failure,
 * re-verify, then update the pin. 2 the probe could not run at all (no binary,
 * no model), which is unknown, not pass.
 *
 * Defaults to a local Ollama model so that re-probing costs nothing.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CONFORMANCE_EXPECTATIONS, PINNED_VERSION } from '../src/hosts/opencode/pin.ts';
import { reduceTranscript } from '../src/hosts/opencode/events.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const binary = flag('binary', 'opencode');
const model = flag('model', 'ollama/qwen3.5:4b');
const toolModel = flag('tool-model', 'ollama/gpt-oss:20b');

const results = [];
const expectation = (id) => CONFORMANCE_EXPECTATIONS.find((e) => e.id === id);

function record(id, held, detail) {
  results.push({ id, held, detail });
}

function runOpenCode({ prompt, model: runModel, files = {} }) {
  const workdir = mkdtempSync(path.join(tmpdir(), 'oc-probe-'));
  try {
    for (const [file, contents] of Object.entries(files)) {
      writeFileSync(path.join(workdir, file), contents);
    }
    spawnSync('git', ['init', '-q'], { cwd: workdir });
    const result = spawnSync(
      binary,
      ['run', '--dir', workdir, '--model', runModel, '--format', 'json', prompt],
      { encoding: 'utf8', cwd: workdir },
    );
    return result;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

// ── version ────────────────────────────────────────────────────────────────
const versionProbe = spawnSync(binary, ['--version'], { encoding: 'utf8' });
if (versionProbe.error || versionProbe.status !== 0) {
  process.stderr.write(
    `probe cannot run: "${binary} --version" failed (${versionProbe.error?.message ?? `exit ${versionProbe.status}`}).\n` +
      'Install OpenCode or pass --binary. This is an unknown result, not a pass.\n',
  );
  process.exit(2);
}
const installed = versionProbe.stdout.trim().split('\n').pop().trim();
record('version-pinned', installed === PINNED_VERSION, `installed ${installed}, pinned ${PINNED_VERSION}`);

// ── a plain run ────────────────────────────────────────────────────────────
const simple = runOpenCode({ prompt: 'Reply with exactly the word: READY', model });
if (simple.error) {
  process.stderr.write(`probe cannot run: could not launch a run (${simple.error.message}).\n`);
  process.exit(2);
}
const simpleLines = simple.stdout.split('\n').filter((l) => l.trim());
const simpleReduced = reduceTranscript(simple.stdout);

if (simpleLines.length === 0) {
  process.stderr.write(
    `probe cannot run: a plain run produced no stdout (exit ${simple.status}).\n` +
      `Is the model "${model}" available? stderr:\n${simple.stderr.slice(0, 500)}\n`,
  );
  process.exit(2);
}

record(
  'json-format-ndjson',
  simpleLines.every((line) => {
    try {
      return typeof JSON.parse(line) === 'object';
    } catch {
      return false;
    }
  }),
  `${simpleLines.length} stdout lines`,
);

record(
  'text-part-carries-output',
  simpleReduced.text.length > 0,
  simpleReduced.text.length > 0 ? `text: ${JSON.stringify(simpleReduced.text.slice(0, 40))}` : 'no text part found',
);

record(
  'step-finish-carries-usage',
  simpleReduced.usage.steps > 0 &&
    simpleReduced.usage.inputTokens > 0 &&
    simpleReduced.usage.outputTokens > 0 &&
    Number.isFinite(simpleReduced.usage.cost),
  `steps ${simpleReduced.usage.steps}, in ${simpleReduced.usage.inputTokens}, out ${simpleReduced.usage.outputTokens}, cost ${simpleReduced.usage.cost}`,
);

record(
  'notices-go-to-stderr',
  simpleReduced.notices.length === 0,
  simpleReduced.notices.length === 0
    ? 'stdout was clean NDJSON'
    : `stdout carried ${simpleReduced.notices.length} non-JSON line(s)`,
);

// ── a multi-step run with tools ────────────────────────────────────────────
const toolRun = runOpenCode({
  prompt: 'Read the file notes.txt and tell me how many lines it has. Use your tools.',
  model: toolModel,
  files: { 'notes.txt': 'alpha\nbeta\ngamma\n' },
});
const toolReduced = reduceTranscript(toolRun.stdout);

record(
  'usage-is-per-step',
  toolReduced.usage.steps > 1,
  `a tool-using run emitted ${toolReduced.usage.steps} step_finish event(s)`,
);

const failedTools = toolReduced.toolCalls.filter((c) => c.status === 'error');
record(
  'tool-failure-is-not-run-failure',
  toolReduced.toolCalls.length > 0 && (failedTools.length === 0 || toolRun.status === 0),
  failedTools.length > 0
    ? `${failedTools.length} tool call(s) failed and the run still exited ${toolRun.status}`
    : `${toolReduced.toolCalls.length} tool call(s), none failed — the negative half of this expectation was not exercised`,
);

// ── a failed run ───────────────────────────────────────────────────────────
const failed = runOpenCode({ prompt: 'hello', model: 'ollama/does-not-exist-cx0' });
const failedReduced = reduceTranscript(failed.stdout);
record(
  'run-failure-sets-exit-code',
  failedReduced.errors.length > 0 && failed.status !== 0,
  `errors ${failedReduced.errors.length}, exit ${failed.status}`,
);

// ── report ─────────────────────────────────────────────────────────────────
let broken = 0;
process.stdout.write(`\nopencode conformance probe — installed ${installed}, pinned ${PINNED_VERSION}\n\n`);
for (const { id, held, detail } of results) {
  const spec = expectation(id);
  process.stdout.write(`${held ? 'ok  ' : 'FAIL'} ${id}\n`);
  process.stdout.write(`       ${spec?.claim ?? '(no claim recorded)'}\n`);
  process.stdout.write(`       observed: ${detail}\n`);
  if (!held) {
    broken += 1;
    process.stdout.write(`       why it matters: ${spec?.whyItMatters ?? '(unrecorded)'}\n`);
  }
  process.stdout.write('\n');
}

const unchecked = CONFORMANCE_EXPECTATIONS.filter((e) => !results.some((r) => r.id === e.id));
for (const spec of unchecked) {
  process.stdout.write(`????  ${spec.id} — declared in pin.ts but this probe never checks it\n`);
}

if (broken > 0) {
  process.stderr.write(
    `${broken} of ${results.length} expectation(s) no longer hold.\n` +
      'Re-verify the adapter against this version and update PINNED_VERSION — do not widen the pin to silence this.\n',
  );
  process.exit(1);
}
process.stdout.write(`probe-opencode-conformance: ${results.length} expectations hold\n`);
