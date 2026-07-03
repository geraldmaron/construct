/**
 * lib/test-corpus-inventory.mjs — classify the Construct test corpus for certification traceability.
 *
 * Walks all test files under tests/, assigns layer and signal category per file, extracts
 * @capability markers, and compares shipped capability-matrix rows against the behavior
 * ledger to surface release-critical gaps. Output feeds tests/capabilities/corpus-inventory.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadCapabilityLedger } from './capability-ledger.mjs';

export const CORPUS_CATEGORIES = Object.freeze([
  'structural-guard',
  'unit',
  'integration',
  'hook',
  'functional',
  'live-provider',
  'visual',
  'contract-subsystem',
]);

const STRUCTURAL_GUARD_NAMES = [
  'agent-prompts',
  'release-workflow',
  'parity',
  'comment-lint',
  'agents-registry',
  'cli-catalog-accuracy',
  'auto-docs',
  'docs-verify',
  'sync-contract',
  'release-gates',
  'template-policy',
];

const SUBSYSTEM_DIRS = [
  'profile',
  'profiles',
  'outcomes',
  'flavors',
  'knowledge',
  'intake',
  'roles',
  'embed',
  'doctor',
  'integrations',
  'graph',
  'evals',
  'reflect',
  'hooks',
  'functional',
  'capabilities',
  'fixtures',
  'e2e',
];

const SHIPPED_MATRIX_CAPABILITIES = Object.freeze([
  { id: 'document', ledgerHints: ['artifact', 'docs'] },
  { id: 'research', ledgerHints: ['research', 'knowledge', 'ask'] },
  { id: 'ingest', ledgerHints: ['document.ingest', 'ingest'] },
  { id: 'diagram', ledgerHints: ['diagram', 'wireframe'] },
  { id: 'demo', ledgerHints: ['demo'] },
  { id: 'publish', ledgerHints: ['publish', 'artifact', 'export'] },
]);

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function defaultCorpusInventoryPath(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'capabilities', 'corpus-inventory.json');
}

function listTestFiles(testsDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.tmp') continue;
        walk(absolute);
        continue;
      }
      if (/\.test\.(mjs|js)$/.test(entry.name)) files.push(absolute);
    }
  };
  walk(testsDir);
  return files.sort();
}

function readHeaderNote(content) {
  const block = content.match(/^\/\*\*([\s\S]*?)\*\//)?.[1] ?? content.match(/^\/\/\/([\s\S]*?)(?:\n\n|\nimport )/)?.[1];
  if (!block) return '';
  const line = block
    .split('\n')
    .map((row) => row.replace(/^\s*\*\s?/, '').trim())
    .find((row) => row.length > 0 && !row.startsWith('@'));
  return line?.slice(0, 160) ?? '';
}

function classifyLayer(relPath, content) {
  const base = path.basename(relPath);
  if (relPath.includes('tests/functional/') || base.includes('.functional.test.')) return 'functional';
  if (base.includes('real-llm') || content.includes('CONSTRUCT_E2E_REAL_LLM')) return 'live-provider';
  if (/visual/i.test(base) || /playwright/i.test(content)) return 'visual';
  if (
    /store/i.test(base)
    || /postgres/i.test(base)
    || /hybrid/i.test(base)
    || /vector-client/i.test(base)
    || relPath.includes('/hooks/')
    || /hook/i.test(base)
  ) return 'integration';
  return 'unit';
}

function classifyCategory(relPath, layer, content) {
  const base = path.basename(relPath);
  const dir = path.dirname(relPath);
  if (layer === 'functional') return 'functional';
  if (layer === 'live-provider') return 'live-provider';
  if (layer === 'visual') return 'visual';
  if (dir.includes('/hooks/') || /\bhook/i.test(base)) return 'hook';
  if (STRUCTURAL_GUARD_NAMES.some((name) => base.includes(name))) return 'structural-guard';
  if (layer === 'integration') return 'integration';
  if (SUBSYSTEM_DIRS.some((segment) => dir.split(path.sep).includes(segment))) return 'contract-subsystem';
  if (/@capability\s+/.test(content) && layer === 'unit') return 'unit';
  return 'unit';
}

function extractCapabilities(content) {
  return [...content.matchAll(/@capability\s+([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)/g)].map((match) => match[1]);
}

// Graph builders (lib/graph/build-from-corpus.mjs) need the raw path→capability
// pairs, not the full classified inventory, so this stays a thin extraction step
// callers can run over the live tree without regenerating the whole inventory.

export function extractCapabilityTestEdges({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const testsDir = path.join(root, 'tests');
  const edges = [];
  for (const absolute of listTestFiles(testsDir)) {
    const rel = path.relative(root, absolute).replace(/\\/g, '/');
    const content = fs.readFileSync(absolute, 'utf8');
    for (const capabilityId of extractCapabilities(content)) edges.push({ testPath: rel, capabilityId });
  }
  return edges;
}

function detectSkipped(content) {
  return /\btest\.skip\s*\(|\bit\.skip\s*\(|\bdescribe\.skip\s*\(/.test(content);
}

export function classifyTestFile(relPath, content) {
  const layer = classifyLayer(relPath, content);
  return {
    path: relPath.replace(/\\/g, '/'),
    layer,
    category: classifyCategory(relPath, layer, content),
    capabilities: extractCapabilities(content),
    skipped: detectSkipped(content),
    maintainerNotes: readHeaderNote(content),
  };
}

function countBy(items, key) {
  const totals = {};
  for (const item of items) totals[item[key]] = (totals[item[key]] ?? 0) + 1;
  return totals;
}

function ledgerCoversHint(ledgerIds, hints) {
  return hints.some((hint) => ledgerIds.some((id) => id.includes(hint)));
}

export function computeReleaseCriticalGaps(ledger) {
  const allLedgerIds = (ledger?.capabilities ?? []).map((entry) => entry.id);
  const gaps = [];

  for (const row of SHIPPED_MATRIX_CAPABILITIES) {
    if (ledgerCoversHint(allLedgerIds, row.ledgerHints)) continue;
    gaps.push({
      source: 'docs/operations/audit/capability-matrix.md',
      capability: row.id,
      status: 'shipped',
      reason: 'no ledger entry matches shipped capability hints',
      suggestedLedgerHints: row.ledgerHints,
    });
  }

  return gaps;
}

export function buildTestCorpusInventory({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const testsDir = path.join(root, 'tests');
  const files = listTestFiles(testsDir);
  const entries = files.map((absolute) => {
    const rel = path.relative(root, absolute);
    const content = fs.readFileSync(absolute, 'utf8');
    return classifyTestFile(rel, content);
  });

  const { ledger } = loadCapabilityLedger({ rootDir: root });
  const topLevel = entries.filter((entry) => entry.path.split('/').length === 2).length;
  const nested = entries.length - topLevel;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: 'node scripts/generate-test-corpus-inventory.mjs',
    summary: {
      testFiles: entries.length,
      topLevelTestFiles: topLevel,
      nestedTestFiles: nested,
      skippedFiles: entries.filter((entry) => entry.skipped).length,
      capabilityMarkedFiles: entries.filter((entry) => entry.capabilities.length > 0).length,
      byLayer: countBy(entries, 'layer'),
      byCategory: countBy(entries, 'category'),
    },
    releaseCriticalGaps: computeReleaseCriticalGaps(ledger),
    files: entries,
  };
}

export function formatAuditAtAGlance(inventory) {
  const { summary } = inventory;
  const functional = summary.byCategory.functional ?? 0;
  const subsystem = summary.byCategory['contract-subsystem'] ?? 0;
  const hook = summary.byCategory.hook ?? 0;
  return [
    `- **${summary.testFiles} test files** total: ${summary.topLevelTestFiles} at \`tests/\` top level + ${summary.nestedTestFiles} in subdirectories.`,
    `- **Layers:** ${Object.entries(summary.byLayer).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `- **Functional layer:** ${functional} file(s) under \`tests/functional/\` or \`*.functional.test.mjs\`. End-to-end checks spawn the real binary or import real modules in an isolated tmpdir.`,
    `- **Contract subsystems:** ${subsystem} file(s) under profile/outcomes/hooks/knowledge/intake/graph/evals and related subdirs.`,
    `- **Hook tests:** ${hook} file(s) (including \`tests/hooks/\`).`,
    `- **Capability-marked:** ${summary.capabilityMarkedFiles} file(s) declare \`@capability\` markers.`,
    `- **Skipped markers:** ${summary.skippedFiles} file(s) contain \`test.skip\` / \`describe.skip\` (see inventory for paths).`,
    `- **Regenerate inventory:** \`node scripts/generate-test-corpus-inventory.mjs\`.`,
  ].join('\n');
}

export function refreshAuditMarkdown(inventory, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const auditPath = path.join(root, 'tests', 'AUDIT.md');
  let markdown = fs.readFileSync(auditPath, 'utf8');
  const start = '## At a glance';
  const end = '## Categories';
  const startIdx = markdown.indexOf(start);
  const endIdx = markdown.indexOf(end);
  if (startIdx === -1 || endIdx === -1) throw new Error('tests/AUDIT.md missing At a glance section');
  const replacement = `${start}\n\n${formatAuditAtAGlance(inventory)}\n\n`;
  markdown = `${markdown.slice(0, startIdx)}${replacement}${markdown.slice(endIdx)}`;
  const functional = inventory.summary.byCategory.functional ?? 0;
  markdown = markdown.replace(
    /### 5\. Functional layer \(\d+ tests, \d+ files\)/,
    `### 5. Functional layer (${functional} tests, ${functional} files)`,
  );
  return markdown;
}

export function validateCorpusInventory({ rootDir, inventory: supplied } = {}) {
  const root = findConstructRoot(rootDir);
  const inventory = supplied ?? JSON.parse(fs.readFileSync(defaultCorpusInventoryPath(root), 'utf8'));
  const errors = [];
  const warnings = [];
  const onDisk = listTestFiles(path.join(root, 'tests')).map((absolute) => path.relative(root, absolute).replace(/\\/g, '/'));
  const indexed = new Set((inventory.files ?? []).map((entry) => entry.path));

  if (inventory.version !== 1) errors.push('corpus-inventory.version must equal 1');
  if (!Array.isArray(inventory.files) || inventory.files.length === 0) errors.push('corpus-inventory.files must be non-empty');

  for (const rel of onDisk) {
    if (!indexed.has(rel)) errors.push(`missing inventory entry: ${rel}`);
  }
  for (const entry of inventory.files ?? []) {
    if (!onDisk.includes(entry.path)) errors.push(`stale inventory entry: ${entry.path}`);
    if (!CORPUS_CATEGORIES.includes(entry.category)) errors.push(`${entry.path}: invalid category ${entry.category}`);
    if (!entry.path.endsWith('.test.mjs') && !entry.path.endsWith('.test.js')) errors.push(`${entry.path}: not a test file path`);
  }

  if ((inventory.summary?.testFiles ?? 0) !== (inventory.files?.length ?? 0)) {
    errors.push('summary.testFiles must equal files.length');
  }

  if (!Array.isArray(inventory.releaseCriticalGaps) || inventory.releaseCriticalGaps.length === 0) {
    warnings.push('releaseCriticalGaps is empty');
  }

  return {
    filePath: defaultCorpusInventoryPath(root),
    fileCount: inventory.files?.length ?? 0,
    errors,
    warnings,
    pass: errors.length === 0,
  };
}

export function writeCorpusInventoryArtifacts({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const inventory = buildTestCorpusInventory({ rootDir: root });
  const inventoryPath = defaultCorpusInventoryPath(root);
  fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'tests', 'AUDIT.md'), refreshAuditMarkdown(inventory, { rootDir: root }));
  return { inventoryPath, inventory };
}

export function runCorpusInventoryAuditCli(args = [], { rootDir } = {}) {
  if (args.includes('--write')) {
    const { inventoryPath, inventory } = writeCorpusInventoryArtifacts({ rootDir });
    process.stdout.write(`Wrote ${inventoryPath} (${inventory.files.length} files)\n`);
    process.stdout.write('Updated tests/AUDIT.md At a glance section\n');
    return validateCorpusInventory({ rootDir, inventory });
  }
  const result = validateCorpusInventory({ rootDir });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`Corpus inventory: ${result.fileCount} files\n`);
    if (result.errors.length) result.errors.forEach((error) => process.stderr.write(`  ✗ ${error}\n`));
    if (result.warnings.length) result.warnings.forEach((warning) => process.stderr.write(`  ⚠ ${warning}\n`));
    process.stdout.write(result.pass ? '  Result: PASS\n' : '  Result: FAIL\n');
  }
  if (!result.pass) process.exitCode = 1;
  return result;
}
