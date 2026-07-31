#!/usr/bin/env node
/**
 * scripts/migrate-project-identity.mjs — project-identity migration runner.
 *
 * Default mode is dry-run: prints the merge plan without writing. Pass `--apply`
 * to copy legacy path-hash buckets into the canonical remote-hash directory.
 * Homedir()-fallback buckets are flagged only, never merged automatically.
 *
 * Usage:
 *   node scripts/migrate-project-identity.mjs [projectRoot]
 *   node scripts/migrate-project-identity.mjs --apply [projectRoot]
 */

import {
  applyProjectIdentityMigration,
  planProjectIdentityMigration,
} from '../lib/project-identity/migrate.mjs';

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const positional = argv.filter((a) => a !== '--apply');
  const projectRoot = positional[2] || process.cwd();
  return { apply, projectRoot };
}

function printPlan(plan) {
  process.stdout.write(`Project root: ${plan.projectRoot}\n`);
  process.stdout.write(`Canonical key: ${plan.canonicalKey}\n`);
  process.stdout.write(`Path-only key: ${plan.pathOnlyKey}\n`);
  process.stdout.write(`Projects root: ${plan.projectsRoot}\n\n`);

  if (plan.actions.length === 0) {
    process.stdout.write('No filesystem merges required.\n');
  } else {
    process.stdout.write('Planned merges:\n');
    for (const action of plan.actions) {
      process.stdout.write(`  ${action.fromKey} -> ${action.toKey}\n`);
      process.stdout.write(`    ${action.from}\n`);
      process.stdout.write(`    -> ${action.to}\n`);
      process.stdout.write(`    (${action.reason})\n`);
    }
  }

  if (plan.flagged.length) {
    process.stdout.write('\nFlagged for manual review:\n');
    for (const item of plan.flagged) {
      process.stdout.write(`  - ${item.dir} (${item.entryCount} entries): ${item.reason}\n`);
    }
  }

  if (plan.notes?.length) {
    process.stdout.write('\nNotes:\n');
    for (const note of plan.notes) process.stdout.write(`  - ${note}\n`);
  }
}

function main() {
  const { apply, projectRoot } = parseArgs(process.argv);
  if (apply) {
    const { plan, results } = applyProjectIdentityMigration(projectRoot);
    printPlan(plan);
    process.stdout.write('\nApply results:\n');
    for (const result of results) {
      process.stdout.write(`  ${result.fromKey} -> ${result.toKey}: merged=${result.merged}, skipped=${result.skipped}, conflicts=${result.conflicts.length}\n`);
      for (const conflict of result.conflicts) {
        process.stdout.write(`    conflict: ${conflict.src} (${conflict.reason})\n`);
      }
    }
    process.stdout.write('\nLegacy source directories were not deleted. Confirm the canonical layout, then remove them manually.\n');
    return;
  }

  printPlan(planProjectIdentityMigration(projectRoot));
  process.stdout.write('\nDry run only. Re-run with --apply to copy legacy buckets into the canonical directory.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
