/**
 * lib/intake/classify.mjs — R&D triage classification for intake packets.
 *
 * Deterministic, keyword-driven classifier that maps a raw intake signal
 * onto the R&D loop: intakeType (what kind of work), rdStage (where in
 * the loop), primaryOwner persona, recommendedChain (handoff sequence),
 * recommendedAction, risk, requiresApproval, confidence, rationale.
 *
 * NO LLM call. The daemon path must remain synchronous and cheap; intent
 * verification belongs in offline measurement, not inline classification.
 * Persona names match agents/registry.json (unprefixed).
 */

import path from 'node:path';

export const INTAKE_TYPES = [
  'user-signal',
  'bug',
  'requirement',
  'research',
  'experiment',
  'eval-finding',
  'architecture',
  'incident',
  'launch-asset',
  'ops',
  'security',
  'legal-compliance',
  'unknown',
];

export const RD_STAGES = [
  'signal',
  'framing',
  'hypothesis',
  'research',
  'artifact',
  'design',
  'implementation',
  'evaluation',
  'release',
  'operations',
  'unknown',
];

export const RECOMMENDED_ACTIONS = [
  'summarize',
  'clarify',
  'research',
  'create-hypothesis',
  'draft-prd',
  'draft-rfc',
  'draft-adr',
  'create-experiment',
  'diagnose',
  'implement',
  'evaluate',
  'release-review',
  'create-runbook',
  'archive',
];

/**
 * Classification table — intakeType → triage spine.
 * Keyword set drives detection; the rest of the row is the canonical mapping
 * for that signal class. Order matters for tie-breaking: earlier rows win on
 * equal raw scores so that high-stakes classes (security, incident) take
 * precedence over generic ones (research) when keywords overlap.
 */
const CLASSIFICATION_TABLE = [
  {
    intakeType: 'security',
    keywords: ['security', 'secret', 'cve', 'vulnerability', 'vuln', 'exploit', 'leak', 'auth bypass', 'privilege escalation', 'sqli', 'xss', 'csrf', 'rce'],
    rdStage: 'operations',
    primaryOwner: 'security',
    recommendedChain: ['security', 'engineer', 'reviewer'],
    recommendedAction: 'diagnose',
    risk: 'high',
    requiresApproval: true,
  },
  {
    intakeType: 'incident',
    keywords: ['incident', 'outage', 'slo breach', 'sla breach', 'latency spike', 'availability', 'down', 'p0 ', 'p1 ', 'pagerduty', '5xx', 'oncall'],
    rdStage: 'operations',
    primaryOwner: 'sre',
    recommendedChain: ['sre', 'debugger', 'platform-engineer'],
    recommendedAction: 'create-runbook',
    risk: 'high',
    requiresApproval: true,
  },
  {
    intakeType: 'legal-compliance',
    keywords: ['gdpr', 'ccpa', 'hipaa', 'sox', 'soc2', 'license', 'lawsuit', 'dpa', 'data retention', 'pii', 'subpoena', 'compliance audit'],
    rdStage: 'operations',
    primaryOwner: 'legal-compliance',
    recommendedChain: ['legal-compliance', 'security', 'product-manager'],
    recommendedAction: 'clarify',
    risk: 'high',
    requiresApproval: true,
  },
  {
    intakeType: 'architecture',
    keywords: ['architecture', 'adr', 'rfc', 'interface', 'tradeoff', 'boundary', 'system design', 'data model', 'api contract', 'migration plan'],
    rdStage: 'design',
    primaryOwner: 'architect',
    recommendedChain: ['architect', 'devil-advocate', 'engineer'],
    recommendedAction: 'draft-rfc',
    risk: 'medium',
    requiresApproval: false,
  },
  {
    intakeType: 'eval-finding',
    keywords: ['eval', 'evaluation', 'hallucination', 'judge', 'trace', 'score regression', 'recall@', 'precision@', 'mrr', 'ndcg', 'failure case', 'rubric'],
    rdStage: 'evaluation',
    primaryOwner: 'evaluator',
    recommendedChain: ['evaluator', 'ai-engineer', 'trace-reviewer'],
    recommendedAction: 'evaluate',
    risk: 'medium',
    requiresApproval: false,
  },
  {
    intakeType: 'bug',
    keywords: ['bug', 'broken', 'error', 'stack trace', 'regression', 'crash', 'exception', 'fails', 'failing', 'throws', 'not working', 'reproduce', 'repro:'],
    rdStage: 'implementation',
    primaryOwner: 'debugger',
    recommendedChain: ['debugger', 'engineer', 'qa', 'reviewer'],
    recommendedAction: 'diagnose',
    risk: 'medium',
    requiresApproval: false,
  },
  {
    intakeType: 'experiment',
    keywords: ['hypothesis', 'experiment', 'spike', 'prototype', 'falsifiable', 'research question', 'a/b test', 'pilot'],
    rdStage: 'hypothesis',
    primaryOwner: 'rd-lead',
    recommendedChain: ['rd-lead', 'researcher', 'evaluator'],
    recommendedAction: 'create-experiment',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'launch-asset',
    keywords: ['release', 'changelog', 'version bump', 'ship', 'launch', 'rollout', 'cut a release', 'rc1', 'rc2', 'release candidate'],
    rdStage: 'release',
    primaryOwner: 'release-manager',
    recommendedChain: ['release-manager', 'qa', 'docs-keeper'],
    recommendedAction: 'release-review',
    risk: 'medium',
    requiresApproval: false,
  },
  {
    intakeType: 'research',
    keywords: ['competitor', 'market', 'pricing', 'positioning', 'industry', 'state of the art', 'literature', 'benchmark study', 'desk research'],
    rdStage: 'research',
    primaryOwner: 'business-strategist',
    recommendedChain: ['business-strategist', 'researcher', 'product-manager'],
    recommendedAction: 'research',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'user-signal',
    keywords: ['customer', 'feedback', 'pain point', 'user says', 'user feedback', 'support ticket', 'churn', 'nps', 'usability', 'frustrated'],
    rdStage: 'signal',
    primaryOwner: 'product-manager',
    recommendedChain: ['product-manager', 'ux-researcher', 'researcher'],
    recommendedAction: 'clarify',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'requirement',
    keywords: ['acceptance criteria', 'requirement', 'must have', 'should have', 'feature request', 'prd', 'use case', 'success metric'],
    rdStage: 'framing',
    primaryOwner: 'product-manager',
    recommendedChain: ['product-manager', 'architect', 'engineer'],
    recommendedAction: 'draft-prd',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'ops',
    keywords: ['runbook', 'cron', 'scheduled job', 'maintenance', 'backup', 'restore', 'capacity plan', 'cost optimization', 'dependency upgrade'],
    rdStage: 'operations',
    primaryOwner: 'operations',
    recommendedChain: ['operations', 'sre', 'engineer'],
    recommendedAction: 'create-runbook',
    risk: 'low',
    requiresApproval: false,
  },
];

const UNKNOWN_TRIAGE = {
  intakeType: 'unknown',
  rdStage: 'unknown',
  primaryOwner: 'orchestrator',
  recommendedChain: ['orchestrator'],
  recommendedAction: 'summarize',
  risk: 'low',
  requiresApproval: false,
};

function normalize(text) {
  return String(text || '').toLowerCase();
}

function countMatches(haystack, keywords) {
  let hits = 0;
  const matched = [];
  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      hits += 1;
      matched.push(kw);
    }
  }
  return { hits, matched };
}

function buildSignalText({ sourcePath, extractedText, related }) {
  const basename = sourcePath ? path.basename(sourcePath) : '';
  const slug = basename.replace(/[._-]/g, ' ');
  const body = extractedText ? extractedText.slice(0, 4000) : '';
  const relatedTitles = (related || []).map((r) => r?.title || '').join(' ');
  return normalize(`${slug} ${body} ${relatedTitles}`);
}

/**
 * Classify an R&D intake signal.
 *
 * Returns a triage object with: intakeType, rdStage, primaryOwner,
 * recommendedChain, recommendedAction, risk, requiresApproval, confidence,
 * rationale. The function is pure and deterministic; same input → same output.
 */
export function classifyRdIntake({ sourcePath = '', extractedText = '', related = [] } = {}) {
  const signal = buildSignalText({ sourcePath, extractedText, related });

  let best = null;
  for (const entry of CLASSIFICATION_TABLE) {
    const { hits, matched } = countMatches(signal, entry.keywords);
    if (hits === 0) continue;
    if (!best || hits > best.hits) {
      best = { entry, hits, matched };
    }
  }

  if (!best) {
    return {
      ...UNKNOWN_TRIAGE,
      confidence: 0.3,
      rationale: 'No classification keywords matched filename, content excerpt, or related-doc titles.',
    };
  }

  const { entry, hits, matched } = best;
  const confidence = Math.min(1, 0.4 + 0.2 * hits);
  const matchedList = matched.slice(0, 4).join(', ');
  const rationale = `Matched ${hits} keyword${hits === 1 ? '' : 's'} for ${entry.intakeType}: ${matchedList}.`;

  return {
    intakeType: entry.intakeType,
    rdStage: entry.rdStage,
    primaryOwner: entry.primaryOwner,
    recommendedChain: [...entry.recommendedChain],
    recommendedAction: entry.recommendedAction,
    risk: entry.risk,
    requiresApproval: entry.requiresApproval,
    confidence,
    rationale,
  };
}

export function formatTriageLine(sourcePath, triage) {
  const basename = sourcePath ? path.basename(sourcePath) : '(unknown source)';
  if (!triage || triage.intakeType === 'unknown') {
    return `${basename} → unclassified · owner: orchestrator · next: summarize`;
  }
  return `${basename} → ${triage.intakeType} / ${triage.rdStage} · owner: ${triage.primaryOwner} · next: ${triage.recommendedAction}`;
}
