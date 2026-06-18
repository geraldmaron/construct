/**
 * lib/demo.mjs — `construct demo` command, produces a reproducible terminal
 * recording of a Construct workflow from a `.tape` script, rendering to
 * GIF/MP4/WebM via VHS, degrading to asciinema, and finally to emitting the
 * `.tape` source + install hint when no recorder is installed.
 *
 * Tool evaluation (2026-06), against: reproducible-from-code, headless CI
 * render, distribution formats, license:
 *   - VHS (charm.sh, MIT): records a `.tape` script (declarative keystrokes +
 *     timing) to GIF/MP4/WebM headlessly via an embedded ttyd + ffmpeg. The
 *     `.tape` is deterministic and diffable — the source of truth lives in the
 *     repo, the artifact regenerates in CI. Chosen as PRIMARY: reproducible,
 *     embeddable in README/docs, multiple output formats.
 *   - asciinema (asciinema.org, GPL-3.0): records a terminal session to a
 *     `.cast` JSON. Reproducible and lightweight but interactive-capture by
 *     nature and GIF export needs the separate `agg` tool. Chosen as FALLBACK
 *     when VHS is absent; we drive it non-interactively via `asciinema rec -c`.
 *   - Playwright (dashboard): out of scope here — it is a dev-only browser
 *     driver for the web UI, not a terminal recorder, and lives with the
 *     dashboard tests rather than this command.
 *
 * Degradation contract: when neither vhs nor asciinema is on PATH the command
 * still succeeds (exit 0) by writing the `.tape` SOURCE plus an install hint.
 * No bundled binaries, no npm dependencies; recorders are detected at runtime,
 * mirroring lib/runtime/whisper-bootstrap.mjs.
 *
 * Output: .cx/demos/<name>-<ts>.<ext> (recording) and the `.tape` source.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const FORMATS = ['gif', 'mp4', 'webm'];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

// Recorder detection follows the optional-external-tool pattern: probe PATH,
// return a structured descriptor, never throw. VHS is preferred for its
// declarative `.tape` model and multi-format output; asciinema is the fallback.

export function locateRecorder() {
  const vhs = which('vhs');
  if (vhs) return { engine: 'vhs', binary: vhs };
  const asciinema = which('asciinema');
  if (asciinema) return { engine: 'asciinema', binary: asciinema };
  return null;
}

export function installHint() {
  if (process.platform === 'darwin') return 'brew install vhs   (or: brew install asciinema)';
  if (process.platform === 'linux') return 'See https://github.com/charmbracelet/vhs#installation   (or: pip install asciinema)';
  return 'See https://github.com/charmbracelet/vhs#installation';
}

// Built-in workflow tapes. Each is a VHS `.tape`: declarative Type/Enter/Sleep
// directives that record a real walkthrough. Commands are illustrative and
// safe to replay; tapes are the source of truth, regenerated in CI.

const TAPES = {
  quickstart: (out) => `# construct demo: quickstart — plan then build
Output ${out}
Set FontSize 18
Set Width 1100
Set Height 600
Set Theme "Dracula"
Set TypingSpeed 60ms

Type "construct plan 'add a rate limiter to the API'"
Sleep 500ms
Enter
Sleep 2s

Type "construct build"
Sleep 500ms
Enter
Sleep 2s

Type "construct ship status"
Sleep 500ms
Enter
Sleep 2s
`,
  diagram: (out) => `# construct demo: diagram — render an architecture diagram
Output ${out}
Set FontSize 18
Set Width 1100
Set Height 600
Set Theme "Dracula"
Set TypingSpeed 60ms

Type "construct diagram 'web app: client -> api -> db'"
Sleep 500ms
Enter
Sleep 2s
`,
};

export const TAPE_NAMES = Object.keys(TAPES);

export function generateTape(name, outputArtifact) {
  const builder = TAPES[name];
  if (!builder) return null;
  return builder(outputArtifact);
}

// VHS reads the Output directive from the .tape, so the artifact path is baked
// into the source before rendering. The render is fully headless.

function renderWithVhs(binary, tapePath) {
  return spawnSync(binary, [tapePath], { encoding: 'utf8', timeout: 180_000 });
}

// asciinema can't replay a VHS .tape, so for the fallback we extract the
// `Type`/`Enter` lines into a single shell command string and capture it
// non-interactively into a .cast file. The .tape source is still written so
// the canonical, VHS-renderable form is preserved.

function tapeToShellCommand(tapeSource) {
  const commands = [];
  let pending = '';
  for (const line of tapeSource.split('\n')) {
    const typeMatch = line.match(/^Type\s+"(.*)"\s*$/);
    if (typeMatch) { pending = typeMatch[1]; continue; }
    if (/^Enter\s*$/.test(line) && pending) { commands.push(pending); pending = ''; }
  }
  return commands.join(' && ');
}

function renderWithAsciinema(binary, tapeSource, outPath) {
  const command = tapeToShellCommand(tapeSource) || 'echo "construct demo"';
  return spawnSync(binary, ['rec', '--overwrite', '-c', command, outPath], { encoding: 'utf8', timeout: 180_000 });
}

export function printHelp() {
  console.log(`Usage: construct demo <name> [options]

Produces a reproducible terminal recording of a Construct workflow from a
.tape script. Renders to GIF/MP4/WebM via VHS (primary) or a .cast via
asciinema (fallback). When neither recorder is installed, writes the .tape
SOURCE plus an install hint and exits 0.

Tapes:
  ${TAPE_NAMES.join('\n  ')}

Options:
  --format <f>   gif (default) | mp4 | webm   (VHS only)
  --out <path>   Output path (default: .cx/demos/<name>-<ts>.<ext>)
  --source-only  Always write the .tape source; skip recording
  -h, --help     Show this message

Recorders (detected at runtime, never bundled):
  VHS        ${process.platform === 'darwin' ? 'brew install vhs' : 'https://github.com/charmbracelet/vhs#installation'}
  asciinema  ${process.platform === 'darwin' ? 'brew install asciinema' : 'pip install asciinema'}

Examples:
  construct demo quickstart
  construct demo diagram --format mp4
  construct demo quickstart --source-only
`);
}

function parseArgs(argv) {
  const options = { format: 'gif', out: null, sourceOnly: false, name: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--source-only') { options.sourceOnly = true; continue; }
    if (arg === '--format') { options.format = argv[++i]; continue; }
    if (arg.startsWith('--format=')) { options.format = arg.slice(9); continue; }
    if (arg === '--out') { options.out = argv[++i]; continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice(6); continue; }
    positional.push(arg);
  }
  options.name = positional[0] || null;
  return options;
}

export async function runDemoCli(argv = [], { cwd = process.cwd() } = {}) {
  const options = parseArgs(argv);
  if (options.help || !options.name) {
    printHelp();
    if (!options.help && !options.name) process.exit(1);
    return;
  }
  if (!TAPE_NAMES.includes(options.name)) {
    console.error(`Unknown demo: ${options.name}. Valid: ${TAPE_NAMES.join(', ')}`);
    process.exit(1);
  }
  if (!FORMATS.includes(options.format)) {
    console.error(`Unknown format: ${options.format}. Valid: ${FORMATS.join(', ')}`);
    process.exit(1);
  }

  const recorder = options.sourceOnly ? null : locateRecorder();

  const dir = options.out ? dirname(resolve(cwd, options.out)) : join(cwd, '.cx', 'demos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const baseName = options.out
    ? resolve(cwd, options.out).replace(/\.[^./]+$/, '')
    : join(dir, `${options.name}-${timestamp()}`);

  // asciinema emits .cast; VHS emits the requested image format. The Output
  // directive baked into the tape must match the artifact VHS will write.

  const artifactExt = recorder?.engine === 'asciinema' ? 'cast' : options.format;
  const artifactPath = `${baseName}.${artifactExt}`;
  const tapeSource = generateTape(options.name, artifactPath);
  const tapePath = `${baseName}.tape`;
  writeFileSync(tapePath, tapeSource, 'utf8');

  if (!recorder) {
    console.log(`Demo tape (${options.name}) written to:`);
    console.log(`  ${tapePath}`);
    console.log(`\nNo terminal recorder found. To produce a recording, install one:`);
    console.log(`  ${installHint()}`);
    console.log(`\nThen: vhs "${tapePath}"`);
    return;
  }

  const render = recorder.engine === 'vhs'
    ? renderWithVhs(recorder.binary, tapePath)
    : renderWithAsciinema(recorder.binary, tapeSource, artifactPath);

  if (render.status === 0 && existsSync(artifactPath)) {
    console.log(`Demo (${options.name}) recorded via ${recorder.engine} to:`);
    console.log(`  ${artifactPath}`);
    console.log(`Tape: ${tapePath}`);
    return;
  }

  console.log(`Demo tape written to:`);
  console.log(`  ${tapePath}`);
  console.log(`\nRecorder ${recorder.engine} failed (exit ${render.status}); tape preserved.`);
  if (render.stderr) console.log(`  ${render.stderr.trim().split('\n').slice(0, 3).join('\n  ')}`);
}
