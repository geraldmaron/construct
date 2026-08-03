#!/usr/bin/env node
/**
 * hooks/secret-scan.mjs — PreToolUse hook on git commit. Blocks (the one
 * exception to fail-open, because leaking a credential is worse than a false
 * positive) when a staged diff contains a shape that looks like a live
 * secret. Deliberately narrow patterns to keep false-positive noise low.
 */

import { execFileSync } from 'node:child_process';

const PATTERNS = [
  [/sk-ant-[a-zA-Z0-9-]{20,}/, 'Anthropic API key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/ghp_[a-zA-Z0-9]{36}/, 'GitHub personal access token'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key block'],
];

function stagedDiff() {
  try {
    return execFileSync('git', ['diff', '--cached', '-U0'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

const diff = stagedDiff();
const hits = [];
for (const line of diff.split('\n')) {
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(line)) hits.push(label);
  }
}

if (hits.length > 0) {
  process.stderr.write(`secret-scan: blocked commit — possible ${[...new Set(hits)].join(', ')} in staged changes\n`);
  process.exit(1);
}
