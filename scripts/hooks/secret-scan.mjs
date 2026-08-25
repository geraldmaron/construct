#!/usr/bin/env node
/**
 * hooks/secret-scan.mjs — PreToolUse hook on git commit. Blocks (the one
 * exception to fail-open, because leaking a credential is worse than a false
 * positive) when a staged diff contains a shape that looks like a live
 * secret, or when a staged filename is one that holds secrets by convention.
 * Deliberately narrow patterns to keep false-positive noise low.
 *
 * The content patterns and the filename rule are exported so a test can drive
 * them against synthetic inputs without staging or committing anything.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PATTERNS = [
  [/sk-ant-[a-zA-Z0-9-]{20,}/, 'Anthropic API key'],
  [/sk-(?:proj-)?[a-zA-Z0-9]{20,}/, 'OpenAI API key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/ghp_[a-zA-Z0-9]{36}/, 'GitHub personal access token'],
  [/gh[so]_[a-zA-Z0-9]{36}/, 'GitHub OAuth/server token'],
  [/github_pat_[A-Za-z0-9_]{22,}/, 'GitHub fine-grained token'],
  [/xox[bp]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/ATATT3[A-Za-z0-9_=.-]{20,}/, 'Atlassian API token'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key block'],
];

/**
 * Whether a staged path is a dotenv-style file — the kind that holds live keys
 * by convention and should never be committed. `.env.example` is the deliberate
 * exception: it is the checked-in template of variable names with no values.
 */
export function isSecretEnvFile(name) {
  const base = name.split('/').pop() ?? name;
  if (base.endsWith('.env.example')) return false;
  return /\.env$/.test(base) || /\.env\.[^/]*$/.test(base);
}

/** Every credential label a set of added lines trips. */
export function scanAddedLines(lines) {
  const hits = [];
  for (const line of lines) {
    for (const [pattern, label] of PATTERNS) {
      if (pattern.test(line)) hits.push(label);
    }
  }
  return hits;
}

/** What one staged diff reveals: content hits, plus the secret-holding filenames it adds. */
export function scanDiff(diff) {
  const addedLines = [];
  const files = new Set();
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      files.add(line.slice('+++ b/'.length));
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) addedLines.push(line);
  }
  const hits = scanAddedLines(addedLines);
  for (const file of files) {
    if (isSecretEnvFile(file)) hits.push(`staged secret file ${file}`);
  }
  return hits;
}

function stagedDiff() {
  try {
    return execFileSync('git', ['diff', '--cached', '-U0'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function main() {
  const hits = scanDiff(stagedDiff());
  if (hits.length > 0) {
    process.stderr.write(
      `secret-scan: blocked commit — possible ${[...new Set(hits)].join(', ')} in staged changes\n`,
    );
    process.exit(1);
  }
}

// Run only when invoked as the hook, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
