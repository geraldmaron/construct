/**
 * lib/oracle/invariants/deployment-workflow-targets-real-artifacts.mjs — Layer 1
 * deterministic invariant: every `docker build` a GitHub Actions workflow runs must
 * target a Dockerfile that actually exists at the resolved path, or a dormant/gated
 * deploy job would fail the moment it is ever enabled.
 *
 * Per the oracle-miss-report's rows 36-39: "No invariant mechanically checks 'does the
 * Dockerfile this workflow references exist' — a human had to notice and hand-annotate.
 * ...Authoring/CI time — deployment-workflow-targets-real-artifacts invariant, trivially
 * deterministic (file-existence check against workflow YAML)... the cheapest possible
 * fix in this entire report." `.github/workflows/deploy.yml`'s own header comment
 * confirms the finding is still live (2026-07-16): "there is no root Dockerfile for the
 * `docker build .` step" — and `.github/workflows/aws-smoke.yml` runs the identical
 * `docker build -t construct-smoke:${{ github.sha }} .` against the same missing root
 * Dockerfile. Both jobs are gated dormant (`vars.AWS_DEPLOY_ENABLED`) today, which is
 * exactly the failure mode this invariant exists to catch mechanically instead of via a
 * human re-discovering it every time someone considers flipping the gate.
 *
 * The parser handles the two real shapes observed in this repo's workflows: a bare
 * `docker build -t <tag> <context>` (context defaults to the last non-flag token, and the
 * implied Dockerfile is `<context>/Dockerfile`) and an explicit `-f/--file <path>`
 * override. It does not parse `docker/build-push-action`-style YAML `with: context:/
 * file:` step inputs — no workflow in this repo uses that action; a
 * workflow adopting it would need this parser extended, not silently pass.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export const id = 'deployment-workflow-targets-real-artifacts';
export const layer = 1;
export const description =
  "Every `docker build` in a GitHub Actions workflow must target a Dockerfile that exists at the resolved path.";

/**
 * @param {string} line a single line of a workflow's `run:` shell block
 * @returns {{file: string|null, context: string}|null} null if the line has no docker build invocation
 */
export function parseDockerBuildLine(line) {
  const tokens = line.trim().split(/\s+/);
  const buildIdx = tokens.findIndex((t, i) => t === 'build' && tokens[i - 1] === 'docker');
  if (buildIdx === -1) return null;

  let file = null;
  let context = '.';
  const rest = tokens.slice(buildIdx + 1);
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === '-f' || tok === '--file') {
      file = rest[i + 1];
      i++;
      continue;
    }
    if (tok === '-t' || tok === '--tag') {
      i++;
      continue;
    }
    if (tok.startsWith('-')) continue;
    context = tok;
  }
  return { file, context };
}

function listWorkflowFiles(workflowsDir) {
  let entries;
  try {
    entries = readdirSync(workflowsDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(workflowsDir, f));
}

/**
 * @param {string} workflowPath
 * @param {string} repoRoot resolves the docker build context/Dockerfile path against this root
 */
export function evaluateWorkflowFile(workflowPath, repoRoot) {
  const results = [];
  const source = readFileSync(workflowPath, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, idx) => {
    const parsed = parseDockerBuildLine(line);
    if (!parsed) return;

    const dockerfilePath = parsed.file
      ? path.resolve(repoRoot, parsed.file)
      : path.resolve(repoRoot, parsed.context, 'Dockerfile');
    const exists = existsSync(dockerfilePath);

    results.push({
      workflow: path.basename(workflowPath),
      line: idx + 1,
      dockerfilePath: path.relative(repoRoot, dockerfilePath),
      status: exists ? 'passed' : 'failed',
      violation: !exists,
      detail: exists
        ? `${path.relative(repoRoot, dockerfilePath)} exists`
        : `${path.basename(workflowPath)}:${idx + 1} runs 'docker build' targeting ${path.relative(repoRoot, dockerfilePath)}, which does not exist`,
    });
  });

  return results;
}

/**
 * @param {{cwd?: string, workflowsDir?: string}} [opts]
 */
export async function check({ cwd = process.cwd(), workflowsDir = path.join(cwd, '.github', 'workflows') } = {}) {
  let files;
  try {
    files = listWorkflowFiles(workflowsDir);
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to list ${workflowsDir}: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const results = [];
  for (const file of files) {
    try {
      results.push(...evaluateWorkflowFile(file, cwd));
    } catch (err) {
      results.push({
        workflow: path.basename(file),
        status: 'collection-error',
        detail: `failed to read ${file}: ${err.message || err}`,
      });
    }
  }

  const violations = results.filter((r) => r.status === 'failed');
  const collectionErrors = results.filter((r) => r.status === 'collection-error');
  let status = 'passed';
  if (violations.length > 0) status = 'failed';
  else if (collectionErrors.length > 0) status = 'collection-error';

  return { status, evaluated: results.length, violations, unresolved: [], results };
}
