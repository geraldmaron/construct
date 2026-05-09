/**
 * lib/drop.mjs — `construct drop` command, frictionless ingest of recently
 * saved files from drop-zone directories (~/Downloads, ~/Desktop, etc.).
 *
 * The user drops a file in their host session; the host often can't read it
 * because of sandbox constraints. `construct drop` closes that gap: it
 * surfaces the N most recent files in configured watch dirs, filters by
 * ingestable types (PDF, Office, text, etc.), and runs `ingestDocuments`
 * on the selection. Cross-platform; no external dependencies.
 *
 * Watch dirs default to XDG-ish sane values per platform; override via
 * `CONSTRUCT_DROP_DIRS` env (colon-separated) or `--source <dir>`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, extname, join } from 'node:path';
import { isExtractableDocumentPath } from './document-extract.mjs';
import { ingestDocuments } from './document-ingest.mjs';

const DEFAULT_RECENCY_MS = 24 * 60 * 60 * 1000; // 24 hours

function defaultWatchDirs(home = homedir()) {
  const downloads = join(home, 'Downloads');
  const desktop = join(home, 'Desktop');
  const documents = join(home, 'Documents');
  const dirs = [downloads, desktop, documents];
  // macOS: include ~/Library/Mobile Documents when it exists (iCloud drop)
  if (platform() === 'darwin') {
    const icloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Downloads');
    dirs.push(icloud);
  }
  return dirs.filter((d) => existsSync(d));
}

function resolveWatchDirs({ env = process.env, override = null, home = homedir() } = {}) {
  if (override && override.length > 0) return override;
  const raw = env.CONSTRUCT_DROP_DIRS;
  if (raw) {
    return raw.split(':').map((s) => s.trim()).filter(Boolean).filter((p) => existsSync(p));
  }
  return defaultWatchDirs(home);
}

function parseSinceSpec(spec) {
  if (!spec) return DEFAULT_RECENCY_MS;
  const match = /^(\d+)([smhd])$/i.exec(String(spec).trim());
  if (!match) return DEFAULT_RECENCY_MS;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

/**
 * Walks watch dirs (non-recursive) and returns file candidates.
 * Sorted by most-recent mtime first. Honors extension filter.
 */
export function collectCandidates({
  dirs,
  sinceMs = DEFAULT_RECENCY_MS,
  extensionFilter = null,
  limit = 10,
  now = Date.now(),
} = {}) {
  const cutoff = now - sinceMs;
  const results = [];
  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue; // hidden / temp files
        const full = join(dir, entry.name);
        let stats;
        try { stats = statSync(full); } catch { continue; }
        if (stats.mtimeMs < cutoff) continue;
        const ext = extname(entry.name).slice(1).toLowerCase();
        if (extensionFilter && ext !== extensionFilter.replace(/^\./, '').toLowerCase()) continue;
        if (!isExtractableDocumentPath(full)) continue;
        results.push({
          path: full,
          name: entry.name,
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          mtimeMs: stats.mtimeMs,
          source: dir,
          ext,
        });
      }
    } catch { /* unreadable dir — skip */ }
  }
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results.slice(0, limit);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(mtimeMs, now = Date.now()) {
  const diff = now - mtimeMs;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function printCandidates(candidates) {
  if (candidates.length === 0) {
    console.log('No recent ingestable files found in drop-zone directories.');
    return;
  }
  console.log(`Recent drop-zone files (${candidates.length}):`);
  console.log('─'.repeat(90));
  candidates.forEach((c, i) => {
    const num = String(i + 1).padStart(2, ' ');
    const name = c.name.length > 40 ? c.name.slice(0, 37) + '…' : c.name.padEnd(40);
    const size = formatSize(c.size).padStart(8);
    const age = formatAge(c.mtimeMs).padStart(8);
    const src = basename(c.source);
    console.log(`  ${num}. ${name}  ${size}  ${age}  ${src}`);
  });
  console.log('');
}

async function confirm(question) {
  if (!process.stdin.isTTY) return true;
  process.stdout.write(`${question} [Y/n] `);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => {
      const answer = String(chunk).trim().toLowerCase();
      resolve(answer === '' || answer === 'y' || answer === 'yes');
    });
  });
}

export function printHelp() {
  console.log(`Usage: construct drop [options]

Ingests the most recently dropped file(s) from your drop-zone directories
(Downloads, Desktop, Documents, iCloud Drive Downloads). Closes the gap
where a host session can't read files outside its sandbox.

Options:
  --list             Show candidates without ingesting
  --all              Ingest all listed candidates (default: most recent)
  --index N[,N...]   Ingest specific candidates by list index
  --yes, -y          Skip confirmation prompt
  --source <dir>     Override watch directory (repeatable)
  --type <ext>       Filter by extension (pdf, docx, xlsx, txt, md, etc.)
  --since <spec>     Recency window: 30m, 1h, 2d (default: 24h)
  --target <t>       Ingest target: knowledge/internal (default) | knowledge/<subdir> | sibling
  --sync             Rebuild hybrid index after ingest
  --json             Emit machine-readable output
  -h, --help         Show this message

Environment:
  CONSTRUCT_DROP_DIRS   Colon-separated override for watch directories

Examples:
  construct drop                        # ingest most recent ingestable file
  construct drop --list                 # list candidates, no ingest
  construct drop --index 2,3            # ingest candidates 2 and 3
  construct drop --type pdf --since 1h  # PDFs saved in last hour
`);
}

function parseArgs(argv) {
  const options = {
    list: false,
    all: false,
    indexes: null,
    yes: false,
    sources: [],
    type: null,
    since: null,
    target: null,
    sync: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') options.list = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--sync') options.sync = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--source') options.sources.push(argv[++i]);
    else if (arg.startsWith('--source=')) options.sources.push(arg.slice(9));
    else if (arg === '--type') options.type = argv[++i];
    else if (arg.startsWith('--type=')) options.type = arg.slice(7);
    else if (arg === '--since') options.since = argv[++i];
    else if (arg.startsWith('--since=')) options.since = arg.slice(8);
    else if (arg === '--target') options.target = argv[++i];
    else if (arg.startsWith('--target=')) options.target = arg.slice(9);
    else if (arg === '--index') options.indexes = argv[++i];
    else if (arg.startsWith('--index=')) options.indexes = arg.slice(8);
  }
  return options;
}

export async function runDropCli(argv = [], { cwd = process.cwd(), env = process.env } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const dirs = resolveWatchDirs({ env, override: options.sources.length ? options.sources : null });
  if (dirs.length === 0) {
    console.error('No drop-zone directories found. Set CONSTRUCT_DROP_DIRS or use --source.');
    process.exit(1);
  }

  const sinceMs = parseSinceSpec(options.since);
  const candidates = collectCandidates({
    dirs,
    sinceMs,
    extensionFilter: options.type,
    limit: 10,
  });

  if (options.json) {
    console.log(JSON.stringify({ dirs, candidates }, null, 2));
    if (options.list || candidates.length === 0) return;
  } else {
    printCandidates(candidates);
    if (candidates.length === 0) return;
    if (options.list) return;
  }

  let selection;
  if (options.indexes) {
    const picks = String(options.indexes).split(',').map((s) => Number(s.trim()) - 1);
    selection = picks
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .map((i) => candidates[i]);
    if (selection.length === 0) {
      console.error('No valid indexes provided.');
      process.exit(1);
    }
  } else if (options.all) {
    selection = candidates;
  } else {
    selection = [candidates[0]];
  }

  if (!options.yes && !options.json) {
    const names = selection.map((c) => c.name).join(', ');
    const proceed = await confirm(`Ingest ${selection.length} file${selection.length === 1 ? '' : 's'}: ${names}?`);
    if (!proceed) {
      console.log('Aborted.');
      return;
    }
  }

  const inputs = selection.map((c) => c.path);
  const result = await ingestDocuments(inputs, {
    cwd,
    target: options.target || 'knowledge/internal',
    sync: options.sync,
    env,
  });

  if (options.json) {
    console.log(JSON.stringify({ ingested: result }, null, 2));
    return;
  }

  console.log('');
  console.log(`Ingested ${inputs.length} file${inputs.length === 1 ? '' : 's'} into the current project.`);
  if (options.sync) {
    console.log('Hybrid index rebuilt.');
  } else {
    console.log('Run `construct storage sync` to rebuild the hybrid index, or re-run with --sync.');
  }
}
