#!/usr/bin/env node
/**
 * hooks/no-fabrication-lint.mjs — PostToolUse hook. Runs kernel/verify/claims
 * against a file just written under packs/ or the deliverables surface, and
 * reports untagged claims. Fail-open: reporting only, never blocks the tool
 * call — a hook that blocks tool use on a false positive is how the
 * predecessor's session outages happened.
 */

import { readFileSync } from 'node:fs';
import { findUntaggedClaims } from '../../src/kernel/verify/claims.ts';

const SCOPED = [/^packs\//, /^deliverables\//];

async function main() {
  let payload = '';
  for await (const chunk of process.stdin) payload += chunk;
  let input;
  try {
    input = JSON.parse(payload || '{}');
  } catch {
    return; // malformed input — fail open, say nothing
  }

  const filePath = input?.tool_input?.file_path;
  if (!filePath) return;
  const relative = filePath.replace(process.cwd() + '/', '');
  if (!SCOPED.some((re) => re.test(relative))) return;

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const findings = findUntaggedClaims(content);
  if (findings.length === 0) return;

  process.stderr.write(
    `no-fabrication: ${relative} has ${findings.length} untagged claim(s) — add [cite:...] or [unverified]\n`,
  );
  for (const f of findings.slice(0, 5)) {
    process.stderr.write(`  line ${f.line}: ${f.text}\n`);
  }
}

main().catch(() => {}); // fail open on any unexpected error
