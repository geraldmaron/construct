/**
 * lib/certification/store.mjs — durable certification run artifacts under .cx/certification/.
 *
 * Each run is stored as .cx/certification/runs/<run-id>/run.json plus optional
 * redacted output siblings referenced by relative paths in the run record.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertCertificationRun, validateCertificationRun } from './run.mjs';
import { configPath } from '../config-dir.mjs';

function findProjectRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function certificationRoot(rootDir = process.cwd()) {
  return configPath(findProjectRoot(rootDir), 'certification');
}

export function certificationRunsRoot(rootDir = process.cwd()) {
  return path.join(certificationRoot(rootDir), 'runs');
}

export function certificationRunDir(runId, rootDir = process.cwd()) {
  return path.join(certificationRunsRoot(rootDir), runId);
}

export function certificationRunPath(runId, rootDir = process.cwd()) {
  return path.join(certificationRunDir(runId, rootDir), 'run.json');
}

export function writeCertificationRun(run, { rootDir = process.cwd(), outputs = {} } = {}) {
  const validation = validateCertificationRun(run);
  if (!validation.valid) throw new Error(validation.errors.join('; '));

  const dir = certificationRunDir(run.id, rootDir);
  fs.mkdirSync(dir, { recursive: true });

  const artifacts = { ...(run.artifacts ?? {}) };
  if (outputs.markdown != null) {
    const rel = 'output.md';
    fs.writeFileSync(path.join(dir, rel), String(outputs.markdown));
    artifacts.outputMarkdown = rel;
  }
  if (outputs.json != null) {
    const rel = 'output.json';
    fs.writeFileSync(path.join(dir, rel), `${JSON.stringify(outputs.json, null, 2)}\n`);
    artifacts.outputJson = rel;
  }

  const record = assertCertificationRun({ ...run, artifacts: Object.keys(artifacts).length ? artifacts : run.artifacts ?? null });
  fs.writeFileSync(certificationRunPath(run.id, rootDir), `${JSON.stringify(record, null, 2)}\n`);
  return { dir, path: certificationRunPath(run.id, rootDir), run: record };
}

export function readCertificationRun(runId, { rootDir = process.cwd() } = {}) {
  const filePath = certificationRunPath(runId, rootDir);
  const run = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const validation = validateCertificationRun(run);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return { filePath, run };
}

export function listCertificationRunIds({ rootDir = process.cwd() } = {}) {
  const runsRoot = certificationRunsRoot(rootDir);
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
