/**
 * lib/demo.mjs — `construct demo` terminal recordings via VHS `.tape` files.
 *
 * Shipped tapes live in templates/demos/tapes/; project overrides in
 * .cx/demos/tapes/. Built-in scaffolds via `construct demo init --from=`.
 * Default run mode launches construct chat with a demo script; use `record` or
 * --surface=tape for VHS. Dashboard demos delegate to lib/dashboard-demo.mjs.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDemoScripts } from './demo-script.mjs';
import { DEMO_SURFACES } from './demo-surface.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FORMATS = ['gif', 'mp4', 'webm'];

const TAPE_TEMPLATES = {
  quickstart: (out) => `Require node
Require vhs
# construct demo: quickstart — plan then build
Output ${out}
Set FontSize 18
Set Width 1100
Set Height 600
Set Theme "Dracula"
Set TypingSpeed 60ms

Type "node bin/construct plan 'add a rate limiter to the API'"
Sleep 500ms
Enter
Sleep 2s

Type "node bin/construct build"
Sleep 500ms
Enter
Sleep 2s

Type "node bin/construct ship status"
Sleep 500ms
Enter
Sleep 2s
`,
  diagram: (out) => `Require node
Require vhs
# construct demo: diagram — render an architecture diagram
Output ${out}
Set FontSize 18
Set Width 1100
Set Height 600
Set Theme "Dracula"
Set TypingSpeed 60ms

Type "node bin/construct diagram 'web app: client -> api -> db'"
Sleep 500ms
Enter
Sleep 2s
`,
};

export const TAPE_TEMPLATE_NAMES = Object.keys(TAPE_TEMPLATES);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

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

export function tapesDir(cwd) {
  return join(cwd, '.cx', 'demos', 'tapes');
}

export function tapeSearchDirs({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  return [
    tapesDir(cwd),
    join(repoRoot, 'templates', 'demos', 'tapes'),
  ];
}

export function resolveTapeFile(name, { cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  for (const dir of tapeSearchDirs({ cwd, repoRoot })) {
    const candidate = join(dir, `${name}.tape`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function projectTapePath(cwd, name) {
  return join(tapesDir(cwd), `${name}.tape`);
}

export function listProjectTapes({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const seen = new Set();
  const out = [];
  for (const dir of tapeSearchDirs({ cwd, repoRoot })) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tape')).sort()) {
      const name = basename(file, '.tape');
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out.sort();
}

export function resolveTapeSource(name, { cwd, repoRoot = REPO_ROOT, artifactPath } = {}) {
  if (name.startsWith('dashboard:')) {
    return { kind: 'dashboard', name: name.slice('dashboard:'.length) };
  }

  const tapePath = resolveTapeFile(name, { cwd, repoRoot });
  if (tapePath) {
    let source = readFileSync(tapePath, 'utf8');
    if (artifactPath && /^Output\s+/m.test(source)) {
      source = source.replace(/^Output\s+.+$/m, `Output ${artifactPath}`);
    }
    const shippedDir = join(resolve(repoRoot), 'templates', 'demos', 'tapes');
    const from = tapePath.startsWith(shippedDir) ? 'shipped' : 'project';
    return { kind: 'terminal', name, source, tapePath, from };
  }

  const builder = TAPE_TEMPLATES[name];
  if (builder) {
    const output = artifactPath || join(cwd, '.cx', 'demos', `${name}.mp4`);
    return { kind: 'terminal', name, source: builder(output), from: 'template' };
  }

  return null;
}

export function initProjectTape(name, { cwd, from = 'quickstart' } = {}) {
  const builder = TAPE_TEMPLATES[from];
  if (!builder) return { ok: false, message: `Unknown template: ${from}. Valid: ${TAPE_TEMPLATE_NAMES.join(', ')}` };
  const dir = tapesDir(cwd);
  mkdirSync(dir, { recursive: true });
  const tapePath = projectTapePath(cwd, name);
  if (existsSync(tapePath)) return { ok: false, message: `Tape already exists: ${tapePath}` };
  const placeholderOut = `.cx/demos/${name}.mp4`;
  writeFileSync(tapePath, builder(placeholderOut), 'utf8');
  return { ok: true, tapePath, message: `Scaffolded ${tapePath}` };
}

function renderWithVhs(binary, tapePath) {
  return spawnSync(binary, [tapePath], { encoding: 'utf8', timeout: 180_000 });
}

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

function parseTapeOutput(source) {
  const match = source.match(/^Output\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function resolveOutputPath(outputLine, cwd) {
  if (!outputLine) return null;
  return resolve(cwd, outputLine);
}

function tapeOutputLine(artifactPath, cwd) {
  const rel = relative(cwd, artifactPath);
  return rel && !rel.startsWith('..') ? rel : artifactPath;
}

export function runDemoRecord(name, {
  cwd = process.cwd(),
  repoRoot = REPO_ROOT,
  format = 'gif',
  out = null,
  sourceOnly = false,
  required = false,
} = {}) {
  if (name.startsWith('dashboard:')) {
    return { ok: false, name, message: 'Use recordDashboardDemo for dashboard: demos' };
  }

  if (!FORMATS.includes(format)) {
    return { ok: false, name, message: `Unknown format: ${format}` };
  }

  const dir = out ? dirname(resolve(cwd, out)) : join(cwd, '.cx', 'demos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const resolved = resolveTapeSource(name, { cwd, repoRoot });
  if (!resolved || resolved.kind !== 'terminal') {
    return {
      ok: false,
      name,
      required,
      message: `Unknown demo: ${name}. Run \`construct demo list\` or \`construct demo init ${name}\`.`,
    };
  }

  const recorder = sourceOnly ? null : locateRecorder();
  const artifactExt = recorder?.engine === 'asciinema' ? 'cast' : format;
  const tapedOutput = parseTapeOutput(resolved.source);
  const ephemeralSource = resolved.from === 'template' || resolved.from === 'shipped';

  let artifactPath;
  if (out) {
    const base = resolve(cwd, out).replace(/\.[^./]+$/, '');
    artifactPath = `${base}.${artifactExt}`;
  } else if (tapedOutput && resolved.from !== 'template') {
    artifactPath = resolveOutputPath(tapedOutput, cwd);
  } else {
    const baseName = join(dir, `${name}-${timestamp()}`);
    artifactPath = `${baseName}.${artifactExt}`;
  }

  let tapePath = resolved.from === 'project' ? resolved.tapePath : join(dir, `${name}-${timestamp()}.tape`);
  const expectedFromTape = tapedOutput ? resolveOutputPath(tapedOutput, cwd) : null;
  const needsTempTape = ephemeralSource
    || out
    || (resolved.from === 'project' && expectedFromTape && artifactPath !== expectedFromTape);

  if (needsTempTape) {
    const source = resolved.source.replace(/^Output\s+.+$/m, `Output ${tapeOutputLine(artifactPath, cwd)}`);
    if (resolved.from === 'project') {
      tapePath = join(dir, `${name}-render-${timestamp()}.tape`);
    }
    writeFileSync(tapePath, source, 'utf8');
  }

  if (!recorder) {
    if (ephemeralSource) {
      console.log(`Demo tape (${name}) written to: ${tapePath}`);
    }
    return {
      ok: true,
      name,
      sourceOnly: true,
      tapePath: resolved.from === 'project' ? resolved.tapePath : tapePath,
      message: installHint(),
    };
  }

  const render = recorder.engine === 'vhs'
    ? renderWithVhs(recorder.binary, tapePath)
    : renderWithAsciinema(recorder.binary, resolved.source, artifactPath);

  if (render.status === 0 && existsSync(artifactPath)) {
    return { ok: true, name, tapePath, artifactPath, engine: recorder.engine };
  }

  return {
    ok: !required,
    name,
    required,
    tapePath,
    message: `Recorder ${recorder.engine} failed (exit ${render.status})`,
  };
}

export function printHelp() {
  const templates = TAPE_TEMPLATE_NAMES.join(', ');
  const surfaces = DEMO_SURFACES.join(' | ');
  console.log(`Usage: construct demo <command|name> [options]

Commands:
  list                     List project tapes and demo scripts
  init <name> [--from=T]     Scaffold a VHS tape (templates: ${templates})
  record <name>              Record a VHS/asciinema terminal demo
  <name>                     Run guided demo (default: construct chat)

Default run uses construct chat with a demo script (templates/demos/scripts/).
Falls back to web chat, VHS tape, dashboard, or printed steps when unavailable.

Options:
  --surface=<s>  chat (default) | web | tape | dashboard
  --model <id>   Pin model for chat demo
  --web          Open web chat (/chat/) instead of terminal
  --plain        Linear chat renderer
  --free         OpenRouter free-router mode
  --format <f>   gif (default) | mp4 | webm (tape surface only)
  --out <path>   Output path (tape recording)
  --source-only  Tape: write .tape only; skip recording
  -h, --help     Show this message

Examples:
  construct demo agentic-platforms-prd
  construct demo agentic-platforms-prd --surface=web
  construct demo record agentic-platforms-prd --format mp4
  construct demo dashboard:cockpit-tour
`);
}

function parseArgs(argv) {
  const options = {
    format: 'gif',
    out: null,
    sourceOnly: false,
    from: 'quickstart',
    command: null,
    name: null,
    surface: 'chat',
    model: null,
    plain: false,
    accessible: false,
    web: false,
    free: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--source-only') { options.sourceOnly = true; continue; }
    if (arg === '--plain') { options.plain = true; continue; }
    if (arg === '--accessible') { options.accessible = true; continue; }
    if (arg === '--web') { options.web = true; continue; }
    if (arg === '--free') { options.free = true; continue; }
    if (arg === '--format') { options.format = argv[++i]; continue; }
    if (arg.startsWith('--format=')) { options.format = arg.slice(9); continue; }
    if (arg === '--out') { options.out = argv[++i]; continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice(6); continue; }
    if (arg === '--from') { options.from = argv[++i]; continue; }
    if (arg.startsWith('--from=')) { options.from = arg.slice(7); continue; }
    if (arg === '--surface') { options.surface = argv[++i]; continue; }
    if (arg.startsWith('--surface=')) { options.surface = arg.slice(10); continue; }
    if (arg === '--model') { options.model = argv[++i]; continue; }
    if (arg.startsWith('--model=')) { options.model = arg.slice(8); continue; }
    positional.push(arg);
  }
  if (positional[0] === 'list') options.command = 'list';
  else if (positional[0] === 'init') { options.command = 'init'; options.name = positional[1]; }
  else if (positional[0] === 'record') { options.command = 'record'; options.name = positional[1]; }
  else options.name = positional[0] || null;
  return options;
}

export async function runDemoCli(argv = [], { cwd = process.cwd(), repoRoot } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  if (options.command === 'list') {
    const tapes = listProjectTapes({ cwd, repoRoot });
    const scripts = listDemoScripts({ cwd, repoRoot });
    console.log('Demo tapes (project .cx/demos/tapes/ overrides templates/demos/tapes/):');
    if (!tapes.length) console.log('  (none — run `construct demo init <name>`)');
    else for (const t of tapes) console.log(`  ${t}`);
    console.log('\nDemo scripts (chat-guided; templates/demos/scripts/):');
    if (!scripts.length) console.log('  (none)');
    else for (const s of scripts) console.log(`  ${s}`);
    console.log(`\nScaffold templates: ${TAPE_TEMPLATE_NAMES.join(', ')}`);
    return;
  }

  if (options.command === 'init') {
    if (!options.name) {
      console.error('Usage: construct demo init <name> [--from=quickstart|diagram]');
      process.exit(1);
    }
    const result = initProjectTape(options.name, { cwd, from: options.from });
    if (!result.ok) {
      console.error(result.message);
      process.exit(1);
    }
    console.log(result.message);
    return;
  }

  const demoName = options.command === 'record' ? options.name : options.name;
  if (!demoName) {
    printHelp();
    process.exit(1);
  }

  if (demoName.startsWith('dashboard:')) {
    const { recordDashboardDemo } = await import('./dashboard-demo.mjs');
    const result = recordDashboardDemo(demoName.slice('dashboard:'.length), { cwd, repoRoot });
    if (!result.ok) {
      console.error(result.message);
      process.exit(result.missing?.length ? 2 : 1);
    }
    console.log(result.message);
    for (const v of result.videos || []) console.log(`  ${v}`);
    return;
  }

  const useTape = options.command === 'record' || options.surface === 'tape';
  if (useTape) {
    const result = runDemoRecord(demoName, {
      cwd,
      format: options.format,
      out: options.out,
      sourceOnly: options.sourceOnly,
    });

    if (!result.ok) {
      console.error(result.message);
      process.exit(1);
    }

    if (result.artifactPath) {
      console.log(`Demo (${demoName}) recorded via ${result.engine} to:`);
      console.log(`  ${result.artifactPath}`);
      console.log(`Tape: ${result.tapePath}`);
    } else if (result.tapePath) {
      console.log(`Demo tape (${demoName}): ${result.tapePath}`);
      if (result.message) console.log(`\nNo recorder: ${result.message}`);
    }
    return;
  }

  const { runDemoGuided } = await import('./demo-surface.mjs');
  const result = await runDemoGuided(demoName, {
    cwd,
    repoRoot,
    surface: options.surface,
    format: options.format,
    out: options.out,
    sourceOnly: options.sourceOnly,
    model: options.model,
    plain: options.plain,
    accessible: options.accessible,
    web: options.web,
    free: options.free,
  });

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  if (result.notices?.length) {
    for (const n of result.notices) console.error(`note: ${n}`);
  }
  if (result.surface === 'chat' || result.surface === 'web') {
    return;
  }
  if (result.artifactPath) {
    console.log(`Demo (${demoName}) [${result.surface}] recorded to:`);
    console.log(`  ${result.artifactPath}`);
  } else if (result.message) {
    console.log(result.message);
  }
}

// Legacy exports for tests
export const TAPE_NAMES = TAPE_TEMPLATE_NAMES;
export function generateTape(name, outputArtifact) {
  const builder = TAPE_TEMPLATES[name];
  return builder ? builder(outputArtifact) : null;
}
