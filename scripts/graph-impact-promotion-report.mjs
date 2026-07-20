#!/usr/bin/env node
/**
 * scripts/graph-impact-promotion-report.mjs — Shadow-to-gating promotion report.
 *
 * Reads historical `.construct/shadow-impact.json` artifacts (one JSON file per
 * CI run under `.construct/shadow-history/` by default), computes recall and
 * precision trends, and emits a promoted/not-promoted verdict against the
 * documented threshold in docs/guides/concepts/test-impact-gating.md.
 *
 * Usage:
 *   node scripts/graph-impact-promotion-report.mjs [--dir <path>] [--json]
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregatePromotionReport,
  loadShadowArtifacts,
  PROMOTION_CRITERIA,
} from './shadow-lib.mjs';
import { isMainModule } from '../lib/roots.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function parseArgs(argv) {
  const json = argv.includes('--json');
  let dir = path.join(REPO_ROOT, '.construct', 'shadow-history');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) {
      dir = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return { json, dir };
}

export function buildPromotionReport({ dir, criteria = PROMOTION_CRITERIA, now = new Date() } = {}) {
  const artifacts = loadShadowArtifacts(dir);
  const report = aggregatePromotionReport(artifacts, criteria, now);
  return {
    ...report,
    artifact_dir: dir,
    artifact_count: artifacts.length,
  };
}

function run(argv = process.argv.slice(2)) {
  const { json, dir } = parseArgs(argv);
  const report = buildPromotionReport({ dir });

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  }

  process.stdout.write('[graph-impact-promotion] Shadow-to-gating promotion report\n');
  process.stdout.write(`  artifact dir: ${report.artifact_dir}\n`);
  process.stdout.write(`  artifacts read: ${report.artifact_count}\n`);
  process.stdout.write(`  eligible runs (window): ${report.eligible_run_count}\n`);
  process.stdout.write(`  outlier runs (window): ${report.outlier_run_count}\n`);
  process.stdout.write(`  aggregate recall: ${report.aggregate_recall ?? 'n/a'}\n`);
  process.stdout.write(`  aggregate precision: ${report.aggregate_precision ?? 'n/a'}\n`);
  process.stdout.write(`  verdict: ${report.verdict}\n`);
  if (report.reasons.length > 0) {
    for (const reason of report.reasons) {
      process.stdout.write(`  - ${reason}\n`);
    }
  }
  return 0;
}

export function writePromotionReportFile(report, outPath) {
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
}

if (isMainModule(import.meta.url)) process.exit(run());
