/**
 * lib/tracker/contribute.mjs — analyze → propose → dedupe → apply pipeline for
 * contributing governed issue proposals back to an external tracker (bead
 * construct-760c.6). Jira first, but provider-generic: the write goes through the
 * existing governed `provider_write` path, so a tracker's eligibility is its
 * manifest `write` capability, not a hardcoded name here.
 *
 * Five stages:
 *   1. FETCH   existing issues from the tracker (injectable; default reads via
 *              the jira embed provider's JQL).
 *   2. ANALYZE the registered project corpora (B2 content roots) for work the
 *              tracker does not yet cover — deterministic, retrieval-only, so the
 *              proposal set is stable and CI-testable without a model.
 *   3. PROPOSE a proposal artifact (JSON + markdown): each proposed issue carries
 *              a summary, an evidence-cited description (origin.targetId +
 *              relPath — no fabrication), a suggested type, and a stable
 *              idempotency key. The artifact is the human-review anchor.
 *   4. DEDUPE  proposed vs existing issue summaries by token similarity;
 *              near-duplicates are suppressed and reported with the matched key.
 *   5. APPLY   batch through provider_write — dry_run by default (writes
 *              nothing), an approval token required to execute. Idempotent:
 *              an issue already recorded created for this proposal is skipped, so
 *              a second apply is a no-op.
 *
 * Beads are never touched (R5): bd stays the internal tracker; this pipeline only
 * proposes to the external one.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { resolveContentRoots, expandProjectsFilter } from '../sources/content-roots.mjs';
import { buildCorpus } from '../knowledge/rag.mjs';

const DEFAULT_PROPOSAL_LIMIT = 10;
const DEDUPE_THRESHOLD = 0.6;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with', 'track', 'add', 'document', 'implement']);

function tokenize(text) {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function proposalsDir(cwd) {
  return path.join(cwd, '.cx', 'tracker', 'proposals');
}

function stableId(projectKey, items) {
  const h = crypto.createHash('sha256');
  h.update(projectKey);
  for (const it of items) h.update(`|${it.key}`);
  return `prop-${h.digest('hex').slice(0, 12)}`;
}

// A tracker source target names its project via the manifest selector field
// (jira: `project`). Resolve the requested target id to that key, or throw a
// hard error naming the known tracker targets.
function resolveTrackerTarget(targets, targetId) {
  const target = targets.find((t) => t.id === targetId);
  if (!target) {
    const known = targets.map((t) => t.id).join(', ') || '(none registered)';
    throw new Error(`unknown tracker target "${targetId}" — known targets: ${known}`);
  }
  const projectKey = target.selector?.project || target.selector?.[Object.keys(target.selector || {})[0]];
  if (!projectKey) throw new Error(`tracker target "${targetId}" has no resolvable project key`);
  return { target, projectKey };
}

// Deterministic analyze: each source doc in a bound project's corpus is a
// candidate work item to track, summarized from its title and cited to its
// origin. Ordering is stable (project id, then relPath) so proposals reproduce.
function buildCandidates(roots, cwd, limit) {
  const candidates = [];
  for (const root of roots) {
    const chunks = buildCorpus(cwd, { roots: [root] })
      .filter((c) => c.origin?.targetId === root.origin.targetId && c.origin?.relPath)
      .sort((a, b) => a.origin.relPath.localeCompare(b.origin.relPath));
    const seen = new Set();
    for (const c of chunks) {
      if (seen.has(c.origin.relPath)) continue;
      seen.add(c.origin.relPath);
      const summary = `Track: ${c.title} (${c.origin.projectKey})`;
      candidates.push({
        key: `${c.origin.targetId}:${c.origin.relPath}`,
        summary,
        issueType: 'Task',
        evidence: [{ targetId: c.origin.targetId, projectKey: c.origin.projectKey, relPath: c.origin.relPath }],
        title: c.title,
      });
    }
  }
  candidates.sort((a, b) => a.key.localeCompare(b.key));
  return candidates.slice(0, limit);
}

function renderDescription(candidate) {
  const cite = candidate.evidence.map((e) => `\`${e.projectKey}:${e.relPath}\``).join(', ');
  return [
    `Proposed from analysis of registered project content.`,
    ``,
    `Source: ${cite}`,
    ``,
    `Scope [unverified]: derive concrete acceptance criteria from the cited source before starting — details beyond the source title are not yet verified.`,
  ].join('\n');
}

function dedupe(candidates, existingIssues) {
  const existingTok = existingIssues.map((i) => ({ key: i.key, tokens: tokenize(i.summary || i.title || '') }));
  const proposals = [];
  const suppressed = [];
  for (const c of candidates) {
    const ctok = tokenize(c.summary);
    let best = null;
    for (const e of existingTok) {
      const score = jaccard(ctok, e.tokens);
      if (score >= DEDUPE_THRESHOLD && (!best || score > best.score)) best = { key: e.key, score };
    }
    if (best) {
      suppressed.push({ key: c.key, summary: c.summary, matchedIssueKey: best.key, similarity: Math.round(best.score * 100) / 100 });
    } else {
      proposals.push(c);
    }
  }
  return { proposals, suppressed };
}

/**
 * Default issue fetch: read the tracker target's existing issues through the
 * jira embed provider. Injectable via deps.fetchIssues for tests.
 */
async function defaultFetchIssues({ projectKey, env }) {
  const { JiraProvider } = await import('../embed/providers/jira.mjs');
  const provider = new JiraProvider({ env });
  const items = await provider.read('issues', { project: projectKey });
  return (items || []).filter((i) => i && i.key).map((i) => ({ key: i.key, summary: i.title || i.summary || '' }));
}

function renderProposalMarkdown(proposal) {
  const lines = [
    `# Tracker contribution proposal — ${proposal.projectKey}`,
    ``,
    `Proposal id: \`${proposal.id}\` · target: \`${proposal.targetId}\` · generated ${proposal.createdAt}`,
    ``,
    `## Proposed issues (${proposal.proposals.length})`,
    ``,
  ];
  for (const p of proposal.proposals) {
    lines.push(`### ${p.summary}`, ``, `- type: ${p.issueType}`, `- idempotency key: \`${p.key}\``, ``, renderDescription(p), ``);
  }
  lines.push(`## Dedupe report (${proposal.suppressed.length} suppressed)`, ``);
  if (proposal.suppressed.length) {
    lines.push(`| Proposed | Matched issue | Similarity |`, `|---|---|---|`);
    for (const s of proposal.suppressed) lines.push(`| ${s.summary} | ${s.matchedIssueKey} | ${s.similarity} |`);
  } else {
    lines.push(`_No near-duplicates suppressed._`);
  }
  return lines.join('\n') + '\n';
}

function saveProposal(cwd, proposal) {
  const dir = proposalsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${proposal.id}.json`), `${JSON.stringify(proposal, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, `${proposal.id}.md`), renderProposalMarkdown(proposal));
  return { json: path.join(dir, `${proposal.id}.json`), md: path.join(dir, `${proposal.id}.md`) };
}

export function loadProposal(cwd, proposalId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(proposalsDir(cwd), `${proposalId}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Stages 1–4: fetch existing issues, analyze bound project corpora, propose
 * evidence-cited issues, dedupe against existing, and persist the proposal
 * artifact. No writes to the tracker.
 */
export async function analyzeAndPropose({ target, against, cwd = process.cwd(), env = process.env, limit = DEFAULT_PROPOSAL_LIMIT, deps = {} } = {}) {
  const { config } = loadProjectConfig(cwd, env);
  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
  const { projectKey } = resolveTrackerTarget(targets, target);

  let selectedIds;
  try {
    selectedIds = expandProjectsFilter(against ?? 'all', targets).ids;
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const roots = resolveContentRoots(targets, { projectRoot: cwd })
    .filter((r) => selectedIds.has(r.origin.targetId));
  if (!roots.length) {
    return { ok: false, message: `no content-capable projects resolved for "${against ?? 'all'}" to analyze against` };
  }

  const fetchIssues = deps.fetchIssues ?? defaultFetchIssues;
  const existing = await fetchIssues({ projectKey, env });

  const candidates = buildCandidates(roots, cwd, limit);
  const { proposals, suppressed } = dedupe(candidates, existing);

  const now = deps.now ?? (() => new Date().toISOString());
  const proposal = {
    id: stableId(projectKey, candidates),
    targetId: target,
    projectKey,
    createdAt: now(),
    existingIssueCount: existing.length,
    proposals: proposals.map((p) => ({ key: p.key, summary: p.summary, issueType: p.issueType, evidence: p.evidence, description: renderDescription(p) })),
    suppressed,
  };
  const paths = saveProposal(cwd, proposal);
  return { ok: true, proposal, paths };
}

/**
 * Stage 5: apply a proposal through the governed write path. Without
 * approveToken every write is a dry-run (renders payloads, writes nothing).
 * Idempotent: an issue already recorded created for this proposal is skipped, so
 * re-apply never creates a duplicate (R3/AC5).
 */
export async function applyProposal({ proposalId, proposal: inline, approveToken = null, cwd = process.cwd(), env = process.env, deps = {} } = {}) {
  const proposal = inline || loadProposal(cwd, proposalId);
  if (!proposal) return { ok: false, message: `proposal not found: ${proposalId}` };

  const write = deps.providerWrite ?? (async (args) => (await import('../mcp/tools/provider-write.mjs')).providerWrite(args, { rootDir: cwd, env }));
  const dryRun = !approveToken;

  const auditPath = path.join(proposalsDir(cwd), `${proposal.id}.audit.json`);
  let audit = [];
  try { audit = JSON.parse(fs.readFileSync(auditPath, 'utf8')); } catch { audit = []; }
  const alreadyCreated = new Set(audit.map((a) => a.key));

  const results = [];
  for (const p of proposal.proposals) {
    if (!dryRun && alreadyCreated.has(p.key)) {
      results.push({ key: p.key, status: 'skipped-idempotent' });
      continue;
    }
    const item = { type: 'issue', project: proposal.projectKey, issueType: p.issueType, summary: p.summary, description: p.description };
    const res = await write({ provider: 'jira', item, dry_run: dryRun, idempotency_key: `${proposal.id}:${p.key}`, approval_token: approveToken });
    results.push({ key: p.key, status: res.status, dryRun });
    if (!dryRun && res.status && !String(res.status).startsWith('denied')) {
      const issueKey = res.envelope?.result?.key || res.envelope?.issueKey || null;
      audit.push({ key: p.key, proposalId: proposal.id, issueKey, at: (deps.now ?? (() => new Date().toISOString()))() });
    }
  }

  if (!dryRun) {
    fs.mkdirSync(proposalsDir(cwd), { recursive: true });
    fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  }
  return { ok: true, proposalId: proposal.id, dryRun, results, audit: dryRun ? undefined : audit };
}
