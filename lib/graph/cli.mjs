/**
 * lib/graph/cli.mjs — `construct matrix` command surface.
 *
 * Subcommands:
 *   build              Regenerate the dependency graph from the registry,
 *                      corpus-annotation, and static import-graph seeds into
 *                      <projectDir>/.cx/graph/.
 *   stat               Print node/edge counts by type and relation.
 *   query <id>         Print a node's dependencies and dependents.
 *   query --missing-tests   List capabilities/workflows with zero inbound
 *                      validates edges (see lib/graph/gaps.mjs).
 *   impacted --changed <files...>   Traverse from changed files to the
 *                      workflows/tests/docs they impact (see
 *                      lib/graph/impacted.mjs); scopes the CI drift gate.
 *   missing-tests, missing-docs, stale, dependencies, providers, surfaces
 *                      Read-only gap queries over the store (see
 *                      lib/graph/gap-queries.mjs).
 *   explain <workflow-id>   Per-workflow narrative: static requirements
 *                      (dependencies/providers/surfaces) plus last-execution
 *                      runtime evidence and execution-staleness (LMCP-C9, see
 *                      lib/graph/runtime-evidence.mjs and the execution
 *                      dimension in lib/graph/staleness.mjs).
 *
 * Seeds are read from the Construct package root (rootDir); the graph is
 * persisted under the active project (projectDir) so it travels with .cx/.
 */

import { buildFromRegistry } from './build-from-registry.mjs';
import { buildImportGraph } from './build-import-graph.mjs';
import { buildCoChange } from './build-co-change.mjs';
import { buildFromCorpus } from './build-from-corpus.mjs';
import { buildRuntimeEvidence } from './runtime-evidence.mjs';
import { writeGraph, loadGraph, dependenciesOf, dependentsOf } from './store.mjs';
import { validateGraph } from './validate.mjs';
import { findMissingTestCapabilities } from './gaps.mjs';
import { computeImpacted } from './impacted.mjs';
import { computeSourceHashes, checkExecutionStaleness } from './staleness.mjs';
import {
  findMissingDocs,
  findStale,
  findDependencies,
  findProviders,
  findSurfaces,
} from './gap-queries.mjs';

function isoNow() {
  return new Date().toISOString();
}

function runBuild({ rootDir, projectDir, json, coChange }) {
  const reg = buildFromRegistry({ rootDir });
  const corpus = buildFromCorpus({ rootDir });
  const validates = [...reg.edges, ...corpus.edges].filter((e) => e.rel === 'validates');
  const imp = buildImportGraph({ rootDir, validates });
  const nodes = [...reg.nodes, ...corpus.nodes, ...imp.nodes];
  const edges = [...reg.edges, ...corpus.edges, ...imp.edges];

  if (coChange) {
    const sourceRels = imp.nodes.filter((n) => n.type === 'file' || n.type === 'test').map((n) => n.name);
    const co = buildCoChange({ rootDir, sourceRels });
    nodes.push(...co.nodes);
    edges.push(...co.edges);
  }

  // Runtime evidence (LMCP-C9) reads persisted orchestration runs off the
  // active project (projectDir), not the Construct package root (rootDir) —
  // runs live under the embedding project's .cx/runtime/orchestration/runs/.
  const evidence = buildRuntimeEvidence({ rootDir: projectDir });
  nodes.push(...evidence.nodes);
  edges.push(...evidence.edges);

  const sourceHash = reg.sourceHash;
  const sourceHashes = computeSourceHashes(projectDir);
  const result = writeGraph(projectDir, { nodes, edges, generatedAt: isoNow(), sourceHash, sourceHashes });
  const meta = loadGraph(projectDir).meta;
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result, meta }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`✓ graph built: ${result.nodeCount} nodes, ${result.edgeCount} edges → ${result.dir}\n`);
  process.stdout.write(`  nodes: ${JSON.stringify(meta.nodesByType)}\n`);
  process.stdout.write(`  edges: ${JSON.stringify(meta.edgesByRel)}\n`);
  return 0;
}

function runStat({ projectDir, json }) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct matrix build` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(graph.meta, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`graph: ${graph.nodes.size} nodes, ${graph.edges.length} edges (generated ${graph.meta?.generatedAt ?? 'unknown'})\n`);
  process.stdout.write(`  nodes: ${JSON.stringify(graph.meta?.nodesByType ?? {})}\n`);
  process.stdout.write(`  edges: ${JSON.stringify(graph.meta?.edgesByRel ?? {})}\n`);
  return 0;
}

function runQuery({ projectDir, id, json }) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct matrix build` first.\n');
    return 1;
  }
  const node = graph.nodes.get(id);
  const deps = dependenciesOf(graph, id);
  const dependents = dependentsOf(graph, id);
  if (json) {
    process.stdout.write(JSON.stringify({ id, found: !!node, node: node ?? null, dependencies: deps, dependents }, null, 2) + '\n');
    return node ? 0 : 1;
  }
  if (!node) {
    process.stderr.write(`node not found: ${id}\n`);
    return 1;
  }
  process.stdout.write(`${id} (${node.type})\n`);
  process.stdout.write(`  → dependencies (${deps.length}): ${deps.join(', ') || '(none)'}\n`);
  process.stdout.write(`  ← dependents   (${dependents.length}): ${dependents.join(', ') || '(none)'}\n`);
  return 0;
}

function runMissingTests({ projectDir, json }) {
  const gaps = findMissingTestCapabilities(projectDir);
  if (!gaps.graphPresent) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(gaps, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`capabilities with zero validating tests (${gaps.capabilities.length}):\n`);
  for (const id of gaps.capabilities) process.stdout.write(`  ${id}\n`);
  process.stdout.write(`workflows with zero validated embedding capability (${gaps.workflows.length}):\n`);
  for (const id of gaps.workflows) process.stdout.write(`  ${id}\n`);
  return 0;
}

function parseChangedArg(args) {
  const idx = args.indexOf('--changed');
  if (idx === -1) return [];
  const rest = args.slice(idx + 1);
  const files = [];
  for (const a of rest) {
    if (a.startsWith('--')) break;
    files.push(a);
  }
  return files;
}

function runImpacted(args, { projectDir, json }) {
  const changed = parseChangedArg(args);
  if (changed.length === 0) {
    process.stderr.write('Usage: construct graph impacted --changed <file...> [--json]\n');
    return 1;
  }

  const result = computeImpacted({ rootDir: projectDir, changedFiles: changed });
  if (!result.graphPresent) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`Changed: ${result.changed.length} file(s)\n`);
  process.stdout.write(`Impacted workflows (${result.impactedWorkflows.length}): ${result.impactedWorkflows.join(', ') || '(none)'}\n`);
  process.stdout.write(`Impacted capabilities (${result.impactedCapabilities.length}): ${result.impactedCapabilities.join(', ') || '(none)'}\n`);
  process.stdout.write(`Impacted tests (${result.impactedTests.length}):\n`);
  for (const t of result.impactedTests) process.stdout.write(`  ${t}\n`);
  process.stdout.write(`Impacted docs (${result.impactedDocs.length}):\n`);
  for (const d of result.impactedDocs) process.stdout.write(`  ${d}\n`);
  if (result.unknown.length) {
    process.stdout.write(`\n⚠ Not in graph (${result.unknown.length}): ${result.unknown.join(', ')}\n`);
  }
  return 0;
}

// `explain` combines a workflow's static requirements (embedding capabilities'
// contracts/uses/requires — the same union findDependencies computes) with
// its runtime-evidence last-execution and execution-staleness (LMCP-C9), so a
// reader sees "what this workflow needs" and "did it actually run" in one
// call instead of cross-referencing `query` and a separate evidence lookup.

function runExplain(args, { projectDir, json }) {
  const id = args.slice(1).find((a) => !a.startsWith('--'));
  if (!id) {
    process.stderr.write('Usage: construct graph explain <workflow-id> [--json]\n');
    return 1;
  }
  const workflowId = id.startsWith('workflow:') ? id : `workflow:${id}`;
  const workflowType = workflowId.slice('workflow:'.length);

  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const node = graph.nodes.get(workflowId);
  if (!node) {
    process.stderr.write(`workflow not found in graph: ${workflowId}\n`);
    return 1;
  }

  const deps = findDependencies(projectDir).workflows[workflowId] || { contracts: [], uses: [], requires: [] };
  const providers = findProviders(projectDir).workflows[workflowId] || [];
  const surfaces = findSurfaces(projectDir).workflows[workflowId] || [];

  const execution = checkExecutionStaleness(projectDir);
  const executionState = execution.workflows[workflowType] || {
    lastExecution: null, neverExecuted: true, stale: false, ageDays: null, thresholdDays: null,
  };

  const result = {
    id: workflowId,
    node,
    dependencies: deps,
    providers,
    surfaces,
    execution: executionState,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`${workflowId}\n`);
  process.stdout.write(`  contracts (${deps.contracts.length}): ${deps.contracts.join(', ') || '(none)'}\n`);
  process.stdout.write(`  uses      (${deps.uses.length}): ${deps.uses.join(', ') || '(none)'}\n`);
  process.stdout.write(`  requires  (${deps.requires.length}): ${deps.requires.join(', ') || '(none)'}\n`);
  process.stdout.write(`  providers (${providers.length}): ${providers.join(', ') || '(none)'}\n`);
  process.stdout.write(`  surfaces  (${surfaces.length}): ${surfaces.join(', ') || '(none)'}\n`);
  if (executionState.neverExecuted) {
    process.stdout.write('  execution: NEVER EXECUTED — no runtime evidence found\n');
  } else {
    const { lastExecution, stale, ageDays: age, thresholdDays } = executionState;
    process.stdout.write(`  execution: last run ${lastExecution.timestamp} (outcome: ${lastExecution.outcome}, run ${lastExecution.runId})\n`);
    process.stdout.write(`             age: ${age?.toFixed(1)}d / threshold: ${thresholdDays}d — ${stale ? 'STALE' : 'fresh'}\n`);
  }
  return 0;
}

// Uniform runner for the six read-only gap-query subcommands (C5): each
// query function takes projectDir and returns { graphPresent, ...payload };
// --json dumps the payload verbatim, non-JSON falls back to the same shape
// so a human running the command still sees structured field names.

function runGapQuery(queryFn, { projectDir, json }) {
  const result = queryFn(projectDir);
  if (!result.graphPresent) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
}

function runValidate(args, { rootDir, projectDir }) {
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const result = validateGraph(projectDir || rootDir, { strict });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const err of result.errors) console.error(`  error: ${err}`);
    for (const warn of result.warnings) console.error(`  warn:  ${warn}`);
    for (const info of result.infos) console.log(`  info:  ${info}`);
    if (result.errors.length > 0) {
      console.error(`\n  ✖ ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    } else if (result.warnings.length > 0) {
      console.log(`\n  ✓ ${result.warnings.length} warning(s)`);
    } else {
      console.log('\n  ✓ graph is valid');
    }
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

/**
 * @param {string[]} args
 * @param {{ rootDir: string, projectDir: string }} ctx
 * @returns {number} exit code
 */
export function runGraphCli(args, { rootDir, projectDir }) {
  const sub = args[0] || 'stat';
  const json = args.includes('--json');
  if (sub === 'build') return runBuild({ rootDir, projectDir, json, coChange: !args.includes('--no-co-change') });
  if (sub === 'stat') return runStat({ projectDir, json });
  if (sub === 'query') {
    if (args.includes('--missing-tests')) return runMissingTests({ projectDir, json });
    const id = args.slice(1).find((a) => !a.startsWith('--'));
    if (!id) {
      process.stderr.write('Usage: construct matrix query <node-id> [--json]\n');
      return 1;
    }
    return runQuery({ projectDir, id, json });
  }
  if (sub === 'validate') {
    return runValidate(args, { rootDir, projectDir });
  }
  if (sub === 'impacted') return runImpacted(args, { projectDir, json });
  if (sub === 'missing-tests') return runMissingTests({ projectDir, json });
  if (sub === 'missing-docs') return runGapQuery(findMissingDocs, { projectDir, json });
  if (sub === 'stale') return runGapQuery(findStale, { projectDir, json });
  if (sub === 'dependencies') return runGapQuery(findDependencies, { projectDir, json });
  if (sub === 'providers') return runGapQuery(findProviders, { projectDir, json });
  if (sub === 'surfaces') return runGapQuery(findSurfaces, { projectDir, json });
  if (sub === 'explain') return runExplain(args, { projectDir, json });
  process.stderr.write(`Unknown graph subcommand: ${sub}. Available: build, stat, query, validate, impacted, missing-tests, missing-docs, stale, dependencies, providers, surfaces, explain\n`);
  return 1;
}
