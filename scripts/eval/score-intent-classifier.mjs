#!/usr/bin/env node
/**
 * scripts/eval/score-intent-classifier.mjs — F1 score for routing classifiers.
 *
 * Loads each tests/fixtures/routing-corpus/<role>.jsonl, runs the
 * keyword-only classifier and (optionally) the LLM-augmented verifier
 * against every example, and prints precision / recall / F1 per role.
 *
 * Usage:
 *   node scripts/eval/score-intent-classifier.mjs                 # keyword-only
 *   node scripts/eval/score-intent-classifier.mjs --verify        # + LLM verifier
 *   node scripts/eval/score-intent-classifier.mjs --role architect  # one role only
 *
 * Without --verify, no API key is needed. With --verify, requires
 * ANTHROPIC_API_KEY or OPENROUTER_API_KEY (or the configured fast tier).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyArchitectFlavor,
  classifyProductManagerFlavor,
  classifyQaFlavor,
  classifySecurityFlavor,
  classifyDataAnalystFlavor,
  classifyDataEngineerFlavor,
  isProductIntelligenceRequest,
} from '../../lib/orchestration-policy.mjs';
import { verifyIntent, resetCache } from '../../lib/intent-classifier.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(HERE, '..', '..', 'tests', 'fixtures', 'routing-corpus');

const ROLES = {
  architect: { classifier: classifyArchitectFlavor, file: 'architect.jsonl' },
  'product-manager': {
    classifier: (r) => (isProductIntelligenceRequest(r) ? classifyProductManagerFlavor(r) : null),
    file: 'product-manager.jsonl',
  },
  qa: { classifier: classifyQaFlavor, file: 'qa.jsonl' },
  security: { classifier: classifySecurityFlavor, file: 'security.jsonl' },
  'data-analyst': { classifier: classifyDataAnalystFlavor, file: 'data-analyst.jsonl' },
  'data-engineer': { classifier: classifyDataEngineerFlavor, file: 'data-engineer.jsonl' },
};

const argv = process.argv.slice(2);
const verifyMode = argv.includes('--verify');
const roleFilter = argv.includes('--role') ? argv[argv.indexOf('--role') + 1] : null;

function loadCorpus(file) {
  const fullPath = path.join(CORPUS_DIR, file);
  if (!fs.existsSync(fullPath)) return [];
  return fs
    .readFileSync(fullPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function tally(examples, classify) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const ex of examples) {
    const actual = classify(ex.request);
    const expectedPositive = ex.expected !== null;
    const actualPositive = actual !== null;
    if (expectedPositive && actualPositive && actual === ex.expected) tp += 1;
    else if (expectedPositive && actualPositive && actual !== ex.expected) {
      fp += 1;
      fn += 1;
    } else if (!expectedPositive && actualPositive) fp += 1;
    else if (expectedPositive && !actualPositive) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1, total: examples.length };
}

async function scoreRole(name, { classifier, file }) {
  const examples = loadCorpus(file);
  if (!examples.length) {
    return { name, error: `no corpus at ${file}` };
  }

  const keywordOnly = tally(examples, (req) => classifier(req));
  if (!verifyMode) return { name, total: examples.length, keywordOnly };

  resetCache();
  const verifiedClassify = async (req) => {
    const candidate = classifier(req);
    if (!candidate) return null;
    const r = await verifyIntent({
      request: req,
      specialist: `cx-${name}`,
      flavor: candidate,
    });
    return r.verified && r.confidence >= 0.6 ? candidate : null;
  };

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const ex of examples) {
    const actual = await verifiedClassify(ex.request);
    const expectedPositive = ex.expected !== null;
    const actualPositive = actual !== null;
    if (expectedPositive && actualPositive && actual === ex.expected) tp += 1;
    else if (expectedPositive && actualPositive && actual !== ex.expected) {
      fp += 1;
      fn += 1;
    } else if (!expectedPositive && actualPositive) fp += 1;
    else if (expectedPositive && !actualPositive) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    name,
    total: examples.length,
    keywordOnly,
    verified: { tp, fp, fn, tn, precision, recall, f1, total: examples.length },
  };
}

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

(async () => {
  const targets = roleFilter ? { [roleFilter]: ROLES[roleFilter] } : ROLES;
  if (!Object.keys(targets).length) {
    process.stderr.write(`Unknown role: ${roleFilter}\n`);
    process.exit(2);
  }

  process.stdout.write(`\nRouting classifier F1 — corpus from ${path.relative(process.cwd(), CORPUS_DIR)}\n`);
  process.stdout.write(`${verifyMode ? 'Mode: keyword + LLM verifier' : 'Mode: keyword-only (pass --verify for LLM overlay)'}\n\n`);

  for (const [name, cfg] of Object.entries(targets)) {
    const result = await scoreRole(name, cfg);
    if (result.error) {
      process.stdout.write(`  ${name.padEnd(16)} ${result.error}\n`);
      continue;
    }
    const k = result.keywordOnly;
    process.stdout.write(`  ${name.padEnd(16)} keyword-only  precision=${fmtPct(k.precision)}  recall=${fmtPct(k.recall)}  F1=${fmtPct(k.f1)}  (TP=${k.tp} FP=${k.fp} FN=${k.fn} TN=${k.tn})\n`);
    if (result.verified) {
      const v = result.verified;
      process.stdout.write(`  ${' '.repeat(16)} verified      precision=${fmtPct(v.precision)}  recall=${fmtPct(v.recall)}  F1=${fmtPct(v.f1)}  (TP=${v.tp} FP=${v.fp} FN=${v.fn} TN=${v.tn})\n`);
    }
  }
  process.stdout.write('\n');
})();
