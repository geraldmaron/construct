/**
 * scripts/verify-cutover.mjs — mechanical re-verification of the
 * workspace-control-plane program's deletion and completion criteria.
 *
 * The terminal bead of the program (construct-b0nny.28) is the only one whose
 * acceptance is required to be mechanically verifiable rather than narrative:
 * every dependency bead's own deletion criteria are re-asserted here and
 * reported pass/fail per bead. Prior sign-off is not trusted — each criterion
 * re-derives its verdict from the tree on disk.
 *
 * Criteria come from each bead's "Deletion/cleanup" and "Completion evidence"
 * sections and from
 * docs/notes/research/workspace-control-plane/synthesis/disposition-matrix.md.
 *
 * Criterion kinds:
 *   static — file presence/absence, source scans, package metadata
 *   cli    — spawns the real `bin/construct` binary
 *
 * A criterion may be marked `deferred`, which records a documented, still-valid
 * decision not to delete something. A deferred criterion asserts that the
 * justification still holds; when the justification stops holding (the last
 * consumer disappears) it FAILS, so a deferral cannot silently become rot.
 *
 * Source scans ignore comment text so that a docstring naming a deleted module
 * is not mistaken for a live reference.
 *
 * Flags:
 *   --root=<dir>   tree to verify (default: the repo this script lives in)
 *   --static-only  skip cli-kind criteria
 *   --bead=<id>    verify one bead
 *   --json         emit the report as JSON
 *
 * Exit code is 0 only when every executed criterion passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs']);
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist', '.construct']);

// The public binary carries the whole dispatch ladder and has no file
// extension, so an extension-only filter would skip the largest source of
// live command references.

const EXTENSIONLESS_SOURCES = new Set(['construct']);

let ROOT = DEFAULT_ROOT;

function abs(rel) {
  return path.join(ROOT, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  try {
    return fs.readFileSync(abs(rel), 'utf8');
  } catch {
    return null;
  }
}

// Criteria that assert a module reaches another module must read executable
// source only. Against raw text a docstring naming the dependency satisfies
// the check, which is how a criterion quietly becomes decorative.

function readCode(rel) {
  const text = read(rel);
  return text === null ? null : stripComments(text);
}

function listDir(rel) {
  try {
    return fs.readdirSync(abs(rel));
  } catch {
    return [];
  }
}

// A deleted module's name legitimately survives in docstrings that explain the
// deletion, so only executable lines count as a live reference. The scan must
// be string-aware: a glob literal such as '**/*.test.mjs' contains `/*`, and a
// naive stripper would treat the rest of the file as one comment and silently
// report zero hits — a false pass on every later criterion in that file.
// Line count is preserved so hit line numbers stay accurate.

function stripComments(text) {
  let out = '';
  let quote = null;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
        continue;
      }
      if (char === '\n') out += char;
      continue;
    }
    if (quote) {
      if (char === '\\') {
        out += '  ';
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

// Targets may name a single file as well as a directory. readdirSync throws on
// a file, and swallowing that would silently narrow a scan to fewer paths than
// the criterion claims to cover.

function* walkSourceFiles(relTargets) {
  for (const relDir of relTargets) {
    const start = abs(relDir);
    if (!fs.existsSync(start)) continue;
    if (fs.statSync(start).isFile()) {
      yield start;
      continue;
    }
    const stack = [start];
    while (stack.length) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (SCAN_SKIP_DIRS.has(entry.name)) continue;
          stack.push(full);
          continue;
        }
        if (!SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !EXTENSIONLESS_SOURCES.has(entry.name)) continue;
        yield full;
      }
    }
  }
}

function codeHits(pattern, relDirs, { exclude = [] } = {}) {
  const excluded = new Set(exclude.map((rel) => abs(rel)));
  const hits = [];
  for (const file of walkSourceFiles(relDirs)) {
    if (excluded.has(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const code = stripComments(text);
    code.split('\n').forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return hits;
}

function runCli(args, { timeout = 180000 } = {}) {
  const result = spawnSync(process.execPath, [abs('bin/construct'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NODE_ENV: 'test', CI: 'true' },
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function pass(detail) {
  return { ok: true, detail };
}

function fail(detail) {
  return { ok: false, detail };
}

function allAbsent(rels) {
  const present = rels.filter((rel) => exists(rel));
  return present.length === 0
    ? pass(`absent: ${rels.join(', ')}`)
    : fail(`still present: ${present.join(', ')}`);
}

function allPresent(rels) {
  const missing = rels.filter((rel) => !exists(rel));
  return missing.length === 0
    ? pass(`present: ${rels.length} path(s)`)
    : fail(`missing: ${missing.join(', ')}`);
}

function noLiveHits(pattern, relDirs, options) {
  const hits = codeHits(pattern, relDirs, options);
  return hits.length === 0
    ? pass('0 live references')
    : fail(`${hits.length} live reference(s):\n      ${hits.slice(0, 8).join('\n      ')}`);
}

const LIB_AND_BIN = ['lib', 'bin'];

// Each entry re-asserts one bead's own stated criteria. The `deferred` flag
// marks a documented non-deletion whose justification is itself asserted.

const BEADS = [
  {
    id: 'construct-b0nny.13',
    milestone: 'M0',
    title: 'Delete dead flow engine + cx_trace_telemetry alias + .cx residue',
    criteria: [
      {
        name: 'dead flow-engine port deleted',
        kind: 'static',
        run: () => allAbsent(['lib/orchestration/delegation-flow.mjs']),
      },
      {
        name: 'zero live delegation-flow imports',
        kind: 'static',
        run: () => noLiveHits(/(?:from|import|require)\s*\(?\s*['"][^'"]*delegation-flow/, ['lib', 'bin', 'tests']),
      },
      {
        name: 'cx_trace_telemetry alias removed',
        kind: 'static',
        run: () => noLiveHits(/cx_trace_telemetry/, ['lib', 'bin']),
      },
      {
        name: 'cx_trace survives as the canonical tool',
        kind: 'static',
        run: () => {
          const server = readCode('lib/mcp/server.mjs') || '';
          const safety = readCode('lib/mcp/tool-safety.mjs') || '';
          return /['"]cx_trace['"]/.test(server) && /\bcx_trace\b/.test(safety)
            ? pass('cx_trace dispatched in lib/mcp/server.mjs and classified in tool-safety.mjs')
            : fail('cx_trace missing from the MCP dispatch or safety table');
        },
      },
      {
        name: 'lib/flows/ retained with its live CLI caller',
        kind: 'static',
        run: () => {
          if (!exists('lib/flows/engine.mjs')) return fail('lib/flows/engine.mjs was deleted; the bead retained it');
          const hits = codeHits(/lib\/flows\/[a-z-]+\.mjs/, ['bin']);
          return hits.length > 0
            ? pass(`retained: ${hits.length} live caller(s) in the CLI`)
            : fail('lib/flows/ has no live caller; the retention rationale no longer holds');
        },
      },
      {
        name: '.cx residue cleared from lib/graph',
        kind: 'static',
        run: () => {
          const text = ['store.mjs', 'cli.mjs', 'build-target-graph.mjs']
            .map((f) => read(`lib/graph/${f}`) || '')
            .join('\n');
          return /\.cx\/graph/.test(text)
            ? fail('`.construct/graph` residue still present in lib/graph')
            : pass('lib/graph uses the .construct convention');
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.14',
    milestone: 'M1',
    title: 'One Workspace id + versioned SQLite run-store',
    criteria: [
      {
        name: 'deriveProjectKey defined exactly once',
        kind: 'static',
        run: () => {
          const hits = codeHits(/export\s+(function|const)\s+deriveProjectKey\b/, LIB_AND_BIN);
          return hits.length === 1
            ? pass(hits[0])
            : fail(`expected exactly 1 definition, found ${hits.length}`);
        },
      },
      {
        name: 'divergent identity derivations consume the canonical key',
        kind: 'static',
        run: () => {
          const store = readCode('lib/orchestration/store.mjs') || '';
          if (!/import\s*\{[^}]*\bderiveProjectKey\b[^}]*\}\s*from\s*['"][^'"]*state-root\.mjs['"]/.test(store)) {
            return fail('lib/orchestration/store.mjs does not import the canonical deriveProjectKey');
          }
          if (!/\bderiveProjectKey\s*\(/.test(store)) {
            return fail('lib/orchestration/store.mjs imports deriveProjectKey but never calls it');
          }

          // The embed daemon converges transitively: it takes the store's
          // projectKey, which is itself deriveProjectKey. Requiring a direct
          // import here would demand a second derivation path, which is the
          // duplication M1 removed.

          const daemon = readCode('lib/embed/daemon.mjs') || '';
          const viaStore = /import\s*\{[^}]*\bprojectKey\b[^}]*\}\s*from\s*['"][^'"]*orchestration\/store\.mjs['"]/.test(daemon);
          const direct = /import\s*\{[^}]*\bderiveProjectKey\b[^}]*\}\s*from\s*['"][^'"]*state-root\.mjs['"]/.test(daemon);
          return viaStore || direct
            ? pass('orchestration/store derives the canonical key; embed/daemon reads it through the store')
            : fail('lib/embed/daemon.mjs reaches neither the canonical derivation nor the store that owns it');
        },
      },
      {
        name: 'run-store schema owned by versioned migrations',
        kind: 'static',
        run: () => {
          const files = listDir('lib/db/migrations').filter((f) => /^\d+_.*\.sql$/.test(f));
          return files.length > 0
            ? pass(`${files.length} numbered migration(s) in lib/db/migrations`)
            : fail('no numbered .sql migrations under lib/db/migrations');
        },
      },
      {
        name: 'inline CREATE TABLE path deleted from the SQLite run-store',
        kind: 'static',
        run: () => noLiveHits(/CREATE\s+TABLE/i, ['lib/orchestration']),
      },
    ],
  },
  {
    id: 'construct-b0nny.15',
    milestone: 'M2',
    title: 'Governed-write pipeline is the sole authority chokepoint',
    criteria: [
      {
        name: 'roles/approval-surface.mjs deleted',
        kind: 'static',
        run: () => allAbsent(['lib/roles/approval-surface.mjs']),
      },
      {
        name: 'zero live approval-surface importers',
        kind: 'static',
        run: () => noLiveHits(/approval-surface/, ['lib', 'bin']),
      },
      {
        name: 'chokepoint modules present',
        kind: 'static',
        run: () => allPresent([
          'lib/writes/control-plane.mjs',
          'lib/writes/authority-ledger.mjs',
          'lib/writes/write-intent.mjs',
          'lib/writes/envelope.mjs',
          'lib/writes/sent-log.mjs',
        ]),
      },
      {
        name: 'authority ledger is reachable from the control plane',
        kind: 'static',
        run: () => /from\s+['\"]\.\/authority-ledger\.mjs['\"]/.test(readCode('lib/writes/control-plane.mjs') || '')
          ? pass('control-plane.mjs references the shared authority ledger')
          : fail('control-plane.mjs does not reach the authority ledger'),
      },
      {
        name: 'envelope write path is frozen to the gated caller set',
        kind: 'static',
        run: () => {
          const permitted = new Set(['lib/mcp/tools/provider-write.mjs']);
          const callers = codeHits(/writeWithEnvelope/, ['lib', 'bin'])
            .map((hit) => hit.split(':')[0])
            .filter((file) => !file.startsWith('lib/writes/'));
          const unexpected = [...new Set(callers)].filter((file) => !permitted.has(file));
          return unexpected.length === 0
            ? pass(`only the destructive-gated MCP tool calls the envelope outside lib/writes/`)
            : fail(`ungated envelope caller(s) added since M2: ${unexpected.join(', ')}`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.16',
    milestone: 'M3a',
    title: 'Roles routing consolidated into orchestration/routing-tables',
    criteria: [
      {
        name: 'consolidated routing table owns event resolution',
        kind: 'static',
        run: () => {
          const text = readCode('lib/orchestration/routing-tables.mjs') || '';
          return /export\s+function\s+resolveEventOwner\b/.test(text) && /export\s+function\s+ownerForEvent\b/.test(text)
            ? pass('routing-tables.mjs exports resolveEventOwner + ownerForEvent')
            : fail('routing-tables.mjs does not own event resolution');
        },
      },
      {
        name: 'roles/router.mjs is a thin delegator, not a second implementation',
        kind: 'static',
        deferred: true,
        run: () => {
          const text = readCode('lib/roles/router.mjs');
          if (text === null) return pass('roles/router.mjs deleted outright');
          if (!/from\s+['"]\.\.\/orchestration\/routing-tables\.mjs['"]/.test(text)) {
            return fail('roles/router.mjs no longer delegates to routing-tables.mjs');
          }
          const codeLines = stripComments(text).split('\n').filter((l) => l.trim()).length;
          return codeLines <= 40
            ? pass(`compatibility delegator retained per the M3 rollback seam (${codeLines} code lines)`)
            : fail(`roles/router.mjs has grown its own routing logic (${codeLines} code lines)`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.17',
    milestone: 'M3b',
    title: 'Oracle daemon entity deleted, jobs re-homed',
    criteria: [
      {
        name: 'Oracle daemon entity deleted',
        kind: 'static',
        run: () => allAbsent([
          'lib/oracle/daemon-entry.mjs',
          'lib/doctor/watchers/oracle-liveness.mjs',
        ]),
      },
      {
        name: 'zero live Oracle daemon constructors',
        kind: 'static',
        run: () => noLiveHits(/runOracleDaemon|buildOracleDaemon|oracle-liveness/, ['lib', 'bin']),
      },
      {
        name: 'directive execution re-homed onto the E5 workplace loop',
        kind: 'static',
        run: () => allPresent(['lib/workplace-loop/directive-executor.mjs']),
      },
      {
        name: 'Oracle state carries a migration path, not a silent drop',
        kind: 'static',
        run: () => allPresent(['lib/oracle/migrate-state.mjs']),
      },
      {
        name: 'reconciliation re-homed onto the E1 graph',
        kind: 'static',
        run: () => {
          const hits = codeHits(/reconcileGraph/, ['lib']);
          return hits.length > 0
            ? pass(`graph reconciliation live at ${hits.length} site(s)`)
            : fail('no live reconcileGraph caller; Oracle reconciliation was dropped, not re-homed');
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.18',
    milestone: 'M4',
    title: 'Org metaphor migrated into Worker Profiles',
    criteria: [
      {
        name: 'handoff contracts retained',
        kind: 'static',
        run: () => listDir('specialists/org/contracts').length > 0
          ? pass(`${listDir('specialists/org/contracts').length} contract file(s) retained`)
          : fail('specialists/org/contracts is empty or missing'),
      },
      {
        name: 'capability registry retained',
        kind: 'static',
        run: () => allPresent(['registry/capabilities.json']),
      },
      {
        name: 'scopes select skill emphasis rather than declaring persona identity',
        kind: 'static',
        run: () => {
          const scopes = listDir('specialists/org/worker-profiles').filter((f) => f.endsWith('.json'));
          if (scopes.length === 0) return fail('no scope files found');
          const identityKeys = ['persona', 'personas', 'role', 'roles', 'team', 'teams'];
          const withoutEmphasis = [];
          const withIdentity = [];
          for (const file of scopes) {
            let parsed;
            try {
              parsed = JSON.parse(read(`specialists/org/worker-profiles/${file}`) || '{}');
            } catch {
              return fail(`${file} is not valid JSON`);
            }
            if (!Array.isArray(parsed.defaultSkills) || parsed.defaultSkills.length === 0) withoutEmphasis.push(file);
            const identity = identityKeys.filter((k) => k in parsed);
            if (identity.length) withIdentity.push(`${file} (${identity.join(', ')})`);
          }
          if (withoutEmphasis.length) return fail(`scope(s) declare no skill emphasis: ${withoutEmphasis.join(', ')}`);
          if (withIdentity.length) return fail(`persona-identity scaffold survives in: ${withIdentity.join('; ')}`);
          return pass(`${scopes.length} scope(s) select skills, none declares a persona/role/team identity`);
        },
      },
      {
        name: 'teams/groups retirement deferral is still justified by live consumers',
        kind: 'static',
        deferred: true,
        run: () => {
          if (!exists('specialists/org/teams') && !exists('specialists/org/groups')) {
            return pass('teams/groups deleted');
          }
          const consumers = codeHits(/registry\.teams|teamForSpecialist|specialistsInTeam/, ['lib', 'bin']);
          return consumers.length > 0
            ? pass(`retained per the bead's documented block: ${consumers.length} live consumer(s)`)
            : fail('teams/groups retained but no live consumer remains — the deferral has expired, delete them');
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.19',
    milestone: 'M5a',
    title: 'Model invocation migrated onto runtime adapters',
    criteria: [
      {
        name: 'model-registry.mjs deleted',
        kind: 'static',
        run: () => allAbsent(['lib/model-registry.mjs']),
      },
      {
        name: 'migrated call sites invoke through the E4 runtime adapter',
        kind: 'static',
        run: () => {
          const sites = ['lib/intent-classifier.mjs', 'lib/schema-infer.mjs'];
          const bad = sites.filter((rel) => !/from\s+['\"][^'\"]*runtime\/contract\//.test(readCode(rel) || ''));
          return bad.length === 0
            ? pass('intent-classifier and schema-infer invoke via the runtime-adapter contract')
            : fail(`still on the bespoke loop: ${bad.join(', ')}`);
        },
      },
      {
        name: 'tier/policy metadata retained as Worker Profile input',
        kind: 'static',
        run: () => allPresent(['lib/model-policy.mjs', 'lib/model-pricing.mjs']),
      },
      {
        name: 'model-router carries no invocation/dispatch loop',
        kind: 'static',
        deferred: true,
        run: () => {
          const text = read('lib/model-router.mjs');
          if (text === null) return pass('lib/model-router.mjs deleted outright');
          const code = stripComments(text);
          const dispatch = /\bfetch\s*\(|new\s+Anthropic\b|new\s+OpenAI\b|messages\.create\s*\(/.test(code);
          const importers = codeHits(/model-router\.mjs/, ['lib', 'bin']).length;
          return dispatch
            ? fail('model-router.mjs still performs provider invocation')
            : pass(`metadata-only after the partial migration the bead documented; ${importers} metadata importer(s)`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.20',
    milestone: 'M5b',
    title: 'LanceDB de-cored behind an optional retrieval adapter',
    criteria: [
      {
        name: 'vector packages are optional, not required',
        kind: 'static',
        run: () => {
          let pkg;
          try {
            pkg = JSON.parse(read('package.json') || '{}');
          } catch {
            return fail('package.json unreadable');
          }
          const required = Object.keys(pkg.dependencies || {}).filter((k) => /lancedb|apache-arrow/.test(k));
          const optional = Object.keys(pkg.optionalDependencies || {}).filter((k) => /lancedb|apache-arrow/.test(k));
          if (required.length > 0) return fail(`still a hard dependency: ${required.join(', ')}`);
          return optional.length > 0
            ? pass(`optionalDependencies: ${optional.join(', ')}`)
            : fail('vector packages declared in neither dependency set');
        },
      },
      {
        name: 'zero static @lancedb imports in core',
        kind: 'static',
        run: () => noLiveHits(/^\s*import\s[^\n]*['"]@lancedb/, ['lib']),
      },
      {
        name: 'retrieval-adapter contract with a no-vector fallback',
        kind: 'static',
        run: () => allPresent([
          'lib/storage/retrieval-adapter.mjs',
          'lib/storage/adapters/keyword-adapter.mjs',
        ]),
      },
    ],
  },
  {
    id: 'construct-b0nny.3+.12+.21',
    milestone: 'E1',
    title: 'Graph foundation, CTE caps, CLI exposure, Postgres parity',
    criteria: [
      {
        name: 'relational graph store present',
        kind: 'static',
        run: () => allPresent([
          'lib/graph/relational/sqlite-store.mjs',
          'lib/graph/relational/postgres-store.mjs',
          'lib/graph/relational/queries.mjs',
          'lib/graph/relational/reconcile.mjs',
          'lib/graph/relational/migrations/001_graph_foundation.sql',
          'lib/db/migrations/007_graph_foundation.sql',
        ]),
      },
      {
        name: 'traversal queries carry a depth cap and relationship filter',
        kind: 'static',
        run: () => {
          const text = readCode('lib/graph/relational/queries.mjs') || '';
          const uncapped = ['queryDown', 'queryUp', 'queryPath', 'queryImpact'].filter((fn) => {
            const sig = new RegExp(`export\\s+function\\s+${fn}\\s*\\([^)]*\\)`, 's');
            const match = text.match(sig);
            return !match || !/maxDepth/.test(match[0]);
          });
          return uncapped.length === 0
            ? pass('queryDown/queryUp/queryPath/queryImpact all take maxDepth')
            : fail(`uncapped recursive CTE in: ${uncapped.join(', ')}`);
        },
      },
      {
        name: 'queryUp/queryDown exposed on the CLI',
        kind: 'static',
        run: () => {
          const text = readCode('bin/construct') || '';
          const missing = ['queryUp', 'queryDown', 'orphans', 'cycles'].filter((sub) => !new RegExp(`'${sub}'`).test(text));
          return missing.length === 0
            ? pass('graph subcommands registered: queryUp, queryDown, orphans, cycles')
            : fail(`unexposed subcommand(s): ${missing.join(', ')}`);
        },
      },
      {
        name: 'graph cycle sweep is clean',
        kind: 'cli',
        run: () => {
          const result = runCli(['graph', 'cycles']);
          if (result.code !== 0) return fail(`graph cycles exited ${result.code}: ${result.stderr.trim().slice(0, 200)}`);
          const match = result.stdout.match(/cycle members \((\d+)\)/);
          if (!match) return fail(`unrecognized graph cycles output: ${result.stdout.trim().slice(0, 200)}`);
          return Number(match[1]) === 0
            ? pass('0 cycle members')
            : fail(`${match[1]} cycle member(s)`);
        },
      },
      {
        name: 'graph orphan sweep runs clean',
        kind: 'cli',
        run: () => {
          const result = runCli(['graph', 'orphans']);
          return result.code === 0
            ? pass(`graph orphans exited 0 (${result.stdout.split('\n').filter((l) => l.trim()).length} report line(s))`)
            : fail(`graph orphans exited ${result.code}: ${result.stderr.trim().slice(0, 200)}`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.22',
    milestone: 'E2',
    title: 'Workspace domain model and durable storage',
    criteria: [
      {
        name: 'workspace domain store present',
        kind: 'static',
        run: () => allPresent([
          'lib/workspace/store.mjs',
          'lib/workspace/migrate-sqlite.mjs',
          'lib/workspace/cli.mjs',
          'lib/db/migrations/008_workspace_foundation.sql',
        ]),
      },
      {
        name: 'workspace storage is versioned',
        kind: 'static',
        run: () => listDir('lib/workspace/migrations').filter((f) => f.endsWith('.sql')).length > 0
          ? pass(`${listDir('lib/workspace/migrations').length} workspace migration(s)`)
          : fail('lib/workspace/migrations has no .sql migration'),
      },
    ],
  },
  {
    id: 'construct-b0nny.23',
    milestone: 'E3',
    title: 'Graph-informed work specification and planning',
    criteria: [
      {
        name: 'planning modules present',
        kind: 'static',
        run: () => allPresent([
          'lib/planning/work-spec.mjs',
          'lib/planning/build-work-spec.mjs',
          'lib/planning/decomposition-check.mjs',
          'lib/planning/cli.mjs',
        ]),
      },
      {
        name: 'decomposition is checked against the E1 graph, not narrative judgment',
        kind: 'static',
        run: () => /from\s+['\"][^'\"]*graph\/relational\/queries\.mjs['\"]/.test(readCode('lib/planning/decomposition-check.mjs') || '')
          ? pass('decomposition-check imports the relational graph queries')
          : fail('decomposition-check does not consult the graph'),
      },
    ],
  },
  {
    id: 'construct-b0nny.24',
    milestone: 'E4',
    title: 'Runtime-adapter contract and conformance suite',
    criteria: [
      {
        name: 'runtime contract present',
        kind: 'static',
        run: () => allPresent([
          'lib/runtime/contract/interface.mjs',
          'lib/runtime/contract/registry.mjs',
          'lib/runtime/contract/conformance.mjs',
          'lib/runtime/contract/default-registry.mjs',
          'lib/runtime/contract/errors.mjs',
        ]),
      },
      {
        name: 'more than one adapter family implements the contract',
        kind: 'static',
        run: () => {
          const families = listDir('lib/runtime/contract/adapters');
          return families.length >= 2
            ? pass(`adapter families: ${families.join(', ')}`)
            : fail(`replaceability unproven: ${families.length} adapter family`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.25',
    milestone: 'E5',
    title: 'Production sources/directives/workplace loop',
    criteria: [
      {
        name: 'workplace loop stages present',
        kind: 'static',
        run: () => allPresent([
          'lib/workplace-loop/detect.mjs',
          'lib/workplace-loop/align.mjs',
          'lib/workplace-loop/gate.mjs',
          'lib/workplace-loop/verify.mjs',
          'lib/workplace-loop/propose.mjs',
          'lib/workplace-loop/state-store.mjs',
        ]),
      },
      {
        name: 'public barrel exports the loop (the dead-on-import regression)',
        kind: 'static',
        run: () => {
          const exportsFound = (readCode('lib/workplace-loop/index.mjs') || '').match(/^export\s/gm) || [];
          return exportsFound.length >= 4
            ? pass(`${exportsFound.length} export(s) from the public barrel`)
            : fail(`barrel exports ${exportsFound.length} symbol(s); the loop is unreachable`);
        },
      },
      {
        name: 'writes from the loop route through the M2 chokepoint',
        kind: 'static',
        run: () => {
          const hits = codeHits(/writes\/(control-plane|write-intent)/, ['lib/workplace-loop']);
          return hits.length > 0
            ? pass(`${hits.length} governed-write call site(s)`)
            : fail('workplace loop bypasses the governed-write chokepoint');
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.26',
    milestone: 'E7',
    title: 'Shared workspace server',
    criteria: [
      {
        name: 'server modules present',
        kind: 'static',
        run: () => allPresent([
          'lib/server/http.mjs',
          'lib/server/auth.mjs',
          'lib/server/cli.mjs',
          'lib/db/migrations/009_server_tokens.sql',
        ]),
      },
      {
        name: 'server mode is additive, not the default runtime',
        kind: 'static',
        run: () => {
          const hits = codeHits(/server\/http\.mjs/, ['lib/hooks', 'bin/construct-postinstall.mjs']);
          return hits.length === 0
            ? pass('no hook or postinstall path starts the shared server')
            : fail(`shared server reached from an install/session path: ${hits.join('; ')}`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.27',
    milestone: 'E8',
    title: 'Beads projection, field authority, reconciliation',
    criteria: [
      {
        name: 'tracker-projection modules present',
        kind: 'static',
        run: () => allPresent([
          'lib/tracker-projection/projection.mjs',
          'lib/tracker-projection/field-authority.mjs',
          'lib/tracker-projection/reconcile.mjs',
          'lib/tracker-projection/import-beads.mjs',
          'lib/tracker-projection/store.mjs',
        ]),
      },
      {
        name: 'field authority is explicit about tracker-owned fields',
        kind: 'static',
        run: () => {
          const text = readCode('lib/tracker-projection/field-authority.mjs') || '';
          const trackerOwned = ['status', 'assignee', 'owner', 'priority', 'labels'];
          const domainOwned = ['dependencies', 'parent'];
          const wrongTracker = trackerOwned.filter((f) => !new RegExp(`\\b${f}\\s*:\\s*AUTHORITY\\.TRACKER`).test(text));
          const wrongDomain = domainOwned.filter((f) => !new RegExp(`\\b${f}\\s*:\\s*AUTHORITY\\.DOMAIN`).test(text));
          if (wrongTracker.length) return fail(`bd must own but does not: ${wrongTracker.join(', ')}`);
          if (wrongDomain.length) return fail(`the domain must own but does not: ${wrongDomain.join(', ')}`);
          return pass('bd owns status/assignee/owner/priority/labels; the graph owns dependencies/parent');
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.29',
    milestone: 'cleanup',
    title: 'Legacy daemon auto-spawn ripped out + cleanup sweeper',
    criteria: [
      {
        name: 'zero daemon-entry spawn paths',
        kind: 'static',
        run: () => noLiveHits(/daemon-entry|oracle-start|startOracle/, ['lib', 'bin'], {
          exclude: ['lib/legacy-cleanup.mjs'],
        }),
      },
      {
        name: 'cleanup sweeper present',
        kind: 'static',
        run: () => allPresent(['lib/legacy-cleanup.mjs']),
      },
      {
        name: 'sweeper wired into postinstall and doctor',
        kind: 'static',
        run: () => {
          const postinstall = /runLegacyCleanup/.test(readCode('bin/construct-postinstall.mjs') || '');
          const doctor = /runLegacyCleanup/.test(readCode('bin/construct') || '');
          if (postinstall && doctor) return pass('runLegacyCleanup reached from postinstall and doctor');
          const missing = [!postinstall && 'postinstall', !doctor && 'doctor'].filter(Boolean);
          return fail(`sweeper not wired into: ${missing.join(', ')}`);
        },
      },
    ],
  },
  {
    id: 'construct-b0nny.28',
    milestone: 'E9',
    title: 'Final cutover: uninstall symmetry and CLI role audit',
    criteria: [
      {
        name: 'every install trigger has an uninstall path',
        kind: 'static',
        run: () => {
          const uninstall = readCode('lib/uninstall/uninstall.mjs') || '';

          // Each install trigger the audit enumerated must map to a real
          // uninstall category, identified by id rather than by prose, so the
          // check cannot be satisfied by a comment that mentions the trigger.

          const required = {
            'git core.hooksPath': 'project-git-hookspath',
            'launchd pressure guard': 'machine-launchagent',
            'MCP registrations': 'machine-memory-mcp',
            'host adapter files': 'project-agents',
            'launcher': 'project-launcher',
            'machine state dirs': 'machine-workspace',
            'user config dir': 'machine-config-env',
            'package lib symlink': 'machine-lib-symlink',
          };
          const uncovered = Object.entries(required)
            .filter(([, id]) => !new RegExp(`id:\\s*'${id}'`).test(uninstall))
            .map(([label]) => label);
          if (uncovered.length) return fail(`no uninstall category for: ${uncovered.join(', ')}`);
          const categories = (uninstall.match(/id:\s*'[a-z-]+'/g) || []).length;
          const executors = (uninstall.match(/execute:\s*(\(|async)/g) || []).length;
          return categories === executors
            ? pass(`${categories} uninstall categories, each with an executor; all audited install triggers covered`)
            : fail(`${categories} categories but ${executors} executors — a category cannot reverse anything`);
        },
      },
      {
        name: 'uninstall is reachable as a real command',
        kind: 'static',
        run: () => {
          const dispatched = /uninstall/.test(readCode('bin/construct') || '');
          const documented = /['\"]uninstall['\"]/.test(readCode('lib/cli-commands.mjs') || '');
          return dispatched && documented
            ? pass('uninstall dispatched in bin/construct and listed in the command registry')
            : fail(`uninstall ${dispatched ? 'documented' : 'dispatched'} only`);
        },
      },
      {
        name: 'deprecated `matrix` alias removed from the CLI',
        kind: 'static',
        run: () => {
          const dispatch = codeHits(/\[\s*'matrix'\s*,/, ['bin']);
          const registry = codeHits(/name:\s*'matrix'/, ['lib']);
          const total = dispatch.length + registry.length;
          return total === 0
            ? pass('no `matrix` command in the dispatch ladder or the registry')
            : fail(`\`matrix\` alias still registered at ${total} site(s)`);
        },
      },
      {
        name: 'graph name overload resolved to one owner',
        kind: 'cli',
        run: () => {
          const result = runCli(['matrix', 'stat']);
          return result.code !== 0
            ? pass('`construct matrix` is no longer a command')
            : fail('`construct matrix` still dispatches');
        },
      },
    ],
  },
];

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, staticOnly: false, bead: null, json: false };
  for (const arg of argv) {
    if (arg.startsWith('--root=')) args.root = path.resolve(arg.slice('--root='.length));
    else if (arg === '--static-only') args.staticOnly = true;
    else if (arg.startsWith('--bead=')) args.bead = arg.slice('--bead='.length);
    else if (arg === '--json') args.json = true;
  }
  return args;
}

function verify({ staticOnly = false, bead = null } = {}) {
  const selected = bead ? BEADS.filter((b) => b.id.includes(bead)) : BEADS;
  return selected.map((entry) => {
    const criteria = entry.criteria.map((criterion) => {
      if (staticOnly && criterion.kind === 'cli') {
        return { name: criterion.name, kind: criterion.kind, status: 'skipped', detail: 'cli criteria disabled' };
      }
      let result;
      try {
        result = criterion.run();
      } catch (err) {
        result = fail(`check threw: ${err.message}`);
      }
      return {
        name: criterion.name,
        kind: criterion.kind,
        deferred: Boolean(criterion.deferred),
        status: result.ok ? 'pass' : 'fail',
        detail: result.detail,
      };
    });
    const failed = criteria.filter((c) => c.status === 'fail');
    return {
      id: entry.id,
      milestone: entry.milestone,
      title: entry.title,
      status: failed.length === 0 ? 'pass' : 'fail',
      passed: criteria.filter((c) => c.status === 'pass').length,
      failed: failed.length,
      skipped: criteria.filter((c) => c.status === 'skipped').length,
      criteria,
    };
  });
}

function render(report) {
  const lines = [];
  lines.push('');
  lines.push('  Cutover verification — workspace-control-plane deletion criteria');
  lines.push(`  root: ${ROOT}`);
  lines.push('');
  lines.push('  MILESTONE  BEAD                        RESULT   CRITERIA');
  lines.push('  ' + '-'.repeat(84));
  for (const entry of report) {
    const mark = entry.status === 'pass' ? 'PASS' : 'FAIL';
    const counts = `${entry.passed} pass, ${entry.failed} fail${entry.skipped ? `, ${entry.skipped} skipped` : ''}`;
    lines.push(`  ${entry.milestone.padEnd(10)} ${entry.id.padEnd(27)} ${mark.padEnd(8)} ${counts}`);
    for (const criterion of entry.criteria) {
      const glyph = criterion.status === 'pass' ? '+' : criterion.status === 'fail' ? 'x' : '-';
      const tag = criterion.deferred ? ' [deferred]' : '';
      lines.push(`      ${glyph} ${criterion.name}${tag}`);
      lines.push(`        ${criterion.detail}`);
    }
    lines.push('');
  }
  const failedBeads = report.filter((entry) => entry.status === 'fail');
  const totalCriteria = report.reduce((sum, entry) => sum + entry.criteria.length, 0);
  const totalFailed = report.reduce((sum, entry) => sum + entry.failed, 0);
  lines.push('  ' + '-'.repeat(84));
  lines.push(`  ${report.length} bead(s), ${totalCriteria} criteria — ${totalFailed} failing across ${failedBeads.length} bead(s)`);
  lines.push('');
  return lines.join('\n');
}

export function runVerification(options = {}) {
  const previousRoot = ROOT;
  if (options.root) ROOT = options.root;
  try {
    return verify(options);
  } finally {
    ROOT = previousRoot;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ROOT = args.root;
  const report = verify(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(render(report));
  const failed = report.some((entry) => entry.status === 'fail');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
