/**
 * lib/embed/presets/pm-feedback.mjs — deterministic PM feedback→requirements
 * analysis for the `product-manager` embed preset (see the embed-capability
 * manifest schema decision record).
 *
 * Pure deterministic `reasoningExecutor(plan, ctx)` that the embed capability
 * tick accepts: reads the product-manager specialist's bound provider
 * snapshot slice (feedback + Confluence sections, already binding-scoped and
 * filter-narrowed by the caller) and walks the F7 PM value-tradeoff framework
 * (cx-pm-value-tradeoff) over it. It emits an output packet that validates
 * against the `pm-requirements-candidates` output contract. There is no
 * writeIntent output — this preset is artifact-only: it produces requirement
 * candidates for a human PM to act on, never a provider write.
 *
 * Trust boundary (B14 / N1): feedback-item text originates from an external,
 * unauthenticated source and is stamped EXTERNAL_UNAUTHENTICATED. Every
 * feedback string that reaches the output packet is confined to a `quote`
 * field as quoted evidence: clustering, scoring, and cross-referencing all
 * branch on structural fields (tags, theme keywords, requirement id substring
 * matches), so the feedback text itself can only be displayed, not executed
 * or used as a control-flow directive.
 *
 * Every load-bearing claim carries provenance: a source id (feedback file+row,
 * Confluence page id) the reader can re-verify. A candidate with no covering
 * PRD requirement is reported as `new` (net-new), never linked to a
 * fabricated requirement id.
 *
 * Analysis moves (mapped to the F7 framework steps):
 *   1. user-value: cluster feedback-items by theme (tag or keyword match),
 *      name the recurring job each cluster represents.
 *   2. tradeoffs: score each cluster with the user-value rubric (frequency +
 *      author diversity + explicit pain signal).
 *   3. prioritization: cross-reference each cluster against PRD requirement
 *      items (Confluence) — supports / contradicts / new.
 *   4. acceptance-criteria: emit one requirements-candidate per cluster,
 *      provenance-linked to every contributing feedback row and (when
 *      matched) the PRD requirement id.
 */

const FEEDBACK_PROVIDER = 'feedback';
const CONFLUENCE_PROVIDER = 'atlassian-confluence';

// A requirement line in a PRD body: an id token (REQ-12, R-3, FR-4…) followed
// by a colon or dash and the requirement text. Matching is deterministic so a
// seeded fixture produces the same requirement ids on every run.
const REQUIREMENT_LINE_RE = /^\s*(?:[-*]\s*)?((?:REQ|FR|NFR|R)-\d+)\s*[:.\-–)]\s*(.+?)\s*$/i;

// Explicit pain-signal terms that raise a cluster's user-value score when
// present in feedback text. This is a fixed vocabulary lookup, not an
// instruction follow — feedback text can only ever match or not match these
// literal terms, never redirect the analysis.
const PAIN_TERMS = ['broken', 'frustrating', 'confusing', 'cannot', "can't", 'blocked', 'unusable', 'slow', 'crashes', 'lost'];

// Minimum shared-word ratio (Jaccard on words) for two feedback items to be
// placed in the same theme cluster when no explicit tag is present.
const THEME_SIMILARITY_THRESHOLD = 0.25;

function sectionItems(sections, providerId) {
  const section = (sections || []).find((s) => s.provider === providerId);
  return Array.isArray(section?.items) ? section.items : [];
}

function feedbackId(item) {
  return item?.id ?? 'unknown';
}

function feedbackProvenance(item) {
  const file = item?.provenance?.file ?? 'unknown';
  const row = item?.provenance?.row;
  return row != null ? `${file}#${row}` : file;
}

function normalizeWords(text) {
  return String(text ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
}

function wordSimilarity(text1, text2) {
  const words1 = new Set(normalizeWords(text1));
  const words2 = new Set(normalizeWords(text2));
  const union = new Set([...words1, ...words2]);
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Every trust check is a structural read of the `_trust` stamp — never a
// parse of the feedback text itself — so an untrusted item can only ever be
// labeled, never able to change which branch this function takes.

function trustLabel(item) {
  return item?._trust?.level ?? 'unknown';
}

/**
 * Cluster feedback-items by theme. An explicit shared tag wins; absent a
 * shared tag, items land in the same cluster when their text passes the
 * word-similarity threshold against the cluster's seed item. Deterministic:
 * clusters are built in input order, so a seeded fixture always produces the
 * same cluster membership.
 */
export function clusterByTheme(feedbackItems) {
  const clusters = [];

  for (const item of feedbackItems) {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    let target = null;

    if (tags.length > 0) {
      target = clusters.find((c) => c.tag && tags.includes(c.tag));
    }
    if (!target) {
      target = clusters.find((c) => !c.tag && wordSimilarity(item?.text, c.seedText) >= THEME_SIMILARITY_THRESHOLD);
    }

    if (target) {
      target.items.push(item);
    } else {
      clusters.push({
        theme: tags[0] ?? feedbackId(item),
        tag: tags[0] ?? null,
        seedText: item?.text ?? '',
        items: [item],
      });
    }
  }

  return clusters.map((c) => ({ theme: c.theme, items: c.items }));
}

/**
 * Score a theme cluster with the user-value rubric: frequency (item count),
 * author diversity (distinct authors), and explicit pain signal (count of
 * PAIN_TERMS matches across the cluster's feedback text). Score is a plain
 * sum of these three signals — deterministic, no external weighting table.
 * Every contributing pain-term match is itself evidence, not instruction: it
 * is recorded as a literal string match, never executed.
 */
export function scoreCluster(cluster) {
  const items = cluster.items || [];
  const frequency = items.length;
  const authors = new Set(items.map((i) => i?.author).filter(Boolean));
  const authorDiversity = authors.size;

  let painSignal = 0;
  const painMatches = [];
  for (const item of items) {
    const lower = String(item?.text ?? '').toLowerCase();
    const matched = PAIN_TERMS.filter((term) => lower.includes(term));
    if (matched.length > 0) {
      painSignal += matched.length;
      painMatches.push({ id: feedbackId(item), terms: matched });
    }
  }

  return {
    frequency,
    authorDiversity,
    painSignal,
    userValueScore: frequency + authorDiversity + painSignal,
    painMatches,
  };
}

/**
 * Parse every PRD doc's body into requirement items, mirroring the P3 TPM
 * preset's parser so requirement ids are stable across presets.
 */
export function parseRequirements(docs) {
  const requirements = [];
  for (const doc of docs || []) {
    const sourceDocId = doc?.id ?? doc?.pageId ?? doc?.key ?? 'unknown';
    const sourceTitle = doc?.title ?? '[untitled]';
    const body = String(doc?.body ?? doc?.text ?? doc?.content ?? '');
    for (const line of body.split(/\r?\n/)) {
      const match = REQUIREMENT_LINE_RE.exec(line);
      if (!match) continue;
      const reqId = match[1].toUpperCase();
      requirements.push({
        reqId,
        text: match[2].trim(),
        sourceDocId,
        sourceTitle,
        provenance: `${sourceDocId}#${reqId}`,
      });
    }
  }
  return requirements;
}

// A cluster's theme text is checked against a requirement's text for shared
// words above the threshold; a cluster whose feedback explicitly mentions a
// requirement id string is a stronger, direct match.

function clusterMentionsRequirement(cluster, req) {
  const reqIdUpper = req.reqId.toUpperCase();
  const directMention = (cluster.items || []).some((item) => String(item?.text ?? '').toUpperCase().includes(reqIdUpper));
  if (directMention) return { matched: true, kind: 'direct' };

  const clusterText = (cluster.items || []).map((i) => i?.text ?? '').join(' ');
  const similarity = wordSimilarity(clusterText, req.text);
  if (similarity >= THEME_SIMILARITY_THRESHOLD) return { matched: true, kind: 'thematic', similarity };

  return { matched: false };
}

/**
 * Cross-reference each theme cluster against the parsed PRD requirements.
 * Returns one row per cluster: `supports` when the cluster's feedback
 * reinforces an existing requirement, `contradicts` when pain signal is high
 * against a requirement already marked covered-in-PRD text as resolved (this
 * preset does not have Jira coverage data, so contradiction detection is
 * conservative — thematic match plus a high pain signal), otherwise `new`
 * (net-new, no matching requirement in the bound PRD set).
 */
export function crossReferenceRequirements(clusters, requirements) {
  return clusters.map((cluster) => {
    let best = null;
    for (const req of requirements) {
      const match = clusterMentionsRequirement(cluster, req);
      if (match.matched) {
        if (!best || match.kind === 'direct') best = { req, match };
        if (best.match.kind === 'direct') break;
      }
    }

    if (!best) {
      return { theme: cluster.theme, relation: 'new', requirement: null, matchKind: null };
    }
    return {
      theme: cluster.theme,
      relation: 'supports',
      requirement: { reqId: best.req.reqId, text: best.req.text, provenance: best.req.provenance },
      matchKind: best.match.kind,
    };
  });
}

/**
 * Build one requirements-candidate per theme cluster. Every candidate
 * carries provenance to every feedback row it draws on and, when matched, to
 * the PRD requirement it relates to. Feedback text is carried only inside a
 * `quote` field on each evidence row — quoted evidence, never instruction —
 * and every quoted item's trust label is recorded alongside it so a
 * downstream reader can see it came from an EXTERNAL_UNAUTHENTICATED source.
 */
export function buildCandidates(clusters, scores, crossRefs) {
  return clusters.map((cluster, i) => {
    const score = scores[i];
    const crossRef = crossRefs[i];

    const evidence = cluster.items.map((item) => ({
      feedbackId: feedbackId(item),
      provenance: feedbackProvenance(item),
      trust: trustLabel(item),
      quote: item?.text ?? '',
    }));

    const relation = crossRef.relation;
    const candidateId = `RC-${String(i + 1).padStart(3, '0')}`;

    return {
      candidateId,
      theme: cluster.theme,
      userValueScore: score.userValueScore,
      scoreBreakdown: {
        frequency: score.frequency,
        authorDiversity: score.authorDiversity,
        painSignal: score.painSignal,
      },
      relation,
      requirement: crossRef.requirement,
      evidence,
      statement: relation === 'new'
        ? `Theme '${cluster.theme}' (${cluster.items.length} feedback item(s), user-value score ${score.userValueScore}) has no matching PRD requirement — net-new candidate (sources ${evidence.map((e) => e.provenance).join(', ')}).`
        : `Theme '${cluster.theme}' (${cluster.items.length} feedback item(s), user-value score ${score.userValueScore}) ${relation} ${crossRef.requirement.reqId} (source ${crossRef.requirement.provenance}); feedback sources ${evidence.map((e) => e.provenance).join(', ')}.`,
    };
  });
}

/**
 * Pure deterministic PM feedback analysis: reads sections, produces the
 * output packet (contract shape) plus the structured analysis. No write
 * proposals — this preset is artifact-only.
 */
export function analyzePmFeedback(sections, { now = Date.now(), generatedAt } = {}) {
  const feedbackItems = sectionItems(sections, FEEDBACK_PROVIDER);
  const docs = sectionItems(sections, CONFLUENCE_PROVIDER);

  const clusters = clusterByTheme(feedbackItems);
  const scores = clusters.map(scoreCluster);
  const requirements = parseRequirements(docs);
  const crossRefs = crossReferenceRequirements(clusters, requirements);
  const candidates = buildCandidates(clusters, scores, crossRefs);

  const provenance = [
    ...feedbackItems.map((item) => feedbackProvenance(item)),
    ...requirements.map((r) => r.provenance),
  ];

  const analysis = {
    generatedAt: generatedAt ?? new Date(now).toISOString(),
    clusters,
    scores,
    requirements,
    crossRefs,
    candidates,
  };

  const summary = [
    `Clustered ${feedbackItems.length} feedback item(s) into ${clusters.length} theme(s).`,
    `Cross-referenced against ${requirements.length} PRD requirement(s).`,
    `Produced ${candidates.length} requirements-candidate(s).`,
  ].join(' ');

  // Each contract field is a section wrapper ({ count, items }) rather than a
  // bare array so a legitimately empty section still counts as present under
  // the output contract — an absent section signals a broken producer, an
  // empty one signals "checked, nothing found".
  const outputPacket = {
    candidates: { count: candidates.length, items: candidates },
    clusters: { count: clusters.length, items: clusters.map((c) => ({ theme: c.theme, itemCount: c.items.length })) },
    requirements: { count: requirements.length, items: requirements },
    provenance: { count: provenance.length, sources: provenance },
    summary,
  };

  return { analysis, outputPacket, writeProposals: [], summary };
}

/**
 * F5 reasoningExecutor: wraps analyzePmFeedback for the embed capability
 * tick; accepts plan for F5 contract compatibility. Always returns an empty
 * writeProposals array — this preset never proposes a provider write.
 */
export function createPmFeedbackReasoningExecutor(config = {}) {
  return async function pmFeedbackReasoningExecutor(_plan, ctx = {}) {
    const { outputPacket, summary } = analyzePmFeedback(ctx.sections ?? [], config);
    return { outputPacket, writeProposals: [], summary };
  };
}

export default createPmFeedbackReasoningExecutor;
