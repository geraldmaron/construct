/**
 * lib/embed/presets/ops-triage.mjs — deterministic triage analysis for the
 * `operations` embed preset (triage mode; see the embed-capability manifest
 * schema decision record).
 *
 * Pure deterministic `reasoningExecutor(plan, ctx)` that the embed capability
 * tick accepts: reads operations specialist's bound provider snapshot slice
 * (Jira + Confluence/Directory sections, binding-scoped and filter-narrowed
 * by caller) and applies ops triage framework. Produces output packet validating
 * against `operations-triage` output contract plus writeIntents (Jira link +
 * comment proposals) for caller to enqueue for approval.
 *
 * Every load-bearing claim carries provenance: a source id (Jira issue key,
 * Confluence page id) reader can re-verify. Finding with no covering evidence
 * is reported with `[unverified]`, never a fabricated issue key.
 *
 * Analysis moves (mapped to ops triage framework):
 *   1. Inventory issues from bound Jira project.
 *   2. Detect duplicates: similar summaries + same component/type.
 *   3. Check specification completeness: description length, field coverage.
 *   4. Each proposal is typed writeIntent (duplicate-link or needs-info).
 *   5. No write executes without approval.
 */

const JIRA_PROVIDER = 'atlassian-jira';
const CONFLUENCE_PROVIDER = 'atlassian-confluence';
const DIRECTORY_PROVIDER = 'directory';

const JIRA_LINK_KIND = 'updateItem';
const JIRA_COMMENT_KIND = 'comment';

// Minimum description length to be considered specified.
const MIN_SPEC_LENGTH = 50;

// Similarity threshold for duplicate detection (word-based Jaccard similarity).
const DUPLICATE_SIMILARITY_THRESHOLD = 0.3;

function sectionItems(sections, providerId) {
  const section = (sections || []).find((s) => s.provider === providerId);
  return Array.isArray(section?.items) ? section.items : [];
}

function issueKey(issue) {
  return issue?.key ?? issue?.id ?? 'unknown';
}

function issueId(issue) {
  return issue?.id ?? issue?.key ?? 'unknown';
}

// Word-based similarity: ratio of common words to total unique words; signals potential duplicates for manual review.

function wordSimilarity(text1, text2) {
  const normalize = (t) => String(t ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));
  const union = new Set([...words1, ...words2]);
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Extract properties for triage checks: key, summary, description, type, component, status.

export function inventoryNewIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => ({
    key: issueKey(issue),
    id: issueId(issue),
    summary: issue?.summary ?? '[untitled]',
    description: String(issue?.description ?? '').trim(),
    type: issue?.type ?? 'unknown',
    component: issue?.component ?? issue?.components?.[0] ?? 'unknown',
    status: issue?.status ?? 'unknown',
    created: issue?.created ?? issue?.createdDate ?? 'unknown',
    sourceIssue: issue,
  }));
}

// Compare each issue against others for same type + component + high summary similarity.

export function findDuplicates(inventoriedIssues) {
  const findings = [];
  const proposals = [];

  // For each issue, check against all earlier issues (to avoid duplicate pairs).
  for (let i = 0; i < inventoriedIssues.length; i++) {
    const current = inventoriedIssues[i];
    for (let j = 0; j < i; j++) {
      const other = inventoriedIssues[j];

      // Heuristic: same type + same component + high summary similarity.
      const sameType = current.type === other.type;
      const sameComponent = current.component === other.component;
      const similarity = wordSimilarity(current.summary, other.summary);

      if (sameType && sameComponent && similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
        findings.push({
          kind: 'potential-duplicate',
          issue: current.key,
          candidate: other.key,
          similarity: similarity.toFixed(2),
          evidence: {
            issue: current.key,
            candidate: other.key,
            type: current.type,
            component: current.component,
            similarity: similarity.toFixed(2),
          },
          statement: `${current.key} (${current.summary}) appears to be a duplicate of ${other.key} (${other.summary}) — same type/component, similarity ${(similarity * 100).toFixed(0)}% (sources ${current.key}, ${other.key}).`,
        });

        // Propose a duplicate-link: link the newer issue to the older one.
        proposals.push({
          providerId: JIRA_PROVIDER,
          writeKind: JIRA_LINK_KIND,
          issueKey: current.key,
          duplicateCandidateKey: other.key,
          payload: {
            type: 'link',
            linkType: 'duplicates',
            fromKey: current.key,
            toKey: other.key,
          },
        });
      }
    }
  }

  return { findings, proposals };
}

// Check specification completeness: description too short or no acceptance criteria/expected outcome.

export function findUnderspecified(inventoriedIssues) {
  const findings = [];
  const proposals = [];

  for (const issue of inventoriedIssues) {
    const reasons = [];
    if (issue.description.length < MIN_SPEC_LENGTH) {
      reasons.push('description too brief');
    }
    if (!issue.description.includes('acceptance') && !issue.description.includes('criteria')) {
      reasons.push('no visible acceptance criteria');
    }

    if (reasons.length > 0) {
      findings.push({
        kind: 'underspecified',
        issue: issue.key,
        reasons,
        evidence: {
          issue: issue.key,
          descriptionLength: issue.description.length,
          reasons,
        },
        statement: `${issue.key} is under-specified: ${reasons.join(', ')} (source ${issue.key}).`,
      });

      // Propose a needs-info comment with a template.
      proposals.push({
        providerId: JIRA_PROVIDER,
        writeKind: JIRA_COMMENT_KIND,
        issueKey: issue.key,
        payload: {
          type: 'comment',
          text: 'Hi! This ticket needs a bit more detail to get started. Could you add:\n- A clear problem statement\n- Acceptance criteria or expected outcomes\n- Any known constraints or dependencies\n\nThanks!',
        },
      });
    }
  }

  return { findings, proposals };
}

// Pure deterministic triage analysis: reads sections, produces output packet + write proposals + summary.

export function analyzeOpsTriage(sections, { now = Date.now(), generatedAt } = {}) {
  const issues = sectionItems(sections, JIRA_PROVIDER);

  const inventoried = inventoryNewIssues(issues);
  const duplicates = findDuplicates(inventoried);
  const underspecified = findUnderspecified(inventoried);

  const allFindings = [...duplicates.findings, ...underspecified.findings];
  const allProposals = [...duplicates.proposals, ...underspecified.proposals];
  const provenance = inventoried.map((i) => i.key);

  const analysis = {
    generatedAt: generatedAt ?? new Date(now).toISOString(),
    inventoried,
    duplicates: duplicates.findings,
    underspecified: underspecified.findings,
    allFindings,
  };

  const summary = [
    `Triaged ${inventoried.length} issues.`,
    `Found ${duplicates.findings.length} potential duplicates.`,
    `Found ${underspecified.findings.length} under-specified tickets.`,
  ].join(' ');

  // Each contract field is a section wrapper ({ count, findings/items })
  // rather than a bare array so a legitimately empty section still counts as
  // present under the output contract — an absent section signals a broken
  // producer, an empty one signals "checked, nothing found".
  const outputPacket = {
    inventoried: { count: inventoried.length, items: inventoried },
    duplicates: { count: duplicates.findings.length, findings: duplicates.findings },
    underspecified: { count: underspecified.findings.length, findings: underspecified.findings },
    proposals: {
      count: allProposals.length,
      items: allProposals.map((p) => ({
        providerId: p.providerId,
        writeKind: p.writeKind,
        issueKey: p.issueKey,
        summary: p.payload.type === 'link' ? `Link ${p.issueKey} as duplicate of ${p.duplicateCandidateKey}` : `Comment on ${p.issueKey}`,
      })),
    },
    provenance: { count: provenance.length, sources: provenance },
    summary,
  };

  return { analysis, outputPacket, writeProposals: allProposals, summary };
}

// F5 reasoningExecutor: wraps analyzeOpsTriage for embed capability tick; accepts plan for F5 contract compatibility.

export function createOpsTriageReasoningExecutor(config = {}) {
  return async function opsTriageReasoningExecutor(_plan, ctx = {}) {
    const { outputPacket, writeProposals, summary } = analyzeOpsTriage(ctx.sections ?? [], config);
    return { outputPacket, writeProposals, summary };
  };
}

export default createOpsTriageReasoningExecutor;
