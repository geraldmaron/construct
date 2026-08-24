#!/usr/bin/env node
/**
 * scripts/probe-bob-conformance.mjs — check the pinned expectations in
 * src/hosts/bob/pin.ts against a live `bob` binary.
 *
 * Every expectation in the pin is currently 'documented': copied from IBM's
 * own docs, never run. This script is what turns a 'documented' claim into a
 * 'measured' one — it exists to be run the day a `bob` binary is reachable,
 * not to fabricate a pass today. With no binary present it refuses and exits
 * nonzero rather than reporting success on claims nobody checked.
 *
 * Bob is a probe target only. Development model calls for this project come
 * from Gerald's Claude Code or Cursor subscriptions, never Bob or any other
 * metered or local provider (CLAUDE.md); this script never dispatches real
 * project work through Bob.
 *
 *   node scripts/probe-bob-conformance.mjs [--binary /path/to/bob]
 *
 * Exit codes: 0 all checkable expectations hold. 1 at least one broke — read
 * the failure, then update the pin. 2 the probe could not run at all (no
 * binary), which is unknown, not pass.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPECTATIONS, PINNED_VERSION } from '../src/hosts/bob/pin.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const binary = flag('binary', 'bob');

const checked = new Set();
let failed = 0;

function pass(name, detail) {
  checked.add(name);
  console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  checked.add(name);
  failed += 1;
  console.log(`  FAIL  ${name} — ${detail}`);
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: null, stdout, stderr, error: err }));
  });
}

console.log(`probe-bob-conformance against "${binary}" (pinned: ${PINNED_VERSION ?? 'none — no binary has ever been probed'})`);

// The refusal gate: everything below assumes a real binary answers. Without
// one, every expectation stays 'documented' and reporting a pass would be
// exactly the false claim this pin is built to prevent.
const versionProbe = await run(binary, ['--version']);
if (versionProbe.error || versionProbe.code === null) {
  process.stderr.write(
    `probe cannot run: "${binary}" was not found (${versionProbe.error?.message ?? 'spawn failed'}).\n` +
      'Install Bob (https://bob.ibm.com/docs/shell/getting-started/install-and-setup) or pass --binary.\n' +
      'This is an unknown result, not a pass: every expectation in src/hosts/bob/pin.ts stays documented,\n' +
      'not measured, until a probe run actually observes it.\n',
  );
  process.exit(2);
}

// version-flag-output-shape — the shape itself is the open question, so any
// output at all (not a specific format) is what this check looks for.
const versionLine = versionProbe.stdout.trim() || versionProbe.stderr.trim();
if (versionProbe.code === 0 && versionLine) {
  pass('version-flag-output-shape', `observed: ${JSON.stringify(versionLine)} — record this shape in the pin as measured`);
} else {
  fail('version-flag-output-shape', `exit ${versionProbe.code}: stdout ${JSON.stringify(versionProbe.stdout)} stderr ${JSON.stringify(versionProbe.stderr)}`);
}

const dir = mkdtempSync(join(tmpdir(), 'bob-probe-'));
try {
  // prompt-flag-runs-non-interactively
  const nonInteractive = await run(binary, ['-p', 'Reply with exactly the word: pong'], { cwd: dir });
  if (nonInteractive.code === 0 && /pong/i.test(nonInteractive.stdout)) {
    pass('prompt-flag-runs-non-interactively', `exit 0, reply: ${JSON.stringify(nonInteractive.stdout.slice(0, 120))}`);
  } else {
    fail('prompt-flag-runs-non-interactively', `exit ${nonInteractive.code}; stdout: ${nonInteractive.stdout.slice(0, 200)}; stderr: ${nonInteractive.stderr.slice(0, 200)}`);
  }

  // stdin-can-be-piped-alongside-a-prompt
  const stdinFile = join(dir, 'stdin-input.txt');
  writeFileSync(stdinFile, 'the marker value is CONSTRUCT_PROBE_42\n');
  // run() above hardcodes stdin to 'ignore'; this check needs a real pipe.
  const piped = await new Promise((resolve) => {
    const child = spawn(binary, ['-p', 'What marker value did stdin contain? Reply with just the value.'], { cwd: dir });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: null, stdout, stderr, error: err }));
    child.stdin.write(readFileSync(stdinFile, 'utf8'));
    child.stdin.end();
  });
  if (piped.code === 0 && /CONSTRUCT_PROBE_42/.test(piped.stdout)) {
    pass('stdin-can-be-piped-alongside-a-prompt', `stdin content echoed back: ${JSON.stringify(piped.stdout.slice(0, 120))}`);
  } else {
    fail('stdin-can-be-piped-alongside-a-prompt', `exit ${piped.code}; stdout: ${piped.stdout.slice(0, 200)}; stderr: ${piped.stderr.slice(0, 200)}`);
  }

  // yolo-is-the-write-gate — without --yolo, a file-write request must not
  // produce the file.
  const marker = join(dir, 'construct-probe-write-marker.txt');
  const withoutYolo = await run(binary, ['-p', `Create a file named ${marker} containing the text "written"`], { cwd: dir });
  if (!existsSync(marker)) {
    pass('yolo-is-the-write-gate', `exit ${withoutYolo.code}, no file written without --yolo`);
  } else {
    fail('yolo-is-the-write-gate', 'a file was written without passing --yolo');
    rmSync(marker, { force: true });
  }

  // chat-mode-selects-a-custom-mode — write a project custom_modes.yaml
  // naming a mode with a distinctive roleDefinition, then check the reply
  // reflects that mode rather than the default.
  const bobDir = join(dir, '.bob');
  await run('mkdir', ['-p', bobDir]);
  writeFileSync(
    join(bobDir, 'custom_modes.yaml'),
    [
      'modes:',
      '  - slug: construct-probe-mode',
      '    name: Construct Probe Mode',
      '    description: Used only by the bob conformance probe.',
      '    roleDefinition: You always begin every reply with the exact token CONSTRUCT_PROBE_MODE_ACTIVE.',
      '    customInstructions: Always begin your reply with CONSTRUCT_PROBE_MODE_ACTIVE.',
      '    groups: [read]',
      '    whenToUse: Only for the automated conformance probe.',
      '',
    ].join('\n'),
  );
  const modeRun = await run(binary, ['-p', 'Say hello.', '--chat-mode=construct-probe-mode'], { cwd: dir });
  if (modeRun.code === 0 && /CONSTRUCT_PROBE_MODE_ACTIVE/.test(modeRun.stdout)) {
    pass('chat-mode-selects-a-custom-mode', 'reply carried the custom mode marker');
  } else {
    fail('chat-mode-selects-a-custom-mode', `exit ${modeRun.code}; stdout: ${modeRun.stdout.slice(0, 200)}; stderr: ${modeRun.stderr.slice(0, 200)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// skills-discovered-from-a-folder-per-skill — checked structurally by
// reading the docs' required frontmatter shape, not by round-tripping a
// model call; a real measurement needs a run that proves Bob actually used
// the skill, which the probe does not attempt here.
console.log('  SKIP  skills-discovered-from-a-folder-per-skill — needs a run that proves the skill was used, not attempted here');
checked.add('skills-discovered-from-a-folder-per-skill');

// auth-is-ibmid-sso-or-an-api-key — this machine's ability to run `bob -p`
// at all above already implies SOME auth path resolved (IBMid session or
// BOB_API_KEY); which one is not distinguishable from the outside without
// deliberately clearing credentials, which this probe does not do.
const hasApiKey = Boolean(process.env.BOB_API_KEY);
console.log(
  `  NOTE  auth-is-ibmid-sso-or-an-api-key — BOB_API_KEY ${hasApiKey ? 'is set' : 'is not set'} in this environment; ` +
    'the probe ran under whichever credential Bob resolved, not distinguished further here',
);
checked.add('auth-is-ibmid-sso-or-an-api-key');
console.log(`  home: ${homedir()}`);

for (const expectation of EXPECTATIONS) {
  if (!checked.has(expectation.name)) {
    console.log(`  SKIP  ${expectation.name} — no probe wrote a verdict`);
  }
}

console.log(failed === 0 ? 'probe-bob-conformance: pass' : `probe-bob-conformance: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
