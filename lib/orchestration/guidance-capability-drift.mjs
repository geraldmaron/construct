/**
 * lib/orchestration/guidance-capability-drift.mjs — static lint for bare MCP tool
 * references in Worker Profile guidance that are not host-guaranteed (flat core).
 *
 * Hosts exposing only the flat core plus the `call` gateway cannot invoke long-tail
 * tools by bare name. Prompts that say "call `procedure_invoke`" fail before Construct
 * can recover; they must reference a core tool or route through `call`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCoreToolNames } from '../registry/agent-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

export const GUIDANCE_SCAN_ROOTS = Object.freeze([
  'registry/worker-profiles/prompts',
]);

const IMPERATIVE_TOOL_RE = /(?:^|\s)(?:call|Call|use|Use|invoke|Invoke)\s+`([a-z][a-z0-9_]*)`/g;

export function hostGuaranteedToolNames() {
  return new Set([...readCoreToolNames(), 'call']);
}

function walkMarkdownFiles(rootDir, relRoot) {
  const abs = path.join(rootDir, relRoot);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.mdx?$/.test(entry.name)) out.push(full);
    }
  }
  walk(abs);
  return out.map((f) => path.relative(rootDir, f));
}

export function findBareNonCoreToolReferences(text, { coreNames, lineOffset = 1 } = {}) {
  const core = coreNames ?? hostGuaranteedToolNames();
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const match of line.matchAll(IMPERATIVE_TOOL_RE)) {
      const tool = match[1];
      if (!tool.includes('_')) continue;
      if (core.has(tool)) continue;
      findings.push({
        line: i + lineOffset,
        tool,
        text: line.trim(),
      });
    }
  }
  return findings;
}

export function scanGuidanceCapabilityDrift({ rootDir = REPO_ROOT } = {}) {
  const core = hostGuaranteedToolNames();
  const findings = [];
  for (const relRoot of GUIDANCE_SCAN_ROOTS) {
    for (const relFile of walkMarkdownFiles(rootDir, relRoot)) {
      const text = fs.readFileSync(path.join(rootDir, relFile), 'utf8');
      for (const hit of findBareNonCoreToolReferences(text, { coreNames: core })) {
        findings.push({ file: relFile, ...hit });
      }
    }
  }
  return { ok: findings.length === 0, findings, coreToolCount: core.size };
}
