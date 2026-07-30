/**
 * lib/oracle/semantic-review.mjs — Layer 3 bounded semantic review.
 *
 * Runs a fixed, versioned set of judgment-call probes the deterministic Layer 1
 * and change-aware Layer 2 checks cannot make: duplicated product concepts,
 * cross-subsystem ordering contracts gated by Layer 2 couplings, and latent
 * catch-block swallow patterns. Seed corpus traces to the oracle miss audit defect list (oracle-miss-report rows 8, 17, 18 and scoped rows 5–11, 36–39).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { splitIntoJobBlocks } from './invariants/analysis-success-requires-execution-evidence.mjs';
import { analyzeDirectiveRunnerBlock } from './invariants/due-detection-does-not-equal-completion.mjs';

export const SEMANTIC_REVIEW_SEED_CORPUS = Object.freeze([
  {
    id: 'duplicated-product-concept-monitor-vs-source-watch',
    truthMatrixRow: 17,
    prScope: ['408', '409', '410'],
    category: 'duplicated-product-concept',
    summary:
      'Two independently authored subsystems may solve the same monitoring/watch problem (construct monitor vs embed source watching).',
    citation: 'oracle-miss-report.md row 17 — Layer 3 bounded semantic review',
  },
  {
    id: 'state-writer-reader-ordering-contract',
    truthMatrixRow: 8,
    prScope: ['408'],
    category: 'cross-subsystem-ordering',
    layer2Gate: 'couples_state',
    summary:
      'A state writer and its coupled reader must agree on ordering: due-detection must not stamp completion before execution.',
    citation: 'oracle-miss-report.md row 8 — Semantic (Layer 3), gated by couples_state',
  },
  {
    id: 'latent-catch-swallows-non-primary-error',
    truthMatrixRow: 18,
    prScope: ['409', '410'],
    category: 'latent-unreached-code',
    summary:
      'A catch block that handles only one documented error type silently absorbs other thrown errors on an unreached path.',
    citation: 'oracle-miss-report.md row 18 — Layer 3 semantic or targeted static lint',
  },
  {
    id: 'combined-pr-incoherent-architecture',
    truthMatrixRow: 40,
    prScope: ['408', '409', '410'],
    category: 'combined-pr-architecture',
    summary:
      'A combined PR touching multiple subsystems without shared contract or Layer 2 coupling edges may hide cross-cutting semantic defects.',
    citation: 'oracle-miss-report.md row 40 — absent PR-time semantic gate',
  },
]);

function fileExists(rootDir, rel) {
  return existsSync(path.join(rootDir, rel));
}

function readText(rootDir, rel) {
  const abs = path.join(rootDir, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

function checkDuplicatedMonitorConcept(rootDir) {
  const monitorPath = 'lib/monitor-cli.mjs';
  const embedDaemonPath = 'lib/embed/daemon.mjs';
  const embedConfigPath = 'lib/embed/config.mjs';
  if (!fileExists(rootDir, monitorPath)) {
    return { status: 'not-applicable', detail: 'monitor CLI module absent' };
  }
  const daemonText = readText(rootDir, embedDaemonPath);
  const configText = readText(rootDir, embedConfigPath);
  if (!daemonText || !configText) {
    return { status: 'unknown', detail: 'embed watch modules missing; cannot compare product surfaces' };
  }
  const embedWatchesSources =
    (/\bsources\s*:/.test(configText) && /\btargets\s*:/.test(configText)) ||
    fileExists(rootDir, 'lib/embed/auto-sources.mjs') ||
    fileExists(rootDir, 'lib/config/source-targets.mjs');
  const monitorUsesSourceTargets =
    /\btargetsToEmbedSources\b/.test(readText(rootDir, monitorPath) || '');
  const embedPollsInbox =
    /\binbox-watcher\b/.test(daemonText) ||
    /\bInboxWatcher\b/.test(daemonText) ||
    /\bsource.watch\b|\bsourceWatch\b/i.test(daemonText);
  if (embedWatchesSources && (embedPollsInbox || monitorUsesSourceTargets)) {
    return {
      status: 'failed',
      detail:
        'construct monitor (lib/monitor-cli.mjs) and embed source/inbox watching both exist — review for duplicated product concept overlap (row 17)',
      evidence: [monitorPath, embedDaemonPath, embedConfigPath],
    };
  }
  return { status: 'passed', detail: 'no overlapping monitor vs embed watch surfaces detected' };
}

function checkStateWriterReaderOrdering(rootDir, layer2Couplings = []) {
  const gated = layer2Couplings.some((c) => c.rel === 'couples_state');
  const daemonPath = 'lib/embed/daemon.mjs';
  const daemonText = readText(rootDir, daemonPath);
  if (!daemonText) {
    return { status: 'not-applicable', detail: 'embed daemon absent' };
  }
  const blocks = splitIntoJobBlocks(daemonText);
  const directiveEntry = blocks.find(
    (b) => b.jobId === 'directive-runner' || /\bwriteDirectiveState\b/.test(b.block),
  );
  if (!directiveEntry) {
    return { status: 'not-applicable', detail: 'no directive-runner job block found' };
  }
  const analysis = analyzeDirectiveRunnerBlock(directiveEntry.block);
  if (analysis.stampsLastRunAt && !analysis.hasExecutionHandoff) {
    return {
      status: 'failed',
      detail: analysis.detail,
      evidence: [daemonPath],
      layer2Gated: gated,
    };
  }
  if (gated && analysis.stampsLastRunAt && analysis.hasExecutionHandoff) {
    return {
      status: 'passed',
      detail: 'Layer 2 couples_state edge present; directive-runner block shows execution handoff alongside lastRunAt stamp',
      layer2Gated: true,
    };
  }
  return {
    status: 'passed',
    detail: analysis.detail,
    layer2Gated: gated,
  };
}

function checkLatentCatchSwallow(rootDir) {
  const envelopePath = 'lib/writes/envelope.mjs';
  const text = readText(rootDir, envelopePath);
  if (!text) {
    return { status: 'not-applicable', detail: 'writes envelope module absent' };
  }
  const policyCatch = text.match(/catch\s*\(\s*err\s*\)\s*\{[^}]*PolicyDenied[^}]*\}/s);
  if (!policyCatch) {
    return { status: 'passed', detail: 'no PolicyDenied-only catch pattern in envelope' };
  }
  const block = policyCatch[0];
  const handlesOnlyPolicyDenied =
    /err\.name\s*===\s*['"]PolicyDenied['"]/.test(block) && !/\bthrow\b/.test(block);
  if (handlesOnlyPolicyDenied) {
    return {
      status: 'failed',
      detail:
        'lib/writes/envelope.mjs catch handles PolicyDenied only and silently absorbs other errors on the policy path (row 18)',
      evidence: [envelopePath],
    };
  }
  return { status: 'passed', detail: 'policy catch block rethrows or handles multiple error types' };
}

function checkCombinedPrIncoherence(changedFiles = [], layer2Couplings = []) {
  if (!changedFiles.length) {
    return { status: 'not-applicable', detail: 'no changed files supplied' };
  }
  const areas = new Set(
    changedFiles.map((f) => {
      const parts = String(f).split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    }).filter(Boolean),
  );
  if (areas.size < 2) {
    return { status: 'not-applicable', detail: 'change set spans a single subsystem area' };
  }
  const hasLayer2Coupling = layer2Couplings.length > 0;
  if (!hasLayer2Coupling && areas.size >= 2) {
    return {
      status: 'failed',
      detail: `change spans ${areas.size} subsystem areas (${[...areas].join(', ')}) with no Layer 2 coupling edges — review combined-PR architecture coherence`,
      evidence: changedFiles.slice(0, 8),
    };
  }
  return {
    status: 'passed',
    detail: hasLayer2Coupling
      ? 'multi-area change has Layer 2 coupling context'
      : 'multi-area change within bounded scope',
  };
}

const CHECK_RUNNERS = Object.freeze({
  'duplicated-product-concept-monitor-vs-source-watch': ({ rootDir }) =>
    checkDuplicatedMonitorConcept(rootDir),
  'state-writer-reader-ordering-contract': ({ rootDir, layer2Couplings }) =>
    checkStateWriterReaderOrdering(rootDir, layer2Couplings),
  'latent-catch-swallows-non-primary-error': ({ rootDir }) =>
    checkLatentCatchSwallow(rootDir),
  'combined-pr-incoherent-architecture': ({ changedFiles, layer2Couplings }) =>
    checkCombinedPrIncoherence(changedFiles, layer2Couplings),
});

function worstReviewStatus(statuses) {
  const order = ['failed', 'unknown', 'incomplete', 'not-applicable', 'passed'];
  for (const s of order) {
    if (statuses.includes(s)) return s;
  }
  return 'unknown';
}

/**
 * Runs the bounded Layer 3 semantic review seed corpus.
 *
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {string[]} [opts.changedFiles]
 * @param {object[]} [opts.layer2Couplings]
 * @param {readonly object[]} [opts.seedCorpus]
 */
export function runSemanticReview(opts = {}) {
  const rootDir = opts.rootDir || process.cwd();
  const changedFiles = opts.changedFiles || [];
  const layer2Couplings = opts.layer2Couplings || [];
  const seedCorpus = opts.seedCorpus || SEMANTIC_REVIEW_SEED_CORPUS;

  const reviews = [];
  for (const seed of seedCorpus) {
    const runner = CHECK_RUNNERS[seed.id];
    let outcome;
    if (!runner) {
      outcome = { status: 'unknown', detail: `no runner registered for ${seed.id}` };
    } else {
      try {
        outcome = runner({ rootDir, changedFiles, layer2Couplings });
      } catch (err) {
        outcome = { status: 'collection-error', detail: err.message || String(err) };
      }
    }
    reviews.push({
      id: seed.id,
      layer: 3,
      category: seed.category,
      truthMatrixRow: seed.truthMatrixRow,
      prScope: seed.prScope,
      citation: seed.citation,
      requiresHumanJudgment: seed.category !== 'latent-unreached-code',
      ...outcome,
    });
  }

  const applicable = reviews.filter((r) => r.status !== 'not-applicable');
  return {
    layer: 3,
    overall: worstReviewStatus(applicable.map((r) => r.status)),
    reviews,
    seedCorpusSize: seedCorpus.length,
    applicableCount: applicable.length,
  };
}
