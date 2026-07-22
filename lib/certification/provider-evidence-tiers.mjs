/**
 * lib/certification/provider-evidence-tiers.mjs — a provider's evidence tier,
 * derived from manifest presence, schema validation, and real test-corpus
 * coverage. Sibling to evidence-tiers.mjs (the specialist ladder) per
 * ADR-0090 — providers cross a real subprocess/HTTP boundary specialists
 * never do, so this ladder has two rungs (contract-tested,
 * process-boundary-tested) with no specialist-ladder analog, and is
 * deliberately not a parameterization of computeEvidenceTier(). Does not
 * import from or modify evidence-tiers.mjs.
 *
 * Ladder, each rung requiring genuine evidence at the rung below it:
 *   declared                 — the provider's manifest file exists (the floor).
 *   structurally-validated   — the manifest passes lib/extensions/validate.mjs's
 *                              schema check (validateManifest).
 *   contract-tested          — a real test file imports the provider's actual
 *                              adapter/transport/governed-write module and
 *                              exercises it against an injected fake wire
 *                              boundary (fetchFn, transport, CLI adapter) —
 *                              not a bare fixture-shape check.
 *   process-boundary-tested  — a functional test crosses a real subprocess or
 *                              HTTP boundary (spawns the real `bin/construct`
 *                              binary, shells out to a real subprocess),
 *                              even against a local/sandboxed target.
 *   live-sandbox-tested      — verified against the real external API in a
 *                              sandbox/test account. Not derivable from static
 *                              analysis in this repo — requires an explicit,
 *                              human-set attestation in the manifest's
 *                              `certification.manualAttestation.liveSandboxTested`
 *                              block, never inferred by computeProviderEvidenceTier.
 *   production-proven        — real production usage with no incident. Same
 *                              treatment as live-sandbox-tested: requires an
 *                              explicit `certification.manualAttestation.productionProven`
 *                              attestation, never inferred.
 *
 * A provider with a schema-valid manifest but zero matching test-corpus
 * coverage caps at structurally-validated — the honest ceiling until a real
 * test exercises its adapter code. computeProviderEvidenceTier() is a pure
 * waterfall over a pre-gathered `evidence` object, each rung's attestation
 * unread until every rung below it already holds — a human-set
 * live-sandbox-tested flag with no contract/process-boundary evidence behind
 * stays capped at structurally-validated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from '../extensions/validate.mjs';
import { buildTestCorpusInventory } from '../test-corpus-inventory.mjs';
import { findProviderCard, loadProviderCards } from '../providers/provider-card.mjs';

export const PROVIDER_EVIDENCE_TIERS = Object.freeze([
  'declared',
  'structurally-validated',
  'contract-tested',
  'process-boundary-tested',
  'live-sandbox-tested',
  'production-proven',
]);

/**
 * @param {object} provider  { id } at minimum — identifies which manifest this
 *                            evidence describes; carried through into the result
 *                            for caller convenience, not read by the ladder logic.
 * @param {object} evidence  { declared, structurallyValid, structuralReason,
 *                              contractTested: {pass, testFiles},
 *                              processBoundaryTested: {pass, testFiles},
 *                              liveSandboxAttested: {attested, attestedAt, attestedBy, note},
 *                              productionProvenAttested: {attested, attestedAt, attestedBy, note} }
 * @returns {{tier: string|null, reason: string, evidence: object|null}}
 */
export function computeProviderEvidenceTier(provider, evidence = {}) {
  if (evidence.declared !== true) {
    return { tier: null, reason: 'no manifest file was found for this provider id', evidence: null };
  }

  if (evidence.structurallyValid !== true) {
    return {
      tier: 'declared',
      reason: evidence.structuralReason || 'manifest failed lib/extensions/validate.mjs schema validation',
      evidence: null,
    };
  }

  const contractTested = evidence.contractTested;
  if (!contractTested?.pass) {
    return {
      tier: 'structurally-validated',
      reason: 'no test in the corpus exercises this provider\'s real adapter/transport module against an injected wire boundary',
      evidence: null,
    };
  }

  const processBoundaryTested = evidence.processBoundaryTested;
  if (!processBoundaryTested?.pass) {
    return {
      tier: 'contract-tested',
      reason: 'adapter code is exercised against a fake wire boundary, but no test crosses a real subprocess/HTTP boundary',
      evidence: { contractTestFiles: contractTested.testFiles },
    };
  }

  const liveSandbox = evidence.liveSandboxAttested;
  if (!liveSandbox?.attested) {
    return {
      tier: 'process-boundary-tested',
      reason: 'a functional test crosses a real subprocess boundary, but live-sandbox verification requires an explicit human attestation not present in the manifest',
      evidence: { contractTestFiles: contractTested.testFiles, processBoundaryTestFiles: processBoundaryTested.testFiles },
    };
  }

  const productionProven = evidence.productionProvenAttested;
  if (!productionProven?.attested) {
    return {
      tier: 'live-sandbox-tested',
      reason: 'live-sandbox verification is attested, but production-proven requires a separate explicit human attestation not present in the manifest',
      evidence: {
        contractTestFiles: contractTested.testFiles,
        processBoundaryTestFiles: processBoundaryTested.testFiles,
        liveSandboxAttestedAt: liveSandbox.attestedAt,
        liveSandboxAttestedBy: liveSandbox.attestedBy,
      },
    };
  }

  return {
    tier: 'production-proven',
    reason: 'live-sandbox and production-proven are both explicitly attested by a human in the manifest',
    evidence: {
      contractTestFiles: contractTested.testFiles,
      processBoundaryTestFiles: processBoundaryTested.testFiles,
      liveSandboxAttestedAt: liveSandbox.attestedAt,
      liveSandboxAttestedBy: liveSandbox.attestedBy,
      productionProvenAttestedAt: productionProven.attestedAt,
      productionProvenAttestedBy: productionProven.attestedBy,
    },
  };
}

// Per-provider fingerprints for scanning the real test corpus. modulePaths
// are substrings of a real adapter/transport/governed-write module path —
// a test file that imports one of these is exercising that provider's real
// code, not a fixture. cliProviderId (when set) matches a
// `['sources', 'add', '<id>', ...]` CLI invocation, the signal for
// source-target providers (git, github corpus mode) that have no dedicated
// wire-call module of their own to import. This table is hand-maintained —
// a new provider or a new test file with an unconventional import path is a
// false negative until this table is updated, not something the detector
// infers on its own.

// Fallback-path fingerprints — substrings a test file must contain to count as
// exercising a Provider Card's declared fallback/degradation path. Hand-maintained
// like PROVIDER_TEST_FINGERPRINTS; construct-4uxq0.13.12 cross-checks card claims
// against these before treating fallback behavior as certified.

export const PROVIDER_FALLBACK_TEST_FINGERPRINTS = Object.freeze({
  docling: {
    contentPatterns: ['extractWithDoclingFallback', 'docling-fallback'],
  },
});

const FALLBACK_BEHAVIORS_REQUIRING_EVIDENCE = Object.freeze([
  'degraded-chain',
  'retry',
  'silent-drop',
]);

export const PROVIDER_TEST_FINGERPRINTS = Object.freeze({
  github: {
    modulePaths: [
      'lib/embed/providers/github.mjs',
      'lib/providers/contract/adapters/github/governed-write.mjs',
      'lib/providers/contract/adapters/github/index.mjs',
      'lib/providers/github/index.mjs',
    ],
    cliProviderId: 'github',
  },
  git: {
    modulePaths: [],
    cliProviderId: 'git',
  },
  linear: {
    modulePaths: ['lib/embed/providers/linear.mjs'],
    cliProviderId: null,
  },
  'atlassian-jira': {
    modulePaths: ['lib/embed/providers/jira.mjs', 'lib/providers/atlassian-jira/index.mjs'],
    cliProviderId: null,
  },
  'jira-write': {
    modulePaths: [
      'lib/providers/contract/adapters/jira/governed-write.mjs',
      'lib/providers/contract/adapters/jira/index.mjs',
      'lib/providers/contract/adapters/jira/transport.mjs',
    ],
    cliProviderId: null,
  },
  slack: {
    modulePaths: ['lib/embed/providers/slack.mjs', 'lib/providers/slack/index.mjs'],
    cliProviderId: null,
  },
  'atlassian-confluence': {
    modulePaths: ['lib/providers/atlassian-confluence/index.mjs'],
    cliProviderId: null,
  },
  'confluence-write': {
    modulePaths: [
      'lib/providers/contract/adapters/confluence/governed-write.mjs',
      'lib/providers/contract/adapters/confluence/index.mjs',
      'lib/providers/contract/adapters/confluence/transport.mjs',
    ],
    cliProviderId: null,
  },
});

const CHILD_PROCESS_RE = /\bspawnSync\s*\(|\bexecFileSync\s*\(|\bspawn\s*\(/;

function fileExercisesProvider(content, fingerprint) {
  if (fingerprint.modulePaths.some((p) => content.includes(p))) return true;
  if (fingerprint.cliProviderId) {
    const cliRe = new RegExp(`['"]sources['"],\\s*['"]add['"],\\s*['"]${fingerprint.cliProviderId}['"]`);
    if (cliRe.test(content)) return true;
  }
  return false;
}

/**
 * Scans the real test corpus (via lib/test-corpus-inventory.mjs, the same
 * indexer scripts/generate-test-corpus-inventory.mjs writes to
 * tests/capabilities/corpus-inventory.json) for files that exercise a given
 * provider's real code. A process-boundary hit also counts as contract-tested
 * evidence — a test that successfully crosses the real subprocess boundary
 * necessarily also exercises the code path a contract test would.
 *
 * @param {string} providerId
 * @param {{ rootDir?: string, corpusFiles?: Array<{path:string,category:string}> }} [opts]
 * @returns {{ contractTested: {pass:boolean, testFiles:string[]}, processBoundaryTested: {pass:boolean, testFiles:string[]} }}
 */
export function detectProviderTestEvidence(providerId, { rootDir = process.cwd(), corpusFiles } = {}) {
  const fingerprint = PROVIDER_TEST_FINGERPRINTS[providerId];
  if (!fingerprint) {
    return {
      contractTested: { pass: false, testFiles: [] },
      processBoundaryTested: { pass: false, testFiles: [] },
    };
  }

  const files = corpusFiles ?? buildTestCorpusInventory({ rootDir }).files;
  const contractFiles = [];
  const boundaryFiles = [];

  for (const entry of files) {
    if (entry.category === 'structural-guard') continue;
    let content;
    try {
      content = fs.readFileSync(path.join(rootDir, entry.path), 'utf8');
    } catch {
      continue;
    }
    if (!fileExercisesProvider(content, fingerprint)) continue;
    if (CHILD_PROCESS_RE.test(content)) boundaryFiles.push(entry.path);
    else contractFiles.push(entry.path);
  }

  return {
    contractTested: { pass: contractFiles.length > 0 || boundaryFiles.length > 0, testFiles: contractFiles },
    processBoundaryTested: { pass: boundaryFiles.length > 0, testFiles: boundaryFiles },
  };
}

function fallbackBehaviorRequiresTestEvidence(behavior) {
  return FALLBACK_BEHAVIORS_REQUIRING_EVIDENCE.includes(behavior);
}

function fileExercisesFallbackPath(content, fingerprint) {
  return fingerprint.contentPatterns.some((p) => content.includes(p));
}

/**
 * Scans the test corpus for files that exercise a provider's declared fallback
 * or degradation path (construct-4uxq0.13.12).
 */
export function detectProviderFallbackTestEvidence(providerId, { rootDir = process.cwd(), corpusFiles } = {}) {
  const fingerprint = PROVIDER_FALLBACK_TEST_FINGERPRINTS[providerId];
  if (!fingerprint) {
    return { pass: false, testFiles: [] };
  }

  const files = corpusFiles ?? buildTestCorpusInventory({ rootDir }).files;
  const hits = [];

  for (const entry of files) {
    if (entry.category === 'structural-guard') continue;
    let content;
    try {
      content = fs.readFileSync(path.join(rootDir, entry.path), 'utf8');
    } catch {
      continue;
    }
    if (fileExercisesFallbackPath(content, fingerprint)) hits.push(entry.path);
  }

  return { pass: hits.length > 0, testFiles: hits };
}

/**
 * Cross-checks a Provider Card's fallback claim against real test-corpus evidence.
 */
export function crossCheckProviderCardFallback({ providerId, card, rootDir = process.cwd(), corpusFiles } = {}) {
  if (!card?.fallback) return [];

  const behavior = card.fallback.behavior;
  if (!fallbackBehaviorRequiresTestEvidence(behavior)) return [];

  const fallbackTested = detectProviderFallbackTestEvidence(providerId, { rootDir, corpusFiles });
  if (fallbackTested.pass) return [];

  return [{
    providerId,
    behavior,
    message: `Provider Card declares fallback behavior "${behavior}" but no test in the corpus exercises the declared fallback path`,
    testFiles: fallbackTested.testFiles,
  }];
}

/**
 * Audits every Provider Card with a fallback claim that requires test evidence.
 */
export function auditProviderCardFallbackClaims({ rootDir = process.cwd(), corpusFiles, cards } = {}) {
  const registry = cards ? { ok: true, providers: cards } : loadProviderCards();
  const loaded = registry.ok ? registry.providers : [];
  const files = corpusFiles ?? buildTestCorpusInventory({ rootDir }).files;
  const gaps = [];

  for (const card of loaded) {
    gaps.push(...crossCheckProviderCardFallback({
      providerId: card.id,
      card,
      rootDir,
      corpusFiles: files,
    }));
  }

  return gaps;
}

/**
 * Reads certification.manualAttestation off a manifest object into the two
 * attestation-only rungs' evidence shape. Absent/malformed attestation
 * blocks read as not-attested rather than throwing — an honest floor, not a
 * validation error, since attestation is optional human input.
 */
function readManualAttestation(manifest) {
  const block = manifest?.certification?.manualAttestation;
  const live = block?.liveSandboxTested;
  const prod = block?.productionProven;
  return {
    liveSandboxAttested: {
      attested: live?.attested === true,
      attestedAt: live?.attestedAt ?? null,
      attestedBy: live?.attestedBy ?? null,
      note: live?.note ?? null,
    },
    productionProvenAttested: {
      attested: prod?.attested === true,
      attestedAt: prod?.attestedAt ?? null,
      attestedBy: prod?.attestedBy ?? null,
      note: prod?.note ?? null,
    },
  };
}

/**
 * Gathers real evidence for one manifest file from disk (existence, schema
 * validation, test-corpus fingerprint scan, and any human attestation
 * already recorded in the manifest) and computes its tier. This is the IO
 * boundary; computeProviderEvidenceTier itself stays a pure function so its
 * ceiling logic is unit-testable without touching the filesystem.
 *
 * @param {{ id: string, filePath: string }} descriptor
 * @param {{ rootDir?: string, corpusFiles?: Array }} [opts]
 * @returns {{ provider: object, tier: string|null, reason: string, evidence: object|null, manifestErrors: string[] }}
 */
export function auditProviderManifest({ id, filePath }, { rootDir = process.cwd(), corpusFiles } = {}) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
  const provider = { id, filePath };

  if (!fs.existsSync(absPath)) {
    return {
      provider,
      ...computeProviderEvidenceTier(provider, { declared: false }),
      manifestErrors: [`${filePath}: file does not exist`],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (err) {
    return {
      provider,
      ...computeProviderEvidenceTier(provider, { declared: true, structurallyValid: false, structuralReason: `failed to parse JSON (${err.message})` }),
      manifestErrors: [`${filePath}: failed to parse JSON (${err.message})`],
    };
  }

  const schemaCheck = validateManifest(manifest, { filePath });
  if (!schemaCheck.valid) {
    return {
      provider,
      ...computeProviderEvidenceTier(provider, {
        declared: true,
        structurallyValid: false,
        structuralReason: schemaCheck.errors.join('; '),
      }),
      manifestErrors: schemaCheck.errors,
    };
  }

  const { contractTested, processBoundaryTested } = detectProviderTestEvidence(id, { rootDir, corpusFiles });
  const { liveSandboxAttested, productionProvenAttested } = readManualAttestation(manifest);
  const providerCard = findProviderCard(id, { registryPath: path.join(rootDir, 'registry', 'provider-cards.json') });
  const cardFallbackGaps = crossCheckProviderCardFallback({
    providerId: id,
    card: providerCard,
    rootDir,
    corpusFiles,
  });

  const evidence = {
    declared: true,
    structurallyValid: true,
    contractTested,
    processBoundaryTested,
    liveSandboxAttested,
    productionProvenAttested,
  };

  const tierResult = computeProviderEvidenceTier(provider, evidence);
  const reason = cardFallbackGaps.length > 0
    ? `${tierResult.reason}; provider card fallback gap: ${cardFallbackGaps.map((g) => g.message).join('; ')}`
    : tierResult.reason;

  return {
    provider,
    ...tierResult,
    reason,
    cardFallbackGaps,
    providerCardId: providerCard?.id ?? null,
    manifestErrors: [],
  };
}

// The read-side manifests (lib/extensions/manifests/*.manifest.json) and the
// colocated governed-write manifests (lib/providers/contract/adapters/*/manifest.json,
// deliberately excluded from the shared discovery registry per their own
// "notes" fields) that construct-4uxq0.13.2 audited for github/git/linear/
// jira/slack/confluence. Slack's governed-write manifest does not exist yet
// (construct-4uxq0.9.4, a parallel bead, adds it) — omitted here rather than
// guessed at; add it once that bead lands. GitHub has no governed-write
// manifest.json today either (lib/providers/contract/adapters/github/ has no
// manifest.json, unlike jira/ and confluence/) — a real, pre-existing gap
// surfaced by this audit, not papered over by it.

export const KNOWN_PROVIDER_MANIFESTS = Object.freeze([
  { id: 'github', filePath: 'lib/extensions/manifests/github.manifest.json' },
  { id: 'git', filePath: 'lib/extensions/manifests/git.manifest.json' },
  { id: 'linear', filePath: 'lib/extensions/manifests/linear.manifest.json' },
  { id: 'atlassian-jira', filePath: 'lib/extensions/manifests/atlassian-jira.manifest.json' },
  { id: 'slack', filePath: 'lib/extensions/manifests/slack.manifest.json' },
  { id: 'atlassian-confluence', filePath: 'lib/extensions/manifests/atlassian-confluence.manifest.json' },
  { id: 'jira-write', filePath: 'lib/providers/contract/adapters/jira/manifest.json' },
  { id: 'confluence-write', filePath: 'lib/providers/contract/adapters/confluence/manifest.json' },
]);

/**
 * Audits every manifest in `manifests` (default: KNOWN_PROVIDER_MANIFESTS)
 * and returns one evidence-tier record per manifest. The test-corpus scan
 * runs once and is shared across all manifests — an infrequent audit
 * command, not a hot path.
 *
 * @param {{ rootDir?: string, manifests?: Array<{id:string, filePath:string}> }} [opts]
 * @returns {Array<ReturnType<typeof auditProviderManifest>>}
 */
export function auditKnownProviderManifests({ rootDir = process.cwd(), manifests = KNOWN_PROVIDER_MANIFESTS, corpusFiles } = {}) {
  const files = corpusFiles ?? buildTestCorpusInventory({ rootDir }).files;
  return manifests.map((descriptor) => auditProviderManifest(descriptor, { rootDir, corpusFiles: files }));
}

// The rung required before a provider may be used for production traffic is
// a risk-tolerance call ADR-0090 explicitly leaves to the user ("Owner: Audit
// ladder, User gate") — not something this module hardcodes. contract-tested
// is the default: it is the lowest rung that requires exercising the
// provider's actual code path against a realistic wire shape (request
// construction, response parsing, error mapping) rather than only a
// schema-valid manifest, which is the minimum bar that would have caught
// ADR-0090's motivating case (Jira's createmeta/search calls silently
// approaching a production 410 with nothing but a flat, unverified
// "capabilities": ["read", "search"] declaration). It is deliberately not
// process-boundary-tested: at audit time every real manifest but git/github's
// corpus-sync path caps below that rung, so defaulting there would gate out
// most of what already runs in production today without new evidence to
// justify it. Override via `override`, then CONSTRUCT_PROVIDER_PRODUCTION_GATE_TIER,
// then this default — set explicitly by whoever owns that risk call, per provider
// or globally, once real usage data exists to inform it.

export const DEFAULT_PRODUCTION_GATE_TIER = 'contract-tested';

export function resolveProductionGateTier({ override } = {}) {
  const candidate = override ?? process.env.CONSTRUCT_PROVIDER_PRODUCTION_GATE_TIER ?? DEFAULT_PRODUCTION_GATE_TIER;
  if (!PROVIDER_EVIDENCE_TIERS.includes(candidate)) {
    throw new Error(`invalid production gate tier "${candidate}"; expected one of: ${PROVIDER_EVIDENCE_TIERS.join(', ')}`);
  }
  return candidate;
}

/**
 * @param {string|null} tier      a provider's computed tier (null = undeclared)
 * @param {string} gateTier       the configured production gate, e.g. resolveProductionGateTier()
 * @returns {boolean}
 */
export function meetsProductionGate(tier, gateTier) {
  if (tier === null || tier === undefined) return false;
  return PROVIDER_EVIDENCE_TIERS.indexOf(tier) >= PROVIDER_EVIDENCE_TIERS.indexOf(gateTier);
}

/**
 * Reads the manifest's recorded certification.tier claim, if any. Absent or
 * malformed certification blocks read as no claim rather than throwing.
 */
function readClaimedCertificationTier(filePath, { rootDir = process.cwd() } = {}) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
  if (!fs.existsSync(absPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const tier = manifest?.certification?.tier;
    return typeof tier === 'string' && tier.length > 0 ? tier : null;
  } catch {
    return null;
  }
}

/**
 * Compares each known provider manifest's recorded certification.tier against
 * the tier auditKnownProviderManifests() computes during the audit pass. Returns one drift
 * record per provider whose claimed tier differs from the recomputed tier.
 *
 * @param {{ rootDir?: string, manifests?: Array<{id:string, filePath:string}> }} [opts]
 * @returns {Array<{ providerId: string, filePath: string, claimedTier: string, computedTier: string|null }>}
 */
export function findProviderCertificationDrift({ rootDir = process.cwd(), manifests = KNOWN_PROVIDER_MANIFESTS, corpusFiles } = {}) {
  const audits = auditKnownProviderManifests({ rootDir, manifests, corpusFiles });
  const drifts = [];

  for (const audit of audits) {
    const claimedTier = readClaimedCertificationTier(audit.provider.filePath, { rootDir });
    if (claimedTier === null) continue;
    if (claimedTier === audit.tier) continue;
    drifts.push({
      providerId: audit.provider.id,
      filePath: audit.provider.filePath,
      claimedTier,
      computedTier: audit.tier,
    });
  }

  return drifts;
}
