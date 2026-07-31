/**
 * lib/graph/cli.mjs — `construct graph` command surface.
 *
 * Subcommands:
 *   build              Regenerate the dependency graph from the registry,
 * corpus-annotation, embed-manifest, and static
 *                      import-graph seeds into <projectDir>/.construct/graph/.
 *   build-targets      Build + persist one import/symbol graph per registered
 * content-capable source target (see
 *                      lib/graph/build-target-graph.mjs), under
 *                      <projectDir>/.construct/graph/targets/<targetId>/. Distinct
 *                      from `build`, which only ever covers the host project.
 *   stat               Print node/edge counts by type and relation.
 *   query <id>         Print a node's dependencies and dependents.
 *   query --type <t>   List every node of one type with its dependencies
 *                      (e.g. `--type embed` enumerates the embed presets).
 *   query --missing-tests   List capabilities/workflows with zero inbound
 *                      validates edges (see lib/graph/gaps.mjs).
 *   query/query --type ... --projects=<id,...>|all|self   Scope a query to one
 *                      or more registered targets' persisted graphs (built by
 *                      `build-targets`) instead of the host graph — the same
 *                      `--projects` semantics `knowledge_search` uses
 *                      (lib/sources/content-roots.mjs's expandProjectsFilter).
 *   impacted --changed <files...>   Traverse from changed files to the
 *                      workflows/tests/docs they impact (see
 *                      lib/graph/impacted.mjs); scopes the CI drift gate.
 *   intent declare|show|list        Pre-change intent records with impact
 *                      packets (see lib/graph/change-intent.mjs).
 *   verify [--json] [--intent <id>] [--changed <files...>]
 *                      Blocking guardrail composing strict validate, schema
 *                      checks, partial-graph detection, and optional
 * change-intent impact diff.
 *   missing-tests [--security], missing-docs, stale, dependencies, providers,
 *                      surfaces   Read-only gap queries over the store (see
 *                      lib/graph/gap-queries.mjs). `missing-tests --security`
 *                      lists workflows/embed presets with no `secures` edge.
 *   owasp              OWASP GenAI Top-10 coverage matrix generated from the
 * graph's `@owasp`-tagged security tests (see
 *                      lib/graph/security-coverage.mjs).
 *   explain <workflow-id>   Full ownership picture, grouped by every
 * EDGE_RELS relation plus manifest roleChain:
 *                      absent-but-expected links print as MISSING, matching
 *                      `graph validate` findings. Also carries last-execution
 *                      runtime evidence and execution-staleness (see
 *                      lib/graph/runtime-evidence.mjs and the execution
 *                      dimension in lib/graph/staleness.mjs).
 *
 * Relational-store subcommands (each
 * requires the relational store — node:sqlite, Node >=22.5):
 *   update             Drain the transactional outbox (lib/graph/relational/
 *                      outbox.mjs), applying incremental deltas, and report
 *                      the trust decision (lib/graph/relational/reconcile.mjs).
 *   reconcile          Re-seed the full graph and diff it against live state
 *                      (lib/graph/relational/reconcile.mjs); applies the diff
 *                      and reports what drifted, or confirms an empty diff.
 *   queryUp <id> [--rel <r>...]   Every node upstream of <id> — its
 *                      transitive dependencies (directive §4.8 "query
 *                      up/downstream", the recursive-CTE port of store.mjs
 *                      dependenciesOf, graph-store-design.md §6) — with
 *                      each node's shortest depth, along embeds/contains/
 *                      requires/owned_by by default (the
 *                      rel-filter/depth-cap applies — same rationale as
 *                      `path`); pass --rel to search a different relation
 *                      set, e.g. --rel imports.
 *   queryDown <id> [--rel <r>...]   Every node downstream of <id> — its
 *                      transitive dependents (the recursive-CTE port of
 *                      dependentsOf; same direction queryImpact walks, so a
 *                      change to <id> ripples "down" to these), same
 *                      rel-filter/depth-cap and default rels as queryUp.
 *   path <from> <to> [--rel <r>...]   Shortest directed path between two
 *                      nodes, along embeds/contains/requires/owned_by by
 *                      default ('imports' is dense enough
 *                      to make an unbounded traversal hang, see
 *                      lib/graph/relational/queries.mjs's header); pass
 *                      --rel to search a different relation set, e.g. --rel
 *                      imports.
 *   orphans [--capabilities]   Structurally unreferenced nodes, or (with
 *                      --capabilities) capabilities with no inbound
 *                      implementation/test edge.
 *   cycles [--rel <r>...]   Relation-scoped cycle detection.
 *   owners <id>        Owning subsystem + owned_by targets.
 *   requirements <id>  Direct dependency lookup along imports/uses/realizes.
 *   export [--format=json|mermaid|dot]   Full JSON dump or a human-readable
 *                      diagram of the active edge set.
 *
 * Seeds are read from the Construct package root (rootDir); the graph is
 * persisted under the active project (projectDir) so it travels with .construct/.
 */

import path from 'node:path';
import { buildFromRegistry } from './build-from-registry.mjs';
import { buildFromCards } from './build-from-cards.mjs';
import { buildImportGraph } from './build-import-graph.mjs';
import { buildCoChange } from './build-co-change.mjs';
import { buildFromCorpus } from './build-from-corpus.mjs';
import { buildFromEmbed } from './build-from-embed.mjs';
import { buildFromPrompts } from './build-from-prompts.mjs';
import { buildAssuranceEdges } from './build-assurance-edges.mjs';
import { buildFromSecurity, buildOwaspMatrix, findProceduresMissingSecurity, OWASP_GENAI_TOP10 } from './security-coverage.mjs';
import { buildRuntimeEvidence } from './runtime-evidence.mjs';
import { buildSourceLinks } from './build-source-links.mjs';
import { writeGraph, loadGraph, dependenciesOf, dependentsOf, nodesByType } from './store.mjs';
import { mergeGraphSlices } from './normalize.mjs';
import { buildTargetGraphs, loadTargetGraph } from './build-target-graph.mjs';
import { validateGraph } from './validate.mjs';
import { validateSchema } from './schema.mjs';
import { findMissingTestCapabilities } from './gaps.mjs';
import { computeImpacted } from './impacted.mjs';
import { declareChangeIntent, loadChangeIntent, listChangeIntents } from './change-intent.mjs';
import { verifyGraph } from './verify.mjs';
import { computeSourceHashes } from './staleness.mjs';
import {
  findMissingDocs,
  findStale,
  findDependencies,
  findProviders,
  findSurfaces,
} from './gap-queries.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { expandProjectsFilter, SELF_PROJECT_KEY } from '../sources/content-roots.mjs';
import { sqliteAvailable } from './relational/sqlite-db.mjs';
import { drainOutbox, outboxState } from './relational/outbox.mjs';
import { reconcileGraph, computeTrustDecision } from './relational/reconcile.mjs';
import { queryUp, queryDown, queryPath, queryOrphans, queryOrphanedCapabilities, queryCycles, queryOwners, queryRequirements } from './relational/queries.mjs';
import { exportGraphJson, exportGraphDiagram } from './relational/export.mjs';
import { explainWorkflow } from './explain-workflow.mjs';
import {
  graphAtTime,
  whatChangedBetween,
  whatReplaced,
  whichReleaseRemoved,
  compactHistory,
  listSnapshots,
  earliestSnapshotDate,
} from './history.mjs';

function isoNow() {
  return new Date().toISOString();
}

// `--projects` on `query`/`query --type` reuses the exact
// filter-expansion lib/knowledge/search.mjs already established for
// `knowledge_search` — same targets, same `all`/`self`/id semantics, same
// unknown-id hard error — so a project id means one thing across both
// surfaces. An unresolvable id throws, which callers turn into a CLI error.

function parseProjectsArg(args) {
  const flag = args.find((a) => a.startsWith('--projects='));
  return flag ? flag.slice('--projects='.length) : null;
}

function resolveProjectsFilter(projectDir, projectsArg) {
  const { config } = loadProjectConfig(projectDir);
  const targets = resolveEffectiveSourceTargetsFromConfig(config);
  return expandProjectsFilter(projectsArg, targets);
}

// One graph per selected project key: `self` is the host graph
// (.construct/graph/), everything else is a target's persisted graph
// (.construct/graph/targets/<targetId>/, built by `graph build-targets`). A target
// never built yet loads with `exists: false` rather than throwing, so a
// caller sees which projects have no graph instead of a crash.

function loadSelectedGraphs(projectDir, filter) {
  const selected = [];
  if (filter.includeSelf) selected.push({ projectKey: SELF_PROJECT_KEY, graph: loadGraph(projectDir) });
  for (const targetId of filter.ids) selected.push({ projectKey: targetId, graph: loadTargetGraph(projectDir, targetId) });
  return selected;
}

// Shared by `build` and `reconcile` (LMCP-b0nny.3): both need the identical
// freshly-seeded {nodes, edges, sourceHash, sourceHashes} set — reconcile
// diffs it against live state instead of unconditionally replacing, so it
// must run the exact same seeders `build` does, not a re-derived subset.
//
// `safeStep` catches a seeder that throws partway through so the rest of the
// build proceeds and `runBuild` can mark the graph `partial: true` instead of
// crashing the CLI with no durable record of what was collected.

function emptySlice() {
  return { nodes: [], edges: [], errors: [], warnings: [] };
}

function assembleHostGraph({ rootDir, projectDir, coChange, onPartial } = {}) {
  const partialReasons = [];
  function safeStep(label, fn) {
    try {
      return fn();
    } catch (err) {
      partialReasons.push(`${label} threw: ${err.message}`);
      return emptySlice();
    }
  }

  const reg = safeStep('buildFromRegistry', () => buildFromRegistry({ rootDir }));
  const corpus = safeStep('buildFromCorpus', () => buildFromCorpus({ rootDir }));

  // Embed presets + security tests and their annotations ship with the package,
  // so these seeders read from rootDir like buildFromRegistry/buildFromCorpus —
  // not projectDir, which holds only per-project runtime state (enablement,
  // evidence) and carries no tests/ tree.
  const embed = safeStep('buildFromEmbed', () => buildFromEmbed({ rootDir }));
  const security = safeStep('buildFromSecurity', () => buildFromSecurity({ rootDir }));
  const assurance = safeStep('buildAssuranceEdges', () => buildAssuranceEdges({ rootDir }));
  const cards = safeStep('buildFromCards', () => buildFromCards({ rootDir, cwd: projectDir }));
  const prompts = safeStep('buildFromPrompts', () => buildFromPrompts({ rootDir }));

  // Only capability-targeted validates edges (registry + corpus) feed the
  // import graph's realizes derivation — it maps a capability to the files its
  // tests transitively reach. Embed/security edges have no such file
  // realization, so they are kept in the graph but withheld from this input.
  const validates = [...(reg.edges || []), ...(corpus.edges || [])].filter((e) => e.rel === 'validates');
  const impPkg = safeStep('buildImportGraph(package)', () => buildImportGraph({ rootDir, validates }));
  const imp = path.resolve(projectDir) === path.resolve(rootDir)
    ? impPkg
    : mergeGraphSlices(
      impPkg,
      safeStep('buildImportGraph(project)', () => buildImportGraph({ rootDir: projectDir, validates })),
    );
  const nodes = [
    ...(reg.nodes || []), ...(corpus.nodes || []), ...(embed.nodes || []),
    ...(security.nodes || []), ...(assurance.nodes || []), ...(cards.nodes || []),
    ...(prompts.nodes || []), ...(imp.nodes || []),
  ];
  const edges = [
    ...(reg.edges || []), ...(corpus.edges || []), ...(embed.edges || []),
    ...(security.edges || []), ...(assurance.edges || []), ...(cards.edges || []),
    ...(prompts.edges || []), ...(imp.edges || []),
  ];

  const buildErrors = [...(embed.errors || []), ...(reg.errors || [])];
  const buildWarnings = [...(reg.warnings || []), ...(corpus.warnings || [])];

  if (coChange) {
    const sourceRels = (imp.nodes || []).filter((n) => n.type === 'file' || n.type === 'test').map((n) => n.name);
    const co = safeStep('buildCoChange', () => buildCoChange({ rootDir, sourceRels }));
    nodes.push(...(co.nodes || []));
    edges.push(...(co.edges || []));
    buildWarnings.push(...(co.warnings || []));
  }

  // Runtime evidence reads persisted orchestration runs off the
  // active project (projectDir), not the Construct package root (rootDir) —
  // runs live under the embedding project's machine-scoped state root
  // keyed by projectDir.
  const evidence = safeStep('buildRuntimeEvidence', () => buildRuntimeEvidence({ rootDir: projectDir, repoRoot: rootDir }));
  nodes.push(...(evidence.nodes || []));
  edges.push(...(evidence.edges || []));

  // Source-link provenance scans the embedding project's artifact tree.
  const sourceLinks = safeStep('buildSourceLinks', () => buildSourceLinks({ rootDir: projectDir }));
  nodes.push(...(sourceLinks.nodes || []));
  edges.push(...(sourceLinks.edges || []));

  if (typeof onPartial === 'function' && partialReasons.length) onPartial(partialReasons);

  return {
    nodes,
    edges,
    sourceHash: reg.sourceHash,
    sourceHashes: computeSourceHashes(projectDir),
    partialReasons,
    buildErrors,
    buildWarnings,
  };
}

function runBuild({ rootDir, projectDir, json, coChange, allowPartial = false }) {
  let partialReasons = [];
  const assembled = assembleHostGraph({
    rootDir,
    projectDir,
    coChange,
    onPartial: (reasons) => { partialReasons = reasons; },
  });
  partialReasons = assembled.partialReasons || partialReasons;
  const { nodes, edges, sourceHash, sourceHashes, buildErrors, buildWarnings } = assembled;
  const partial = partialReasons.length > 0;
  const result = writeGraph(projectDir, {
    nodes,
    edges,
    generatedAt: isoNow(),
    sourceHash,
    sourceHashes,
    partial,
    partialReasons,
  });
  const writtenGraph = loadGraph(projectDir);
  const meta = writtenGraph.meta;
  const schemaErrors = validateSchema(writtenGraph).errors;
  const ok = buildErrors.length === 0 && schemaErrors.length === 0 && (!partial || allowPartial);

  if (json) {
    process.stdout.write(JSON.stringify({
      ok,
      ...result,
      meta,
      errors: buildErrors,
      warnings: buildWarnings,
      partial,
      partialReasons,
      schemaErrors,
    }, null, 2) + '\n');
    return ok ? 0 : 1;
  }

  for (const err of buildErrors) process.stderr.write(`  error: ${err}\n`);
  for (const warn of buildWarnings) process.stderr.write(`  warn:  ${warn}\n`);
  process.stdout.write(`✓ graph built: ${result.nodeCount} nodes, ${result.edgeCount} edges → ${result.dir}\n`);
  process.stdout.write(`  nodes: ${JSON.stringify(meta.nodesByType)}\n`);
  process.stdout.write(`  edges: ${JSON.stringify(meta.edgesByRel)}\n`);
  if (buildErrors.length > 0) {
    process.stdout.write(`⚠ ${buildErrors.length} seeder error(s) — see details above\n`);
  }
  if (buildWarnings.length > 0) {
    process.stdout.write(`⚠ ${buildWarnings.length} seeder warning(s) — see details above\n`);
  }
  for (const err of schemaErrors) process.stdout.write(`  schema error: ${err}\n`);
  if (partial) {
    process.stdout.write(`⚠ partial build (${partialReasons.length} reason(s)):\n`);
    for (const reason of partialReasons) process.stdout.write(`  - ${reason}\n`);
    if (!allowPartial) process.stdout.write('  pass --allow-partial to accept a partial graph\n');
  }
  return ok ? 0 : 1;
}

// `build-targets`: one import/symbol graph per
// registered content-capable source target, persisted independently under
// `.construct/graph/targets/<targetId>/` so each target's graph survives a session
// restart the same way the host graph does. Distinct from `build`, which
// only ever covers the host project's own rootDir.

function runBuildTargets({ projectDir, json }) {
  const { built } = buildTargetGraphs({ projectDir });
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, targets: built }, null, 2) + '\n');
    return 0;
  }
  if (!built.length) {
    process.stdout.write('No content-capable registered targets found — nothing built.\n');
    return 0;
  }
  process.stdout.write(`✓ built ${built.length} target graph(s):\n`);
  for (const t of built) {
    process.stdout.write(`  ${t.targetId}: ${t.nodeCount} nodes, ${t.edgeCount} edges → ${t.dir}\n`);
  }
  return 0;
}

function runStat({ projectDir, json }) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
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

function queryOneGraph(graph, id) {
  if (!graph.exists) return { graphPresent: false, found: false, node: null, dependencies: [], dependents: [] };
  const node = graph.nodes.get(id);
  return {
    graphPresent: true,
    found: !!node,
    node: node ?? null,
    dependencies: dependenciesOf(graph, id),
    dependents: dependentsOf(graph, id),
  };
}

function runQuery({ projectDir, id, json, projects }) {
  if (projects) {
    let filter;
    try { filter = resolveProjectsFilter(projectDir, projects); } catch (err) { process.stderr.write(`${err.message}\n`); return 1; }
    const results = loadSelectedGraphs(projectDir, filter).map(({ projectKey, graph }) => ({ projectKey, ...queryOneGraph(graph, id) }));
    const anyFound = results.some((r) => r.found);
    if (json) {
      process.stdout.write(JSON.stringify({ id, projects: results }, null, 2) + '\n');
      return anyFound ? 0 : 1;
    }
    for (const r of results) {
      if (!r.graphPresent) {
        process.stdout.write(`[${r.projectKey}] no graph found — run \`construct graph build-targets\` first\n`);
        continue;
      }
      if (!r.found) {
        process.stdout.write(`[${r.projectKey}] node not found: ${id}\n`);
        continue;
      }
      process.stdout.write(`[${r.projectKey}] ${id} (${r.node.type})\n`);
      process.stdout.write(`  → dependencies (${r.dependencies.length}): ${r.dependencies.join(', ') || '(none)'}\n`);
      process.stdout.write(`  ← dependents   (${r.dependents.length}): ${r.dependents.join(', ') || '(none)'}\n`);
    }
    return anyFound ? 0 : 1;
  }

  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
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

// `query --type <t>` lists every node of one type with its outbound
// dependencies — the entry point the P6 acceptance uses to enumerate embed
// nodes (`--type embed`), but generic over any NODE_TYPES member.

function matchesForGraph(graph, type) {
  if (!graph.exists) return null;
  return nodesByType(graph, type).map((node) => ({
    id: node.id,
    node,
    dependencies: dependenciesOf(graph, node.id),
    dependents: dependentsOf(graph, node.id),
  }));
}

function runQueryByType({ projectDir, type, json, projects }) {
  if (projects) {
    let filter;
    try { filter = resolveProjectsFilter(projectDir, projects); } catch (err) { process.stderr.write(`${err.message}\n`); return 1; }
    const perProject = loadSelectedGraphs(projectDir, filter).map(({ projectKey, graph }) => ({
      projectKey,
      graphPresent: graph.exists,
      nodes: matchesForGraph(graph, type) ?? [],
    }));
    if (json) {
      process.stdout.write(JSON.stringify({ type, projects: perProject }, null, 2) + '\n');
      return 0;
    }
    for (const p of perProject) {
      if (!p.graphPresent) {
        process.stdout.write(`[${p.projectKey}] no graph found — run \`construct graph build-targets\` first\n`);
        continue;
      }
      process.stdout.write(`[${p.projectKey}] ${type} nodes (${p.nodes.length}):\n`);
      for (const m of p.nodes) {
        process.stdout.write(`  ${m.id}\n`);
        process.stdout.write(`    → ${m.dependencies.join(', ') || '(none)'}\n`);
      }
    }
    return 0;
  }

  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const matches = matchesForGraph(graph, type);
  if (json) {
    process.stdout.write(JSON.stringify({ type, count: matches.length, nodes: matches }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`${type} nodes (${matches.length}):\n`);
  for (const m of matches) {
    process.stdout.write(`  ${m.id}\n`);
    process.stdout.write(`    → ${m.dependencies.join(', ') || '(none)'}\n`);
  }
  return 0;
}

// `missing-tests --security`: workflows with no inbound `secures`
// edge — the security-coverage gap list, distinct from the capability
// test-coverage gaps runMissingTests reports.

function runMissingSecurity({ projectDir, json }) {
  const gaps = findProceduresMissingSecurity(projectDir);
  if (!gaps.graphPresent) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(gaps, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`Procedures with zero linked security tests (${gaps.procedures.length}):\n`);
  for (const id of gaps.procedures) process.stdout.write(`  ${id}\n`);
  return 0;
}

// `graph owasp`: the OWASP GenAI Top-10 coverage matrix, generated
// from the graph's security-test nodes. Every category is listed with its test
// count so uncovered categories are visible, not silently absent.

function runOwaspMatrix({ projectDir, json }) {
  const matrix = buildOwaspMatrix(projectDir);
  if (!matrix.graphPresent) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(matrix, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`OWASP GenAI Top-10 coverage (${OWASP_GENAI_TOP10.length} categories):\n`);
  for (const cat of matrix.categories) {
    const mark = cat.testCount === 0 ? '✗' : '✓';
    process.stdout.write(`  ${mark} ${cat.id} ${cat.name}: ${cat.testCount} test(s)\n`);
  }
  if (matrix.uncovered.length) process.stdout.write(`\nuncovered: ${matrix.uncovered.join(', ')}\n`);
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

function parseTargetArg(args) {
  const idx = args.indexOf('--target');
  if (idx === -1) return [];
  const rest = args.slice(idx + 1);
  const targets = [];
  for (const a of rest) {
    if (a.startsWith('--')) break;
    targets.push(a);
  }
  return targets;
}

function runIntent(args, { projectDir, json }) {
  const sub = args[0];
  if (sub === 'declare') {
    const targets = parseTargetArg(args);
    if (targets.length === 0) {
      process.stderr.write('Usage: construct graph intent declare --target <node-id...> [--json]\n');
      return 1;
    }
    try {
      const intent = declareChangeIntent({ rootDir: projectDir, targets });
      if (json) {
        process.stdout.write(JSON.stringify(intent, null, 2) + '\n');
        return 0;
      }
      process.stdout.write(`Declared change intent ${intent.id}\n`);
      process.stdout.write(`Targets: ${intent.targets.join(', ')}\n`);
      process.stdout.write(`Impacted workflows (${intent.packet.impactedWorkflows.length}): ${intent.packet.impactedWorkflows.join(', ') || '(none)'}\n`);
      process.stdout.write(`Impacted tests (${intent.packet.impactedTests.length})\n`);
      process.stdout.write(`Impacted docs (${intent.packet.impactedDocs.length})\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
  }

  if (sub === 'show') {
    const intentId = args.slice(1).find((a) => !a.startsWith('--'));
    if (!intentId) {
      process.stderr.write('Usage: construct graph intent show <intent-id> [--json]\n');
      return 1;
    }
    const intent = loadChangeIntent({ rootDir: projectDir, intentId });
    if (!intent) {
      process.stderr.write(`Unknown intent: ${intentId}\n`);
      return 1;
    }
    if (json) {
      process.stdout.write(JSON.stringify(intent, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`${intent.id} (${intent.status})\n`);
    process.stdout.write(`Declared: ${intent.declaredAt}\n`);
    process.stdout.write(`Targets: ${intent.targets.join(', ')}\n`);
    return 0;
  }

  if (sub === 'list') {
    const intents = listChangeIntents({ rootDir: projectDir });
    if (json) {
      process.stdout.write(JSON.stringify(intents, null, 2) + '\n');
      return 0;
    }
    if (!intents.length) {
      process.stdout.write('No change intents declared.\n');
      return 0;
    }
    for (const intent of intents) {
      process.stdout.write(`${intent.id}\t${intent.declaredAt}\t${intent.targets.join(', ')}\n`);
    }
    return 0;
  }

  process.stderr.write('Usage: construct graph intent <declare|show|list> ...\n');
  return 1;
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

function runExplain(args, { projectDir, json }) {
  const id = args.slice(1).find((a) => !a.startsWith('--'));
  if (!id) {
    process.stderr.write('Usage: construct graph explain <procedure-id> [--json]\n');
    return 1;
  }

  const payload = explainWorkflow(projectDir, id);
  if (!payload.graphPresent) {
    process.stderr.write(`${payload.message}\n`);
    return 1;
  }
  if (payload.notFound) {
    process.stderr.write(`${payload.message}\n`);
    return 1;
  }

  const result = payload.result;
  const allSections = result.sections;
  const deps = result.dependencies;
  const providers = result.providers;
  const surfaces = result.surfaces;
  const executionState = result.execution;

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`${result.id}\n`);
  for (const section of allSections) {
    if (!section.applicable) continue;
    if (section.missing) {
      process.stdout.write(`  ${section.label}: MISSING\n`);
    } else {
      process.stdout.write(`  ${section.label} (${section.links.length}): ${section.links.join(', ') || '(none)'}\n`);
    }
    if (section.violations?.length) {
      for (const v of section.violations) process.stdout.write(`    ! ${v}\n`);
    }
    if (section.provenance) {
      process.stdout.write(`    source: ${section.provenance.source} (${section.provenance.filePath || 'n/a'})\n`);
      for (const shadow of section.provenance.shadows) {
        process.stdout.write(`    overrides: ${shadow.source} (${shadow.filePath || 'n/a'})\n`);
      }
    }
  }
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

// Uniform runner for the six read-only gap-query subcommands: each
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

// The five relational-only capabilities the JSONL store never had (design
// doc §7: path, orphans, cycles, incremental update, export diagram) plus
// owners/requirements/reconcile. Every one requires the relational store
// (node:sqlite, Node >=22.5) since they run recursive-CTE SQL directly — on
// an older runtime they report the same remediation run-store-sqlite.mjs
// callers already see, rather than a bare stack trace.

function requireRelational() {
  if (sqliteAvailable()) return null;
  process.stderr.write('This command requires the relational graph store (node:sqlite, Node >=22.5).\n');
  return 1;
}

function runUpdate({ rootDir, projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const before = outboxState(projectDir);
  const drain = drainOutbox(projectDir);
  const after = outboxState(projectDir);
  const trust = computeTrustDecision(projectDir, { freshSourceHashes: computeSourceHashes(projectDir) });
  const result = { ok: true, before, drain, after, trust };
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`drained: applied ${drain.applied}, failed ${drain.failed}, dead-lettered ${drain.deadLettered}\n`);
  process.stdout.write(`outbox now: ${JSON.stringify(after)}\n`);
  process.stdout.write(trust.trustIncremental ? '✓ incremental state trusted\n' : `⚠ full rebuild recommended: ${trust.reasons.join('; ')}\n`);
  return 0;
}

function runReconcile({ rootDir, projectDir, json, coChange }) {
  const guard = requireRelational();
  if (guard) return guard;
  const fresh = assembleHostGraph({ rootDir, projectDir, coChange });
  const result = reconcileGraph(projectDir, { ...fresh, generatedAt: isoNow() });
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
    return 0;
  }
  if (result.empty) {
    process.stdout.write('✓ reconciled: incremental state matched a full rebuild exactly (no drift)\n');
  } else {
    process.stdout.write('⚠ reconciled: drift found and applied\n');
    process.stdout.write(`  nodes  added ${result.nodes.added.length}, removed ${result.nodes.removed.length}, changed ${result.nodes.changed.length}\n`);
    process.stdout.write(`  edges  added ${result.edges.added.length}, removed ${result.edges.removed.length}, changed ${result.edges.changed.length}\n`);
  }
  return 0;
}

function parsePositional(args, flagNames) {
  return args.slice(1).filter((a) => !a.startsWith('--') && !flagNames.includes(a));
}

function runPath(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const [from, to] = parsePositional(args, []);
  if (!from || !to) {
    process.stderr.write('Usage: construct graph path <from-node-id> <to-node-id> [--rel <r>...] [--json]\n');
    return 1;
  }
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const relIdx = args.indexOf('--rel');
  const rels = relIdx !== -1 ? args.slice(relIdx + 1).filter((a) => !a.startsWith('--')) : undefined;
  const result = queryPath(projectDir, from, to, rels ? { rels } : {});
  if (json) {
    process.stdout.write(JSON.stringify({ from, to, found: !!result, ...(result || {}) }, null, 2) + '\n');
    return result ? 0 : 1;
  }
  if (!result) {
    process.stdout.write(`no path found: ${from} -> ${to}\n`);
    return 1;
  }
  process.stdout.write(`${result.chain.join(' -> ')} (depth ${result.depth})\n`);
  return 0;
}

// queryUp/queryDown: the "query
// up/downstream" surface — exported from queries.mjs,
// but never wired to a CLI verb. Same requireRelational guard, --rel parsing,
// and not-found handling as `path`; each row carries the node's shortest
// depth from <id> (queries.mjs GROUP BY id / MIN(depth)).

function runQueryUp(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const [id] = parsePositional(args, []);
  if (!id) {
    process.stderr.write('Usage: construct graph queryUp <node-id> [--rel <r>...] [--json]\n');
    return 1;
  }
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const relIdx = args.indexOf('--rel');
  const rels = relIdx !== -1 ? args.slice(relIdx + 1).filter((a) => !a.startsWith('--')) : undefined;
  const rows = queryUp(projectDir, id, rels ? { rels } : {});
  if (json) {
    process.stdout.write(JSON.stringify({ id, count: rows.length, upstream: rows }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`upstream of ${id} (${rows.length}):\n`);
  for (const r of rows) process.stdout.write(`  ${r.id} (depth ${r.depth})\n`);
  return 0;
}

function runQueryDown(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const [id] = parsePositional(args, []);
  if (!id) {
    process.stderr.write('Usage: construct graph queryDown <node-id> [--rel <r>...] [--json]\n');
    return 1;
  }
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const relIdx = args.indexOf('--rel');
  const rels = relIdx !== -1 ? args.slice(relIdx + 1).filter((a) => !a.startsWith('--')) : undefined;
  const rows = queryDown(projectDir, id, rels ? { rels } : {});
  if (json) {
    process.stdout.write(JSON.stringify({ id, count: rows.length, downstream: rows }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`downstream of ${id} (${rows.length}):\n`);
  for (const r of rows) process.stdout.write(`  ${r.id} (depth ${r.depth})\n`);
  return 0;
}

function runOrphans(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const capabilitiesOnly = args.includes('--capabilities');
  const rows = capabilitiesOnly ? queryOrphanedCapabilities(projectDir) : queryOrphans(projectDir);
  if (json) {
    process.stdout.write(JSON.stringify({ capabilitiesOnly, count: rows.length, orphans: rows }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`orphans (${rows.length}):\n`);
  for (const r of rows) process.stdout.write(`  ${r.id}${r.node_type ? ` (${r.node_type})` : ''}\n`);
  return 0;
}

function runCycles(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const relIdx = args.indexOf('--rel');
  const rels = relIdx !== -1 ? args.slice(relIdx + 1).filter((a) => !a.startsWith('--')) : undefined;
  const rows = queryCycles(projectDir, rels ? { rels } : {});
  if (json) {
    process.stdout.write(JSON.stringify({ count: rows.length, cycles: rows }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`cycle members (${rows.length}):\n`);
  for (const r of rows) process.stdout.write(`  ${r.cycle_member}: ${r.cycle_path}\n`);
  return 0;
}

function runOwners(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const [id] = parsePositional(args, []);
  if (!id) {
    process.stderr.write('Usage: construct graph owners <node-id> [--json]\n');
    return 1;
  }
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const rows = queryOwners(projectDir, id);
  const ownerNodes = rows.map((r) => r.owner_node).filter(Boolean);
  const owningSubsystem = rows[0]?.owning_subsystem ?? null;
  if (json) {
    process.stdout.write(JSON.stringify({ id, owningSubsystem, ownerNodes }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`${id}\n  owning subsystem: ${owningSubsystem ?? '(none)'}\n  owner nodes (${ownerNodes.length}): ${ownerNodes.join(', ') || '(none)'}\n`);
  return 0;
}

function runRequirements(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const [id] = parsePositional(args, []);
  if (!id) {
    process.stderr.write('Usage: construct graph requirements <node-id> [--json]\n');
    return 1;
  }
  if (!loadGraph(projectDir).exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const rows = queryRequirements(projectDir, id);
  if (json) {
    process.stdout.write(JSON.stringify({ id, count: rows.length, requirements: rows }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`${id} requirements (${rows.length}):\n`);
  for (const r of rows) process.stdout.write(`  ${r.rel} -> ${r.requirement}${r.inferred ? ' (inferred)' : ''}\n`);
  return 0;
}

function runExport(args, { projectDir, json }) {
  const guard = requireRelational();
  if (guard) return guard;
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct graph build` first.\n');
    return 1;
  }
  const formatFlag = args.find((a) => a.startsWith('--format='));
  const formatIdx = args.indexOf('--format');
  const format = formatFlag ? formatFlag.slice('--format='.length) : (formatIdx !== -1 ? args[formatIdx + 1] : 'json');
  if (format === 'json' || json) {
    process.stdout.write(JSON.stringify(exportGraphJson(graph), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(exportGraphDiagram(graph, { format }));
  return 0;
}

function runValidate(args, { rootDir, projectDir }) {
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const allowPartial = args.includes('--allow-partial');
  const result = validateGraph(projectDir || rootDir, { strict, packageRoot: rootDir, allowPartial });

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

  // process.exit() can truncate a large piped stdout write before the OS
  // flushes it (observed: a --strict --json dump on this repo's own
  // multi-thousand-node graph truncated at exactly the 64KB pipe buffer
  // boundary during functional tests). Setting
  // exitCode and returning lets the event loop drain pending I/O before the
  // process actually exits, same as every other graph subcommand.
  process.exitCode = result.errors.length > 0 ? 1 : 0;
  return 0;
}

function parseChangedFilesArg(args) {
  const flag = args.find((a) => a.startsWith('--changed='));
  if (flag) return flag.slice('--changed='.length).split(',').map((f) => f.trim()).filter(Boolean);
  const idx = args.indexOf('--changed');
  if (idx === -1) return [];
  return args.slice(idx + 1).filter((a) => !a.startsWith('--'));
}

function parseIntentArg(args) {
  const flag = args.find((a) => a.startsWith('--intent='));
  if (flag) return flag.slice('--intent='.length);
  const idx = args.indexOf('--intent');
  if (idx === -1) return null;
  const value = args[idx + 1];
  return value && !value.startsWith('--') ? value : null;
}

function runVerify(args, { projectDir, packageRoot }) {
  const json = args.includes('--json');
  const changedFiles = parseChangedFilesArg(args);
  const intentId = parseIntentArg(args);
  const result = verifyGraph(projectDir, { changedFiles, intentId, packageRoot });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write('✓ graph verify passed\n');
  } else {
    for (const v of result.violations) process.stderr.write(`  ${v.message}\n`);
    process.stderr.write(`\n✖ graph verify failed: ${result.violations.length} violation(s)\n`);
  }

  process.exitCode = result.ok ? 0 : 1;
  return result.ok ? 0 : 1;
}

function parseMaxSnapshotsArg(args) {
  const flag = args.find((a) => a.startsWith('--max-snapshots='));
  if (!flag) return undefined;
  const value = Number.parseInt(flag.slice('--max-snapshots='.length), 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function runHistory(args, { projectDir, json }) {
  const sub = args[1];
  if (!sub || sub.startsWith('--')) {
    process.stderr.write('Usage: construct graph history <list|at|changed|replaced|release-removed|compact> ...\n');
    return 1;
  }

  if (sub === 'list') {
    const snaps = listSnapshots(projectDir);
    const payload = { ok: true, snapshots: snaps, earliest: earliestSnapshotDate(projectDir) };
    if (json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }
    if (!snaps.length) {
      process.stdout.write('No graph history snapshots recorded yet.\n');
      return 0;
    }
    process.stdout.write(`Graph history snapshots (${snaps.length}):\n`);
    for (const snap of snaps) process.stdout.write(`  ${snap.generatedAt}\n`);
    return 0;
  }

  if (sub === 'at') {
    const timestamp = args[2];
    if (!timestamp || timestamp.startsWith('--')) {
      process.stderr.write('Usage: construct graph history at <iso-timestamp> [--json]\n');
      return 1;
    }
    const result = graphAtTime(projectDir, timestamp);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      return 1;
    }
    process.stdout.write(`Graph at ${result.generatedAt}: ${result.nodes.length} nodes, ${result.edges.length} edges\n`);
    return 0;
  }

  if (sub === 'changed') {
    const t1 = args[2];
    const t2 = args[3];
    if (!t1 || !t2 || t1.startsWith('--') || t2.startsWith('--')) {
      process.stderr.write('Usage: construct graph history changed <t1> <t2> [--json]\n');
      return 1;
    }
    const result = whatChangedBetween(projectDir, t1, t2);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      return 1;
    }
    process.stdout.write(`Changes ${result.from} -> ${result.to}: ${result.changes.length} node change(s), ${result.edgeChanges.length} edge change(s)\n`);
    return 0;
  }

  if (sub === 'replaced') {
    const nodeIdArg = args[2];
    if (!nodeIdArg || nodeIdArg.startsWith('--')) {
      process.stderr.write('Usage: construct graph history replaced <node-id> [--json]\n');
      return 1;
    }
    const result = whatReplaced(projectDir, nodeIdArg);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (!result.replacedBy) {
      process.stdout.write(`No replacement recorded for ${nodeIdArg}\n`);
      return 0;
    }
    process.stdout.write(`${nodeIdArg} -> ${result.replacedBy} (${result.via})\n`);
    return 0;
  }

  if (sub === 'release-removed') {
    const nodeIdArg = args[2];
    if (!nodeIdArg || nodeIdArg.startsWith('--')) {
      process.stderr.write('Usage: construct graph history release-removed <node-id> [--json]\n');
      return 1;
    }
    const result = whichReleaseRemoved(projectDir, nodeIdArg);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (!result.release) {
      process.stdout.write(`No release evidence links ${nodeIdArg}\n`);
      return 0;
    }
    process.stdout.write(`${nodeIdArg} linked to release ${result.release}\n`);
    return 0;
  }

  if (sub === 'compact') {
    const maxSnapshots = parseMaxSnapshotsArg(args);
    const result = compactHistory(projectDir, maxSnapshots ? { maxSnapshots } : {});
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok && result.provenancePreserved ? 0 : 1;
    }
    process.stdout.write(`Compacted history: pruned ${result.pruned}, retained ${result.retained}, provenance preserved: ${result.provenancePreserved}\n`);
    return result.provenancePreserved ? 0 : 1;
  }

  process.stderr.write(`Unknown graph history subcommand: ${sub}\n`);
  return 1;
}

/**
 * @param {string[]} args
 * @param {{ rootDir: string, projectDir: string }} ctx
 * @returns {number} exit code
 */
export function runGraphCli(args, { rootDir, projectDir }) {
  const sub = args[0] || 'stat';
  const json = args.includes('--json');
  const projects = parseProjectsArg(args);
  if (sub === 'build') return runBuild({ rootDir, projectDir, json, coChange: !args.includes('--no-co-change'), allowPartial: args.includes('--allow-partial') });
  if (sub === 'build-targets') return runBuildTargets({ projectDir, json });
  if (sub === 'query') {
    if (args.includes('--missing-tests')) return runMissingTests({ projectDir, json });
    const typeIdx = args.indexOf('--type');
    if (typeIdx !== -1) {
      const type = args[typeIdx + 1];
      if (!type || type.startsWith('--')) {
        process.stderr.write('Usage: construct graph query --type <node-type> [--projects=<id,...>|all|self] [--json]\n');
        return 1;
      }
      return runQueryByType({ projectDir, type, json, projects });
    }
    const id = args.slice(1).find((a) => !a.startsWith('--'));
    if (!id) {
      process.stderr.write('Usage: construct graph query <node-id> | --type <node-type> [--projects=<id,...>|all|self] [--json]\n');
      return 1;
    }
    return runQuery({ projectDir, id, json, projects });
  }
  if (sub === 'validate') {
    return runValidate(args, { rootDir, projectDir });
  }
  if (sub === 'verify') return runVerify(args, { projectDir, packageRoot: rootDir });
  if (sub === 'impacted') return runImpacted(args, { projectDir, json });
  if (sub === 'intent') return runIntent(args.slice(1), { projectDir, json });
  if (sub === 'owasp') return runOwaspMatrix({ projectDir, json });
  if (sub === 'missing-tests') {
    if (args.includes('--security')) return runMissingSecurity({ projectDir, json });
    return runMissingTests({ projectDir, json });
  }
  if (sub === 'missing-docs') return runGapQuery(findMissingDocs, { projectDir, json });
  if (sub === 'stale') return runGapQuery(findStale, { projectDir, json });
  if (sub === 'dependencies') return runGapQuery(findDependencies, { projectDir, json });
  if (sub === 'providers') return runGapQuery(findProviders, { projectDir, json });
  if (sub === 'surfaces') return runGapQuery(findSurfaces, { projectDir, json });
  if (sub === 'explain') return runExplain(args, { projectDir, json });
  if (sub === 'update') return runUpdate({ rootDir, projectDir, json });
  if (sub === 'reconcile') return runReconcile({ rootDir, projectDir, json, coChange: !args.includes('--no-co-change') });
  if (sub === 'queryUp') return runQueryUp(args, { projectDir, json });
  if (sub === 'queryDown') return runQueryDown(args, { projectDir, json });
  if (sub === 'path') return runPath(args, { projectDir, json });
  if (sub === 'orphans') return runOrphans(args, { projectDir, json });
  if (sub === 'cycles') return runCycles(args, { projectDir, json });
  if (sub === 'owners') return runOwners(args, { projectDir, json });
  if (sub === 'requirements') return runRequirements(args, { projectDir, json });
  if (sub === 'export') return runExport(args, { projectDir, json });
  if (sub === 'history') return runHistory(args, { projectDir, json });
  process.stderr.write(`Unknown graph subcommand: ${sub}. Available: build, build-targets, stat, query, validate, verify, impacted, intent, missing-tests, missing-docs, stale, dependencies, providers, surfaces, explain, update, reconcile, queryUp, queryDown, path, orphans, cycles, owners, requirements, export, history\n`);
  return 1;
}
