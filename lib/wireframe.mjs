/**
 * lib/wireframe.mjs — `construct wireframe` command, generates Mermaid
 * diagrams and low-fidelity HTML wireframes from a natural-language prompt.
 *
 * Honest design: this is a scaffold generator, not a model-backed visual
 * synthesis engine. It picks a template appropriate to the detected
 * diagram kind, seeds it with keywords extracted from the prompt, and
 * writes to `.cx/wireframes/<slug>-<ts>.<ext>`. A specialist (cx-designer)
 * or the user can then refine the generated file.
 *
 * Modern best practices honored:
 *   - Low-fi sketch look for HTML wireframes (the point of a wireframe is
 *     to delay visual-polish commitment; sketch styles signal "not final")
 *   - Semantic HTML5 landmarks, accessible labels, keyboard order
 *   - Mermaid diagrams for flows/states/sequences/ER — widely rendered by
 *     OpenCode, Claude Code, GitHub, Notion, etc.
 *   - Zero external dependencies; bundled sketch CSS inlined
 *   - Output is text — review-able in PRs, diff-able, version-controllable
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TYPES = ['flow', 'state', 'sequence', 'er', 'layout', 'user-journey'];

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'wireframe';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function inferType(description, explicit) {
  if (explicit) return explicit;
  const text = String(description || '').toLowerCase();
  if (/\b(screen|page|layout|ui|view|dashboard|form|modal|list|detail)\b/.test(text)) return 'layout';
  if (/\b(state|status|transition|machine)\b/.test(text)) return 'state';
  if (/\b(sequence|handshake|request|response|api call|interaction between)\b/.test(text)) return 'sequence';
  if (/\b(entity|schema|database|table|relationship|foreign key)\b/.test(text)) return 'er';
  if (/\b(journey|persona|step-by-step|onboarding|funnel)\b/.test(text)) return 'user-journey';
  return 'flow';
}

// Stopwords that don't make good node labels.
const STOP = new Set([
  'a','an','the','of','to','for','with','from','in','on','and','or','but',
  'is','are','was','were','be','been','being','has','have','had','do','does','did',
  'this','that','these','those','i','we','you','they','he','she','it',
  'my','our','your','their','his','her','its','me','us',
  'please','build','create','design','make','show','draw','generate','wireframe','diagram',
  'flow','layout','screen','page','view',
]);

function extractKeywords(description, max = 8) {
  const words = String(description || '')
    .split(/[^a-zA-Z0-9_-]+/)
    .filter(Boolean)
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  const seen = new Set();
  const result = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(w);
    if (result.length >= max) break;
  }
  return result;
}

function mermaidFlow(description, keywords) {
  const nodes = keywords.length > 0 ? keywords : ['Start', 'Step', 'End'];
  const lines = ['graph TD'];
  const ids = nodes.map((_, i) => String.fromCharCode(65 + i));
  nodes.forEach((n, i) => lines.push(`  ${ids[i]}[${n}]`));
  for (let i = 0; i < ids.length - 1; i += 1) {
    lines.push(`  ${ids[i]} --> ${ids[i + 1]}`);
  }
  return `%% ${description}\n%% Refine nodes, add decision diamonds (C{...}), and label edges.\n${lines.join('\n')}`;
}

function mermaidState(description, keywords) {
  const states = keywords.length > 0 ? keywords.slice(0, 5) : ['Idle', 'Active', 'Done'];
  const lines = ['stateDiagram-v2', '  [*] --> ' + states[0]];
  for (let i = 0; i < states.length - 1; i += 1) {
    lines.push(`  ${states[i]} --> ${states[i + 1]}`);
  }
  lines.push(`  ${states[states.length - 1]} --> [*]`);
  return `%% ${description}\n%% Add guards, actions, and error transitions.\n${lines.join('\n')}`;
}

function mermaidSequence(description, keywords) {
  const actors = keywords.length >= 2 ? keywords.slice(0, 3) : ['User', 'System', 'Service'];
  const lines = ['sequenceDiagram'];
  actors.forEach((a) => lines.push(`  participant ${a}`));
  for (let i = 0; i < actors.length - 1; i += 1) {
    lines.push(`  ${actors[i]}->>${actors[i + 1]}: request`);
    lines.push(`  ${actors[i + 1]}-->>${actors[i]}: response`);
  }
  return `%% ${description}\n%% Replace generic labels with the real message contracts.\n${lines.join('\n')}`;
}

function mermaidER(description, keywords) {
  const entities = keywords.length >= 2 ? keywords.slice(0, 3) : ['User', 'Session', 'Document'];
  const lines = ['erDiagram'];
  for (let i = 0; i < entities.length - 1; i += 1) {
    lines.push(`  ${entities[i]} ||--o{ ${entities[i + 1]} : has`);
  }
  entities.forEach((e) => {
    lines.push(`  ${e} {`);
    lines.push(`    string id PK`);
    lines.push(`    string name`);
    lines.push(`  }`);
  });
  return `%% ${description}\n%% Replace placeholder fields with real attributes and cardinality.\n${lines.join('\n')}`;
}

function mermaidUserJourney(description, keywords) {
  const steps = keywords.length >= 2 ? keywords.slice(0, 5) : ['Discover', 'Evaluate', 'Try', 'Adopt'];
  const lines = ['journey', `  title ${description || 'User Journey'}`];
  lines.push('  section Onboarding');
  steps.forEach((s, i) => {
    const score = [3, 4, 5, 4, 3][i] ?? 3;
    lines.push(`    ${s}: ${score}: User`);
  });
  return `%% Refine step scores (1–5) and split into meaningful sections.\n${lines.join('\n')}`;
}

// --- HTML layout wireframe -------------------------------------------------

const SKETCH_CSS = `
:root {
  --ink: #222;
  --paper: #fefdf8;
  --rough: #6b6b6b;
  --hint: #a9a9a9;
  --accent: #2c5282;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem;
  font-family: "Caveat", "Bradley Hand", "Comic Sans MS", cursive;
  background: var(--paper);
  color: var(--ink);
  line-height: 1.4;
}
.wireframe { max-width: 1200px; margin: 0 auto; }
.wireframe header, .wireframe nav, .wireframe main,
.wireframe aside, .wireframe section, .wireframe footer,
.block, .card {
  border: 2px solid var(--ink);
  border-radius: 6px;
  padding: 1rem;
  margin: 0.5rem 0;
  position: relative;
  background: var(--paper);
  box-shadow: 3px 3px 0 var(--hint);
}
.wireframe header { background: #f3f0e7; }
.label {
  position: absolute; top: -10px; left: 10px;
  background: var(--paper); padding: 0 6px;
  font-size: 0.85em; color: var(--rough);
  font-family: ui-monospace, Menlo, monospace;
}
.row { display: grid; grid-template-columns: repeat(var(--cols, 3), 1fr); gap: 1rem; }
.row-2 { --cols: 2; }
.row-3 { --cols: 3; }
.row-4 { --cols: 4; }
.sidebar-layout { display: grid; grid-template-columns: 240px 1fr; gap: 1rem; }
.placeholder {
  min-height: 60px;
  background: repeating-linear-gradient(
    45deg, transparent, transparent 8px,
    #eee 8px, #eee 9px
  );
  border: 1px dashed var(--rough);
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--rough); font-size: 0.9em;
}
button, .btn {
  font-family: inherit;
  border: 2px solid var(--ink);
  background: var(--paper);
  padding: 0.5rem 1rem;
  border-radius: 4px;
  box-shadow: 2px 2px 0 var(--hint);
  cursor: pointer;
}
button:hover { background: #f3f0e7; }
input, textarea, select {
  font-family: inherit;
  border: 2px solid var(--ink);
  background: var(--paper);
  padding: 0.4rem;
  border-radius: 4px;
  width: 100%;
}
h1, h2, h3 { margin: 0.25rem 0 0.5rem; }
.note {
  background: #fff9c4; border: 1px dashed #c0b03f;
  padding: 0.5rem 0.75rem; border-radius: 4px;
  font-size: 0.9em;
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #e8e8e8; --paper: #1e1e1e; --rough: #9a9a9a; --hint: #4a4a4a; }
  .wireframe header { background: #2a2a2a; }
  .placeholder { background: repeating-linear-gradient(45deg, transparent, transparent 8px, #333 8px, #333 9px); }
  button:hover { background: #2a2a2a; }
  .note { background: #3a3520; color: #f0e68c; border-color: #5a5230; }
}
`;

function htmlLayout(description, keywords) {
  const title = description || 'Untitled wireframe';
  const sections = keywords.length > 0 ? keywords : ['Main content', 'Related items', 'Actions'];
  const cards = sections.slice(0, 4).map((s) => `
          <div class="block">
            <span class="label">${s}</span>
            <h3>${s}</h3>
            <div class="placeholder">Content placeholder</div>
          </div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Wireframe: ${escapeHtml(title)}</title>
  <style>${SKETCH_CSS}</style>
</head>
<body>
  <div class="wireframe" role="document">
    <p class="note"><strong>Wireframe (low-fi).</strong> ${escapeHtml(description)}</p>

    <header role="banner">
      <span class="label">header</span>
      <h1>${escapeHtml(title)}</h1>
      <p>Primary nav / logo / global actions go here.</p>
    </header>

    <nav role="navigation" aria-label="primary">
      <span class="label">nav</span>
      <div class="row row-4">
        <a href="#">Nav 1</a>
        <a href="#">Nav 2</a>
        <a href="#">Nav 3</a>
        <a href="#">Nav 4</a>
      </div>
    </nav>

    <div class="sidebar-layout">
      <aside role="complementary">
        <span class="label">sidebar</span>
        <h3>Filters</h3>
        <div class="placeholder">Filter / facet list</div>
      </aside>

      <main role="main">
        <span class="label">main</span>
        <div class="row row-2">${cards}
        </div>
      </main>
    </div>

    <footer role="contentinfo">
      <span class="label">footer</span>
      <div class="row row-3">
        <div>Links</div>
        <div>Legal</div>
        <div>Contact</div>
      </div>
    </footer>
  </div>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapMermaidInMd(description, mermaid, type) {
  return `# Wireframe — ${description || type}

Type: ${type}
Generated: ${new Date().toISOString()}

\`\`\`mermaid
${mermaid}
\`\`\`

## Next steps

- Refine node/edge labels to match the actual domain
- Add decision branches, error states, and guard conditions
- Commit the file once it reflects the real flow; treat it as part of the
  architecture record, not a throwaway sketch
`;
}

export function generateWireframe({ description = '', type = null } = {}) {
  const inferred = inferType(description, type);
  const keywords = extractKeywords(description);

  if (inferred === 'layout') {
    return {
      type: 'layout',
      format: 'html',
      content: htmlLayout(description, keywords),
      extension: 'html',
    };
  }

  let mermaid;
  switch (inferred) {
    case 'state':        mermaid = mermaidState(description, keywords); break;
    case 'sequence':     mermaid = mermaidSequence(description, keywords); break;
    case 'er':           mermaid = mermaidER(description, keywords); break;
    case 'user-journey': mermaid = mermaidUserJourney(description, keywords); break;
    case 'flow':
    default:             mermaid = mermaidFlow(description, keywords); break;
  }
  return {
    type: inferred,
    format: 'mermaid',
    content: wrapMermaidInMd(description, mermaid, inferred),
    extension: 'md',
  };
}

export function printHelp() {
  console.log(`Usage: construct wireframe <description> [options]

Generates a low-fidelity wireframe from a description. Auto-detects the
best format (Mermaid diagram or HTML sketch) based on the description,
or force it with --type.

Options:
  --type <t>        flow (default) | state | sequence | er | layout | user-journey
  --out <path>      Save path (default: .cx/wireframes/<slug>-<ts>.<ext>)
  --stdout          Print to stdout instead of writing a file
  -h, --help        Show this message

Formats:
  Mermaid diagrams (flow/state/sequence/er/user-journey) render natively
  in OpenCode, Claude Code, GitHub, Notion, and most markdown viewers.
  HTML wireframes (layout) open in any browser with a low-fi sketch style
  that signals "not final design."

Examples:
  construct wireframe "user signup flow"
  construct wireframe "database schema for project iverson" --type er
  construct wireframe "dashboard with sidebar filters" --type layout
  construct wireframe "oauth handshake" --type sequence --stdout
`);
}

function parseArgs(argv) {
  const options = { type: null, out: null, stdout: false, description: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--stdout') { options.stdout = true; continue; }
    if (arg === '--type') { options.type = argv[++i]; continue; }
    if (arg.startsWith('--type=')) { options.type = arg.slice(7); continue; }
    if (arg === '--out') { options.out = argv[++i]; continue; }
    if (arg.startsWith('--out=')) { options.out = arg.slice(6); continue; }
    options.description.push(arg);
  }
  options.description = options.description.join(' ').trim();
  return options;
}

export async function runWireframeCli(argv = [], { cwd = process.cwd() } = {}) {
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

  const result = generateWireframe({ description: options.description, type: options.type });

  if (options.stdout) {
    process.stdout.write(result.content);
    return;
  }

  const slug = slugify(options.description);
  const fileName = `${slug}-${timestamp()}.${result.extension}`;
  const outPath = options.out
    ? resolve(cwd, options.out)
    : join(cwd, '.cx', 'wireframes', fileName);

  const dir = outPath.slice(0, outPath.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, result.content, 'utf8');

  console.log(`Wireframe (${result.type}, ${result.format}) written to:`);
  console.log(`  ${outPath}`);
  if (result.format === 'html') {
    console.log(`\nOpen it with: open "${outPath}"`);
  } else {
    console.log(`\nRender inline: paste into any Mermaid-aware viewer (GitHub, Notion, Obsidian, OpenCode).`);
  }
}
