/**
 * lib/diagram.mjs — `construct diagram` command, generates code-driven
 * architecture/flow diagrams from a natural-language description and renders
 * them to SVG/PNG via an external diagram binary, degrading to source-only
 * output when no renderer is installed.
 *
 * Tool evaluation (2026-06), against: visual distinctiveness, reproducible
 * from code, headless Node/CI SVG+PNG render, theming, license:
 *   - D2 (terrastruct, MPL-2.0): single self-contained Go binary, distinctive
 *     sketch look plus first-class themes, headless `d2 in.d2 out.svg|png`,
 *     deterministic from a text file. Chosen as PRIMARY for visual
 *     distinctiveness and one-binary install.
 *   - Graphviz `dot` (EPL-1.0): ubiquitous, almost always already present on
 *     CI images and dev machines, headless `dot -Tsvg|-Tpng`. Chosen as
 *     FALLBACK for reach when D2 is absent.
 *   - Mermaid: renders natively in many viewers but headless image export
 *     needs mermaid-cli, which pulls a headless-Chromium npm tree — disallowed
 *     by ADR-0001 (zero-npm-core). Used only as the SOURCE we emit when no
 *     binary is present, reusing lib/wireframe.mjs's Mermaid generators so the
 *     description still yields a viewable diagram in GitHub/Notion/OpenCode.
 *
 * Degradation contract: when neither D2 nor dot is on PATH the command still
 * succeeds (exit 0) by writing the diagram SOURCE (.d2 by default, or .mmd
 * Mermaid for diagram kinds wireframe.mjs already models) plus an install
 * hint. No bundled binaries, no npm dependencies; renderers are detected at
 * runtime, mirroring lib/runtime/whisper-bootstrap.mjs.
 *
 * Output: .cx/diagrams/<slug>-<ts>.<ext>.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

import { generateWireframe } from './wireframe.mjs';

const TYPES = ['architecture', 'flow', 'sequence', 'state', 'er', 'class'];
const FORMATS = ['svg', 'png'];

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'diagram';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

// Renderer detection follows the optional-external-tool pattern: probe PATH,
// return a structured descriptor, never throw. D2 is preferred for its
// distinctive look; dot is the ubiquitous fallback.

export function locateRenderer() {
  const d2 = which('d2');
  if (d2) return { engine: 'd2', binary: d2, sourceExt: 'd2' };
  const dot = which('dot');
  if (dot) return { engine: 'dot', binary: dot, sourceExt: 'dot' };
  return null;
}

export function installHint() {
  if (process.platform === 'darwin') return 'brew install d2   (or: brew install graphviz)';
  if (process.platform === 'linux') return 'curl -fsSL https://d2lang.com/install.sh | sh   (or install graphviz via your distro)';
  return 'See https://d2lang.com/tour/install or https://graphviz.org/download/';
}

function inferType(description, explicit) {
  if (explicit) return explicit;
  const text = String(description || '').toLowerCase();
  if (/\b(sequence|handshake|request|response|api call)\b/.test(text)) return 'sequence';
  if (/\b(state|status|transition|machine|lifecycle)\b/.test(text)) return 'state';
  if (/\b(entity|schema|database|table|relationship|foreign key)\b/.test(text)) return 'er';
  if (/\b(class|inheritance|interface)\b/.test(text)) return 'class';
  if (/\b(flow|funnel|step|decision|process)\b/.test(text)) return 'flow';
  return 'architecture';
}

// Parse `a -> b -> c` (or `a → b → c`) chains out of the description so a
// terse architecture prompt produces a real edge graph rather than a single
// node. Falls back to treating the whole description as one node.

function parseNodes(description) {
  const text = String(description || '');
  const arrowSplit = text.split(/\s*(?:->|→|=>)\s*/).map((s) => s.trim()).filter(Boolean);
  if (arrowSplit.length >= 2) {
    const stripped = arrowSplit.map((s) => s.replace(/^[a-z0-9\s]*:\s*/i, '').trim() || s);
    return stripped.map((label) => label.split(/[,/]/)[0].trim()).filter(Boolean);
  }
  return [];
}

function nodeId(label, index) {
  const id = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return id || `n${index}`;
}

function d2Source(description, nodes) {
  const header = `# ${description}\n# D2 source — render: d2 this.d2 out.svg  (https://d2lang.com)\n`;
  if (nodes.length >= 2) {
    const lines = nodes.map((label, i) => `${nodeId(label, i)}: ${label}`);
    for (let i = 0; i < nodes.length - 1; i += 1) {
      lines.push(`${nodeId(nodes[i], i)} -> ${nodeId(nodes[i + 1], i + 1)}`);
    }
    return `${header}${lines.join('\n')}\n`;
  }
  return `${header}node: ${description || 'Component'}\n`;
}

function dotSource(description, nodes) {
  const header = `// ${description}\n// Graphviz DOT source — render: dot -Tsvg this.dot -o out.svg\n`;
  const body = [];
  if (nodes.length >= 2) {
    nodes.forEach((label, i) => body.push(`  ${nodeId(label, i)} [label="${label}"];`));
    for (let i = 0; i < nodes.length - 1; i += 1) {
      body.push(`  ${nodeId(nodes[i], i)} -> ${nodeId(nodes[i + 1], i + 1)};`);
    }
  } else {
    body.push(`  node [label="${description || 'Component'}"];`);
  }
  return `${header}digraph G {\n  rankdir=LR;\n${body.join('\n')}\n}\n`;
}

// For diagram kinds wireframe.mjs already models (flow/sequence/state/er) we
// reuse its Mermaid generators when emitting source-only output, so the
// description maps to a richer diagram than a bare D2 chain.

const WIREFRAME_KINDS = { flow: 'flow', sequence: 'sequence', state: 'state', er: 'er' };

export function generateDiagram({ description = '', type = null, theme = null } = {}) {
  const kind = inferType(description, type);
  const nodes = parseNodes(description);

  let source;
  let engineHint;
  if (nodes.length >= 2 || kind === 'architecture' || kind === 'class') {
    source = d2Source(description, nodes);
    engineHint = 'd2';
  } else {
    const wf = generateWireframe({ description, type: WIREFRAME_KINDS[kind] || 'flow' });
    source = wf.content;
    engineHint = 'mermaid';
  }
  return { kind, nodes, source, engineHint, theme };
}

// Render via the detected binary. D2 themes map to numeric ids; an invalid
// theme name is ignored rather than failing the render. Returns the render
// result so the caller can fall back to source-only on any non-zero exit.

function renderWithD2(binary, sourcePath, outPath, { format, theme }) {
  const args = [];
  if (theme) {
    const themeId = D2_THEMES[theme.toLowerCase()];
    if (themeId != null) args.push('--theme', String(themeId));
  }
  args.push(sourcePath, outPath);
  return spawnSync(binary, args, { encoding: 'utf8', timeout: 60_000 });
}

const D2_THEMES = {
  neutral: 0,
  'neutral-grey': 1,
  'flagship-terrastruct': 3,
  'cool-classics': 4,
  'mixed-berry-blue': 5,
  'grape-soda': 6,
  aubergine: 7,
  'colorblind-clear': 8,
  'vanilla-nitro-cola': 100,
  'orange-creamsicle': 101,
  sketch: 200,
};

function renderWithDot(binary, sourcePath, outPath, { format }) {
  return spawnSync(binary, [`-T${format}`, sourcePath, '-o', outPath], { encoding: 'utf8', timeout: 60_000 });
}

export function printHelp() {
  console.log(`Usage: construct diagram <description> [options]

Generates a code-driven diagram from a description and renders it to SVG/PNG
via D2 (primary) or Graphviz dot (fallback). When neither renderer is
installed, writes the diagram SOURCE plus an install hint and exits 0.

Options:
  --type <t>     architecture (default) | flow | sequence | state | er | class
  --format <f>   svg (default) | png
  --theme <name> D2 theme name (e.g. neutral, sketch, cool-classics)
  --out <path>   Output path (default: .cx/diagrams/<slug>-<ts>.<ext>)
  --source-only  Always write the source file; skip rendering
  -h, --help     Show this message

Renderers (detected at runtime, never bundled):
  D2     ${process.platform === 'darwin' ? 'brew install d2' : 'https://d2lang.com/tour/install'}
  dot    ${process.platform === 'darwin' ? 'brew install graphviz' : 'https://graphviz.org/download/'}

Examples:
  construct diagram "web app: client -> api -> db"
  construct diagram "auth flow" --type flow
  construct diagram "client -> api -> db" --format png --theme sketch
`);
}

function parseArgs(argv) {
  const options = { type: null, format: 'svg', theme: null, out: null, sourceOnly: false, description: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--source-only') { options.sourceOnly = true; continue; }
    if (arg === '--type') { options.type = argv[++i]; continue; }
    if (arg.startsWith('--type=')) { options.type = arg.slice(7); continue; }
    if (arg === '--format') { options.format = argv[++i]; continue; }
    if (arg.startsWith('--format=')) { options.format = arg.slice(9); continue; }
    if (arg === '--theme') { options.theme = argv[++i]; continue; }
    if (arg.startsWith('--theme=')) { options.theme = arg.slice(8); continue; }
    if (arg === '--out') { options.out = argv[++i]; continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice(6); continue; }
    options.description.push(arg);
  }
  options.description = options.description.join(' ').trim();
  return options;
}

export async function runDiagramCli(argv = [], { cwd = process.cwd() } = {}) {
  const options = parseArgs(argv);
  if (options.help || !options.description) {
    printHelp();
    if (!options.help && !options.description) process.exit(1);
    return;
  }
  if (options.type && !TYPES.includes(options.type)) {
    console.error(`Unknown type: ${options.type}. Valid: ${TYPES.join(', ')}`);
    process.exit(1);
  }
  if (!FORMATS.includes(options.format)) {
    console.error(`Unknown format: ${options.format}. Valid: ${FORMATS.join(', ')}`);
    process.exit(1);
  }

  const result = generateDiagram({ description: options.description, type: options.type, theme: options.theme });
  const renderer = options.sourceOnly ? null : locateRenderer();

  const slug = slugify(options.description);
  const dir = options.out ? dirname(resolve(cwd, options.out)) : join(cwd, '.cx', 'diagrams');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Source is always written. When the source is Mermaid (reused wireframe
  // output) the .d2/.dot renderers can't consume it, so we keep the source
  // extension honest and skip the binary render in that case.

  const renderableSource = result.engineHint !== 'mermaid';
  const sourceExt = result.engineHint === 'mermaid' ? 'md' : (renderer ? renderer.sourceExt : 'd2');
  const baseName = options.out
    ? resolve(cwd, options.out).replace(/\.[^./]+$/, '')
    : join(dir, `${slug}-${timestamp()}`);
  const sourcePath = `${baseName}.${sourceExt}`;

  let source = result.source;
  if (renderer && renderableSource) {
    source = renderer.engine === 'dot' ? dotSource(options.description, result.nodes) : d2Source(options.description, result.nodes);
  }
  writeFileSync(sourcePath, source, 'utf8');

  if (!renderer || !renderableSource) {
    console.log(`Diagram source (${result.kind}, ${result.engineHint}) written to:`);
    console.log(`  ${sourcePath}`);
    if (!renderer) {
      console.log(`\nNo diagram renderer found. To render SVG/PNG, install one:`);
      console.log(`  ${installHint()}`);
    } else {
      console.log(`\nThis diagram kind renders as Mermaid; paste into any Mermaid-aware viewer (GitHub, Notion, OpenCode).`);
    }
    return;
  }

  const outPath = `${baseName}.${options.format}`;
  const render = renderer.engine === 'd2'
    ? renderWithD2(renderer.binary, sourcePath, outPath, { format: options.format, theme: options.theme })
    : renderWithDot(renderer.binary, sourcePath, outPath, { format: options.format });

  if (render.status === 0 && existsSync(outPath)) {
    console.log(`Diagram (${result.kind}) rendered via ${renderer.engine} to:`);
    console.log(`  ${outPath}`);
    console.log(`Source: ${sourcePath}`);
    return;
  }

  console.log(`Diagram source written to:`);
  console.log(`  ${sourcePath}`);
  console.log(`\nRenderer ${renderer.engine} failed (exit ${render.status}); source preserved.`);
  if (render.stderr) console.log(`  ${render.stderr.trim().split('\n').slice(0, 3).join('\n  ')}`);
}
