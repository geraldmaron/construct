/**
 * lib/cli-service-inventory.mjs — auditable public CLI/catalog/docs inventory.
 *
 * buildCliServiceInventory joins the CLI catalog to runtime dispatch and generated
 * reference pages. buildCliConsumerInvocationDrift scans consumer-facing surfaces
 * for `construct <cmd>` strings and flags references that do not resolve to a
 * runnable handler (gate G3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { CLI_COMMANDS, RETIRED_COMMAND_HINTS } from './cli-commands.mjs';

const CONSUMER_SCAN_ROOTS = [
  'bin',
  'lib',
  'skills',
  'templates',
  path.join('registry', 'worker-profiles'),
];

const SKIP_LIB_FILES = new Set([
  'lib/cli-commands.mjs',
  'lib/completions.mjs',
  'lib/auto-docs.mjs',
  'lib/brand-prose.mjs',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'fixtures', 'dist', 'build', 'vendor', '.venv', '__pycache__']);
const SCAN_EXTENSIONS = new Set(['.mjs', '.js', '.md', '.json', '.mdx', '.txt']);

const EXTRACTORS = [
  { kind: 'backtick', re: /`construct ([a-z][a-z0-9:-]*(?:\s+[a-z0-9:.*_<>\[\]|=-]+)*)`/g },
  { kind: 'quoted', re: /['"]construct ([a-z][a-z0-9:-]*(?:\s+[a-z0-9:.*_<>\[\]|=-]+)*)['"]/g },
  { kind: 'node-bin', re: /node\s+(?:\.\/)?bin\/construct\s+([a-z][a-z0-9:-]*(?:\s+[^\s'"`]+)*)/g },
  { kind: 'bare', re: /(?:^|[^\w./-])construct\s+([a-z][a-z0-9:-]+)/g },
];

function handlerNames(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, 'bin', 'construct'), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,/g)) names.add(match[1]);
  return names;
}

function walkConsumerFiles(rootDir, dirRel, acc) {
  const abs = path.join(rootDir, dirRel);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = dirRel ? path.join(dirRel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walkConsumerFiles(rootDir, rel, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (SCAN_EXTENSIONS.has(ext) || (dirRel === 'bin' && ext === '')) acc.push(rel);
  }
}

function subcommandNames(spec) {
  const names = new Set();
  for (const sub of spec?.subcommands ?? []) {
    const label = typeof sub === 'string' ? sub : sub.name;
    for (const part of label.split(/\s*\|\s*/)) {
      names.add(part.trim().split(/\s+/)[0].replace(/[<([].*$/, ''));
    }
  }
  const usage = spec?.usage ?? '';
  const usageMatch = usage.match(/construct\s+\S+\s+<([^>]+)>/);
  if (usageMatch?.[1]?.includes('|')) {
    for (const part of usageMatch[1].split('|')) {
      names.add(part.trim().split(/\s+/)[0]);
    }
  }
  return [...names].filter(Boolean);
}

function expandInvocationVariants(raw) {
  const tokens = normalizeInvocationTokens(raw);
  if (tokens.length === 0) return [];
  const [command, ...rest] = tokens;
  const tail = rest.join(' ');
  if (!tail.includes('|')) return [tokens.join(' ')];
  return tail.split('|').map((part) => `${command} ${part.trim()}`).filter(Boolean);
}

function normalizeInvocationTokens(raw) {
  return raw
    .trim()
    .replace(/\\$/g, '')
    .replace(/[.,;:`'"()[\]{}]+$/g, '')
    .split(/\s+/)
    .filter((token) => token && !token.startsWith('--') && !token.includes('='));
}

export function resolveConsumerInvocation(tokens, { handlers, commandIndex }) {
  if (tokens.length === 0) return { valid: false, reason: 'empty invocation' };
  const [command] = tokens;
  if (command === '<cmd>' || command === '<command>') return { valid: true, skipped: 'placeholder' };
  if (command.startsWith('-')) return { valid: true, skipped: 'global flag' };
  if (RETIRED_COMMAND_HINTS[command]) {
    const hint = RETIRED_COMMAND_HINTS[command];
    return { valid: false, reason: `retired command '${command}' (use construct ${hint.replacement})` };
  }

  if (!handlers.has(command)) {
    return { valid: false, reason: `unknown command '${command}'` };
  }

  const spec = commandIndex.get(command);
  const subs = subcommandNames(spec);
  const sub = tokens[1]?.replace(/[<([].*$/, '');
  if (sub && subs.length > 0 && !subs.includes(sub)) {
    return { valid: false, reason: `unknown subcommand '${command} ${sub}'` };
  }

  return { valid: true };
}

function extractInvocationsFromLine(line, handlers) {
  const hits = [];
  for (const { kind, re } of EXTRACTORS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(line)) !== null) {
      const raw = match[1];
      const tokens = normalizeInvocationTokens(raw);
      const command = tokens[0];
      if (!command) continue;
      if (kind === 'bare' && !handlers.has(command)) continue;
      hits.push({ raw, kind });
    }
  }
  return hits;
}

/**
 * The catalog is the public-service source of truth. This projection joins it
 * to runtime dispatch so drift is observable without treating internal
 * handlers as public services. A command is documented when its catalog entry
 * carries a description — the catalog itself is the reference surface.
 */
export function buildCliServiceInventory({ rootDir = process.cwd() } = {}) {
  const handlers = handlerNames(rootDir);
  return CLI_COMMANDS.filter((spec) => !spec.internal).map((spec) => {
    return {
      name: spec.name,
      category: spec.category,
      runnable: handlers.has(spec.name),
      documented: Boolean(spec.description),
      usage: spec.usage,
      subcommands: (spec.subcommands ?? []).map((sub) => ({
        name: typeof sub === 'string' ? sub : sub.name,
        documented: typeof sub === 'string' ? true : Boolean(sub.desc || sub.description),
      })),
    };
  });
}

export function scanConsumerCliInvocations({ rootDir = process.cwd() } = {}) {
  const handlers = handlerNames(rootDir);
  const commandIndex = new Map(CLI_COMMANDS.map((spec) => [spec.name, spec]));
  const files = [];
  for (const root of CONSUMER_SCAN_ROOTS) {
    const abs = path.join(rootDir, root);
    if (!fs.existsSync(abs)) continue;
    walkConsumerFiles(rootDir, root, files);
  }

  const seen = new Set();
  const findings = [];
  for (const rel of files.sort()) {
    if (SKIP_LIB_FILES.has(rel.split(path.sep).join('/'))) continue;
    let content;
    try { content = fs.readFileSync(path.join(rootDir, rel), 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const line = lines[lineNo];
      for (const { raw, kind } of extractInvocationsFromLine(line, handlers)) {
        for (const variant of expandInvocationVariants(raw)) {
          const tokens = normalizeInvocationTokens(variant);
          const key = `${rel}:${lineNo + 1}:${tokens.join(' ')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const resolution = resolveConsumerInvocation(tokens, { handlers, commandIndex });
          if (resolution.skipped) continue;
          findings.push({
            file: rel,
            line: lineNo + 1,
            invocation: tokens.join(' '),
            context: kind,
            valid: resolution.valid,
            reason: resolution.reason,
          });
        }
      }
    }
  }
  return findings;
}

export function buildCliConsumerInvocationDrift({ rootDir = process.cwd() } = {}) {
  return scanConsumerCliInvocations({ rootDir }).filter((entry) => !entry.valid);
}
