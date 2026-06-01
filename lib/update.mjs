/**
 * update.mjs — source-checkout update flow for Construct.
 *
 * Reinstalls the current checkout globally, then runs sync and doctor from the
 * checkout code so host adapters and health checks reflect the newly pulled
 * repo state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeVersionStamp } from './maintenance/cleanup.mjs';

const PACKAGE_NAME = '@geraldmaron/construct';

function readPackageJson(dir) {
  const packagePath = path.join(dir, 'package.json');
  if (!fs.existsSync(packagePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch {
    return null;
  }
}

export function isConstructSourceRoot(dir) {
  const pkg = readPackageJson(dir);
  if (!pkg) return false;

  return pkg.name === PACKAGE_NAME
    && pkg.bin?.construct === 'bin/construct'
    && fs.existsSync(path.join(dir, 'bin', 'construct'))
    && fs.existsSync(path.join(dir, 'scripts', 'sync-specialists.mjs'))
    && fs.existsSync(path.join(dir, 'lib', 'cli-commands.mjs'));
}

export function findConstructSourceRoot(startDir) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (isConstructSourceRoot(currentDir)) return currentDir;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return '';
    currentDir = parentDir;
  }
}

export function buildUpdatePlan({ cwd }) {
  const sourceRoot = findConstructSourceRoot(cwd);
  if (!sourceRoot) {
    throw new Error('construct update must be run from inside a Construct source checkout');
  }

  const pkg = readPackageJson(sourceRoot) ?? {};
  const binPath = path.join(sourceRoot, 'bin', 'construct');

  return {
    sourceRoot,
    version: typeof pkg.version === 'string' ? pkg.version : 'unknown',
    steps: [
      {
        label: 'Install current checkout globally',
        command: 'npm',
        args: ['install', '-g', '.'],
        cwd: sourceRoot,
      },
      {
        label: 'Regenerate host adapters',
        command: process.execPath,
        args: [binPath, 'sync', '--no-docs'],
        cwd: sourceRoot,
      },
      // Sweep legacy cx-*.md/.toml/.prompt.md left over from older releases
      // at user scope, so the next doctor doesn't surface the warning.
      {
        label: 'Sweep legacy agents at user scope',
        command: process.execPath,
        args: [binPath, 'doctor', '--fix-legacy-agents'],
        cwd: sourceRoot,
        optional: true,
      },
      {
        label: 'Run health checks',
        command: process.execPath,
        args: [binPath, 'doctor'],
        cwd: sourceRoot,
      },
    ],
  };
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function runStep(step, { spawn, env, stdout }) {
  const result = spawn(step.command, step.args, {
    cwd: step.cwd,
    env,
    stdio: 'inherit',
  });
  if (result?.error) {
    if (step.optional) {
      stdout?.write?.(`  (skipped: ${result.error.message})\n`);
      return;
    }
    throw result.error;
  }
  if ((result?.status ?? 1) !== 0) {
    if (step.optional) {
      stdout?.write?.(`  (skipped: exit ${result?.status ?? 1})\n`);
      return;
    }
    throw new Error(`${step.label} failed with exit code ${result.status ?? 1}`);
  }
}

export function runUpdate({ cwd, env = process.env, spawn = spawnSync, stdout = process.stdout }) {
  const plan = buildUpdatePlan({ cwd });

  stdout.write('Construct Update\n');
  stdout.write('════════════════\n\n');
  stdout.write(`Source checkout: ${plan.sourceRoot}\n`);
  stdout.write(`Version:         ${plan.version}\n\n`);

  for (const step of plan.steps) {
    stdout.write(`→ ${step.label}\n`);
    stdout.write(`  ${formatCommand(step.command, step.args)}\n`);
    runStep(step, { spawn, env, stdout });
  }

  // Advance the cleanup stamp to the checkout version so the next CLI
  // invocation doesn't run a full cleanup pass on the assumption that
  // an upgrade just happened.
  try {
    writeVersionStamp({ version: plan.version, summary: { freedBytes: 0, durationMs: 0 } });
  } catch { /* stamp write is best-effort */ }

  stdout.write('\n✓ Construct updated from current checkout.\n');
  return plan;
}