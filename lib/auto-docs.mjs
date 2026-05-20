/**
 * lib/auto-docs.mjs — regenerate managed regions in markdown docs and build the MkDocs site tree.
 *
 * Managed regions are HTML comment markers in the form:
 *   <!-- AUTO:region-name -->
 *   content
 *   <!-- /AUTO:region-name -->
 *
 * Running regenerateDocs() is idempotent. With check:true it returns whether
 * anything would change without writing files — the mode CI uses to detect drift.
 *
 * buildSite() writes site/docs/ from the same sources feeding the AUTO regions
 * so the GitHub Pages site never drifts from the in-repo markdown.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { CLI_COMMANDS_BY_CATEGORY, CATEGORY_ORDER } from './cli-commands.mjs';

// --- region helpers ---

function replaceRegion(content, regionName, newBody) {
  const open = `<!-- AUTO:${regionName} -->`;
  const close = `<!-- /AUTO:${regionName} -->`;
  const before = content.indexOf(open);
  const after = content.indexOf(close);
  if (before === -1 || after === -1) return null;
  return content.slice(0, before + open.length) + '\n' + newBody + '\n' + content.slice(after);
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function writeIfChanged(filePath, newContent) {
  const existing = readFile(filePath);
  if (existing === newContent) return false;
  fs.writeFileSync(filePath, newContent, 'utf8');
  return true;
}

// --- region generators ---

function buildCommandsTable() {
  const rows = [];
  for (const category of CATEGORY_ORDER) {
    const cmds = CLI_COMMANDS_BY_CATEGORY[category] ?? [];
    if (!cmds.length) continue;
    rows.push(`### ${category}\n`);
    rows.push('| Command | What it does |');
    rows.push('|---|---|');
    for (const cmd of cmds) {
      rows.push(`| \`construct ${cmd.name}\` | ${cmd.description} |`);
    }
    rows.push('');
  }
  return rows.join('\n').trimEnd();
}

function buildCoreDocsContract() {
  return [
    '## Required core documents',
    '',
    '| File | Purpose | Update when |',
    '|---|---|---|',
    '| `AGENTS.md` | Canonical agent operating contract | Workflow rules, tracker hierarchy, or repo-wide guardrails change |',
    '| `.cx/context.md` | Human-readable resumable project context | Active work, decisions, architecture assumptions, or open questions change |',
    '| `.cx/context.json` | Machine-readable resumable context | Context state needs to stay in sync with `.cx/context.md` |',
    '| `docs/README.md` | Docs index and maintenance contract | Core docs set or maintenance expectations change |',
    '| `docs/concepts/architecture.md` | Canonical architecture and invariants | Runtime shape, contracts, boundaries, or major dependencies change |',
    '',
    '`plan.md` is a local working document. `construct init` creates it for the active session, but it is gitignored and not committed — durable work belongs in the tracker (Beads or external).',
    '',
    'Tracker hierarchy: external tracker (prefer Beads) for durable work, `plan.md` for the local working plan, and cass-memory via MCP `memory` for cross-session recall.',
    '',
    '`AGENTS.md` is the canonical agent instruction file. On case-sensitive filesystems you may also add a lowercase `agents.md` shim for tools that require it.',
    'All LLMs working in the repo, including Construct, must read these as project state, keep them current when work changes project reality, and prune stale sections instead of letting managed docs drift.',
  ].join('\n');
}

const DIR_DESCRIPTIONS = {
  agents: 'Registry and generated platform adapter chains',
  apps: 'User-facing apps shipped from this repo (e.g., apps/docs/ — Fumadocs docs site)',
  bin: 'CLI entrypoint (`construct`)',
  claude: 'Claude Code integration (agents, settings template)',
  commands: 'Command prompt assets',
  codex: 'GitHub Copilot / Codex integration',
  docs: 'Architecture notes, runbooks, and documentation contract',
  telemetry: 'Telemetry backend for agent observability',
  lib: 'Core runtime: CLI, hooks, MCP, status, sync, workflow',
  opencode: 'OpenCode integration config',
  personas: 'Persona prompt definitions',
  rules: 'Coding and quality standards',
  site: 'MkDocs source for the GitHub Pages documentation site',
  skills: 'Reusable domain knowledge files',
  tests: 'Test suite',
};

function buildStructureSection(rootDir) {
  let trackedDirs;
  try {
    const out = execSync('git ls-tree --name-only HEAD', { cwd: rootDir, encoding: 'utf8' });
    trackedDirs = new Set(out.trim().split('\n').filter(Boolean));
  } catch {
    trackedDirs = null;
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && (trackedDirs === null || trackedDirs.has(e.name)))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const lines = ['```text', 'construct/'];
  for (const entry of entries) {
    const desc = DIR_DESCRIPTIONS[entry.name] ?? '';
    lines.push(`├── ${entry.name.padEnd(16)} ${desc}`.trimEnd());
  }
  lines.push('```');
  return lines.join('\n');
}

function extractHookSummary(hookPath) {
  try {
    const src = fs.readFileSync(hookPath, 'utf8');
    const match = src.match(/\/\*\*[\s\S]*?\*\//);
    if (!match) return '';
    const block = match[0].replace(/^\/\*\*|\*\/$/g, '').trim();
    const lines = block.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim());
    const purposeLine = lines.find(l => l.includes('—'));
    if (purposeLine) {
      const idx = purposeLine.indexOf('—');
      return purposeLine.slice(idx + 1).trim();
    }
    return lines.find(l => l.length > 0) ?? '';
  } catch { return ''; }
}

function buildHooksTable(rootDir) {
  const hooksDir = path.join(rootDir, 'lib', 'hooks');
  const files = fs.readdirSync(hooksDir)
    .filter(f => f.endsWith('.mjs'))
    .sort();

  const rows = ['| Hook | Description |', '|---|---|'];
  for (const f of files) {
    const name = f.replace(/\.mjs$/, '');
    const desc = extractHookSummary(path.join(hooksDir, f));
    rows.push(`| \`${name}\` | ${desc} |`);
  }
  return rows.join('\n');
}

function buildAgentsTable(rootDir) {
  const registryPath = path.join(rootDir, 'agents', 'registry.json');
  let registry;
  try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch { return ''; }

  const agents = registry.agents ?? registry;
  if (!Array.isArray(agents)) return '';

  const rows = ['| Agent | Tier | Purpose |', '|---|---|---|'];
  for (const agent of agents.slice(0, 30)) {
    const name = agent.id ?? agent.name ?? '—';
    const tier = agent.tier ?? agent.model_tier ?? '—';
    const purpose = (agent.description ?? agent.purpose ?? '').split('\n')[0].slice(0, 80);
    rows.push(`| \`${name}\` | ${tier} | ${purpose} |`);
  }
  if (agents.length > 30) rows.push(`| *(+${agents.length - 30} more)* | | |`);
  return rows.join('\n');
}

// --- public API ---

/**
 * Regenerate all AUTO regions in README.md, docs/README.md, and docs/concepts/architecture.md.
 * Returns { changed: string[], checked: boolean }.
 * With check:true writes nothing and sets changed to files that would differ.
 */
export async function regenerateDocs({ rootDir, check = false } = {}) {
  rootDir = rootDir ?? process.cwd();
  const changed = [];

  const jobs = [
    {
      file: path.join(rootDir, 'README.md'),
      regions: {
        commands: buildCommandsTable(),
        structure: buildStructureSection(rootDir),
        hooks: buildHooksTable(rootDir),
      },
    },
    {
      file: path.join(rootDir, 'docs', 'concepts', 'architecture.md'),
      regions: {
        agents: buildAgentsTable(rootDir),
      },
    },
    {
      file: path.join(rootDir, 'docs', 'README.md'),
      regions: {
        'core-docs': buildCoreDocsContract(),
      },
    },
  ];

  for (const { file, regions } of jobs) {
    let content = readFile(file);
    if (!content) continue;
    let modified = false;
    for (const [regionName, body] of Object.entries(regions)) {
      if (!body) continue;
      const updated = replaceRegion(content, regionName, body);
      if (updated === null) continue;
      if (updated !== content) {
        content = updated;
        modified = true;
      }
    }
    if (!modified) continue;
    if (check) {
      changed.push(file);
    } else {
      writeIfChanged(file, content);
      changed.push(file);
    }
  }

  return { changed, checked: check };
}

/**
 * Check CLI command coverage against how-to links in docs/README.md.
 *
 * Returns an object with:
 *   - covered: string[]    commands that have a linked how-to
 *   - uncovered: string[]  commands with no how-to link in docs/README.md
 *   - total: number
 *
 * A command is considered covered if its name appears in any markdown link
 * inside the how-to guides section of docs/README.md.
 */
export function checkDocsCoverage({ rootDir } = {}) {
  rootDir = rootDir ?? process.cwd();
  const docsReadme = readFile(path.join(rootDir, 'docs', 'README.md')) ?? '';

  // Extract all href targets from markdown links in docs/README.md
  const linkTargets = [...docsReadme.matchAll(/\[.*?\]\((.*?)\)/g)].map(m => m[1]);

  // Build a combined corpus: docs/README.md + every linked how-to file
  const howToDir = path.join(rootDir, 'docs', 'how-to');
  let corpus = docsReadme;
  for (const target of linkTargets) {
    if (!target.startsWith('./how-to/')) continue;
    const filePath = path.join(rootDir, 'docs', target.replace(/^\.\//, ''));
    const content = readFile(filePath);
    if (content) corpus += '\n' + content;
  }

  // Capture command mentions from both inline code (`construct cmd`) and code blocks (bare lines)
  const mentionedCmds = new Set([
    ...corpus.matchAll(/`construct\s+([\w:_-]+)`/g),
    ...corpus.matchAll(/^construct\s+([\w:_-]+)/gm),
  ].map(m => m[1]));

  // Collect all command names from the registry
  const allCommands = [];
  for (const cmds of Object.values(CLI_COMMANDS_BY_CATEGORY)) {
    for (const cmd of cmds) allCommands.push(cmd.name);
  }

  // Skip internal / plumbing commands and simple commands covered by getting-started.md
  const skipList = new Set([
    'version', 'diff', 'validate', 'docs:update', 'docs:site', 'docs:check', 'sync',
    'list', 'setup', 'show', 'hosts', 'plugin', 'mcp', 'evals',
    'telemetry-backfill', 'lint:comments', 'lint:research',
    // short commands documented in getting-started.md
    'up', 'down', 'status', 'serve', 'init', 'update', 'doctor',
    // team sub-commands — covered as part of review how-to
    'team',
    // covered in getting-started.md under Memory Layer section
    'bootstrap', 'memory',
    // niche overlay command — documented in registry description
    'headhunt',
  ]);

  const covered = [];
  const uncovered = [];

  for (const name of allCommands) {
    if (skipList.has(name)) continue;
    const slug = name.replace(':', '-');
    const isCovered =
      linkTargets.some(t => t.includes(slug) || t.includes(name)) ||
      mentionedCmds.has(name);
    if (isCovered) covered.push(name);
    else uncovered.push(name);
  }

  return { covered, uncovered, total: covered.length + uncovered.length };
}

// Categories surfaced in the Fumadocs reference. Internal commands (e.g.,
// `construct hook <name>`) are not user-facing reference material.
const REFERENCE_CATEGORIES = [
  'Services',
  'Agents & Sync',
  'Work',
  'Embed',
  'Models & Integrations',
  'Providers',
  'Observability',
  'Docs',
  'Diagnostics',
];

function slugify(category) {
  return category.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function renderCommandPage(category, commands) {
  const lines = [];
  lines.push('---');
  lines.push(`title: ${category}`);
  lines.push(`description: ${category} commands for Construct.`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${category}`);
  lines.push('');
  lines.push('| Command | What it does |');
  lines.push('|---|---|');
  for (const cmd of commands) {
    lines.push(`| \`construct ${cmd.name}\` | ${cmd.description} |`);
  }
  lines.push('');
  for (const cmd of commands) {
    lines.push(`## construct ${cmd.name}`);
    lines.push('');
    lines.push(cmd.description);
    lines.push('');
    if (cmd.usage) {
      lines.push('**Usage**');
      lines.push('');
      lines.push('```bash');
      lines.push(cmd.usage);
      lines.push('```');
      lines.push('');
    }
    if (cmd.subcommands && cmd.subcommands.length) {
      lines.push('**Subcommands**');
      lines.push('');
      for (const sub of cmd.subcommands) {
        lines.push(`- \`${sub}\``);
      }
      lines.push('');
    }
    if (cmd.options && cmd.options.length) {
      lines.push('**Options**');
      lines.push('');
      lines.push('| Flag | Description |');
      lines.push('|---|---|');
      for (const opt of cmd.options) {
        lines.push(`| \`${opt.flag}\` | ${opt.desc} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderHooksPage(rootDir) {
  return [
    '---',
    'title: Hooks',
    'description: Hooks fire during Claude Code sessions, on file edits, commits, pushes, and prompts. Generated from lib/hooks/.',
    '---',
    '',
    '> Generated from `lib/hooks/`. Re-run `construct docs:site` to refresh.',
    '',
    'Hooks are wired in `platforms/claude/settings.template.json` and execute as child processes during Claude Code sessions. Each hook reads JSON on stdin, performs its check or transform, and exits with a status that signals whether the surrounding tool call should proceed.',
    '',
    buildHooksTable(rootDir),
    '',
  ].join('\n');
}

function renderAgentsPage(rootDir) {
  const table = buildAgentsTable(rootDir);
  if (!table) return null;
  return [
    '---',
    'title: Agents',
    'description: The 28 cx-* specialists plus the construct persona. Generated from agents/registry.json.',
    '---',
    '',
    '> Generated from `agents/registry.json`. Re-run `construct docs:site` to refresh.',
    '',
    'Construct ships one persona (`construct`) plus 28 specialists. Each specialist has a role, model tier, and prompt that defines its decision authority. Specialists are addressable directly when you want a focused conversation; for everyday work, address `@construct` and let it route.',
    '',
    table,
    '',
  ].join('\n');
}

/**
 * Emit MDX reference pages into docs/reference/ for the Fumadocs site.
 * Mirrors the data sources behind AUTO regions and buildSite() but writes
 * Markdown files Fumadocs can render directly (no MkDocs intermediate).
 */
export function buildFumadocsReference({ rootDir } = {}) {
  rootDir = rootDir ?? process.cwd();
  const refDir = path.join(rootDir, 'docs', 'reference');
  const cliDir = path.join(refDir, 'cli');
  fs.mkdirSync(cliDir, { recursive: true });

  const written = [];

  const cliPages = [];
  for (const category of REFERENCE_CATEGORIES) {
    const commands = CLI_COMMANDS_BY_CATEGORY[category] ?? [];
    if (!commands.length) continue;
    const slug = slugify(category);
    const out = path.join(cliDir, `${slug}.md`);
    if (writeIfChanged(out, renderCommandPage(category, commands))) {
      written.push(path.relative(rootDir, out));
    }
    cliPages.push(slug);
  }

  const cliMeta = path.join(cliDir, 'meta.json');
  const cliMetaContent = JSON.stringify({ title: 'CLI', pages: ['index', ...cliPages] }, null, 2) + '\n';
  if (writeIfChanged(cliMeta, cliMetaContent)) written.push(path.relative(rootDir, cliMeta));

  const cliIndexContent = [
    '---',
    'title: CLI',
    'description: Every construct command, grouped by category. Generated from lib/cli-commands.mjs.',
    '---',
    '',
    '> Generated from `lib/cli-commands.mjs`. Re-run `construct docs:site` to refresh.',
    '',
    'Commands are grouped by what they do. Pick a category below.',
    '',
    ...REFERENCE_CATEGORIES.map((cat) => {
      const slug = slugify(cat);
      const commands = CLI_COMMANDS_BY_CATEGORY[cat] ?? [];
      if (!commands.length) return null;
      return `- [${cat}](/reference/cli/${slug}) — ${commands.length} command${commands.length === 1 ? '' : 's'}`;
    }).filter(Boolean),
    '',
  ].join('\n');
  if (writeIfChanged(path.join(cliDir, 'index.md'), cliIndexContent)) {
    written.push(path.relative(rootDir, path.join(cliDir, 'index.md')));
  }

  const hooksPage = path.join(refDir, 'hooks.md');
  if (writeIfChanged(hooksPage, renderHooksPage(rootDir))) {
    written.push(path.relative(rootDir, hooksPage));
  }

  const agentsContent = renderAgentsPage(rootDir);
  if (agentsContent) {
    const agentsPage = path.join(refDir, 'agents.md');
    if (writeIfChanged(agentsPage, agentsContent)) {
      written.push(path.relative(rootDir, agentsPage));
    }
  }

  return { written };
}

