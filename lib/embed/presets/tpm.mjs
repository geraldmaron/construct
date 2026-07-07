/**
 * lib/embed/presets/tpm.mjs — deterministic TPM analysis for the `operations`
 * embed preset (see the embed-capability manifest schema decision record).
 *
 * No reasoning engine ships in this repo yet, so this module is a pure,
 * deterministic `reasoningExecutor(plan, ctx)` that the embed capability tick
 * accepts unchanged: it reads the operations specialist's bound provider
 * snapshot slice (Jira + Confluence + Slack sections, already binding-scoped
 * and filter-narrowed by the caller) and composes the ops dependency-
 * sequencing framework (cx-ops-dependency-sequencing) over it. It emits an
 * output packet that
 * validates against the `operations-tpm-briefing` output contract plus the
 * writeIntents (draft Jira tickets) the caller enqueues for approval.
 *
 * Every load-bearing claim carries provenance — a source id the reader can
 * re-verify (a Confluence page id, a Jira issue key, a Slack message id). A
 * requirement with no covering issue is reported as a finding that cites the
 * requirement id and the empty coverage, never a fabricated issue key.
 * Nothing here writes to a provider: proposals are data, the approval queue is
 * the only path out.
 *
 * Analysis moves (mapped to the five ops-framework steps):
 *   1. Parse PRD docs (Confluence) into requirement items.
 *   2. Map Jira epics/issues to requirements → coverage matrix.
 *   3. Uncovered requirement → missing-work finding + a proposed draft issue.
 *   4. Due-date / dependency-chain analysis → timeline-risk findings w/ evidence.
 *   5. Slack signals cross-referenced for contradiction / blocker mentions.
 */

const JIRA_PROVIDER = 'atlassian-jira';
const CONFLUENCE_PROVIDER = 'atlassian-confluence';
const SLACK_PROVIDER = 'slack';

const JIRA_WRITE_KIND = 'createIssue';

// A requirement line in a PRD body: an id token (REQ-12, R-3, FR-4…) followed
// by a colon or dash and the requirement text. Matching is deterministic so a
// seeded fixture produces the same requirement ids on every run.
const REQUIREMENT_LINE_RE = /^\s*(?:[-*]\s*)?((?:REQ|FR|NFR|R)-\d+)\s*[:.\-–)]\s*(.+?)\s*$/i;

// Slack signal keywords that flag a blocker or a contradiction against the
// plan. Presence alone is not a claim — the finding always cites the message id.
const BLOCKER_TERMS = ['blocked', 'blocker', 'stuck', 'cannot proceed', 'waiting on', 'slipping', 'at risk', 'wont make', "won't make", 'behind schedule'];
const CONTRADICTION_TERMS = ['descoped', 'de-scoped', 'cut from', 'dropped', 'no longer', 'reversed', 'changed our mind', 'not doing'];

function sectionItems(sections, providerId) {
  const section = (sections || []).find((s) => s.provider === providerId);
  return Array.isArray(section?.items) ? section.items : [];
}

function docText(doc) {
  return String(doc?.body ?? doc?.text ?? doc?.content ?? '');
}

function docId(doc) {
  return doc?.id ?? doc?.pageId ?? doc?.key ?? 'unknown';
}

/**
 * Parse every PRD doc's body into requirement items. Each item keeps a
 * re-verifiable provenance pair (the page id + the requirement id) so a
 * downstream finding never has to invent where a requirement came from.
 */
export function parseRequirements(docs) {
  const requirements = [];
  for (const doc of docs || []) {
    const sourceDocId = docId(doc);
    const sourceTitle = doc?.title ?? '[untitled]';
    for (const line of docText(doc).split(/\r?\n/)) {
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

function issueKey(issue) {
  return issue?.key ?? issue?.id ?? 'unknown';
}

// An issue covers a requirement when it names the requirement id in its
// summary, description, or an explicit `requirements` field. Substring match on
// a word-bounded id keeps coverage deterministic and auditable.
function issueMentionsRequirement(issue, reqId) {
  const declared = Array.isArray(issue?.requirements) ? issue.requirements.map((r) => String(r).toUpperCase()) : [];
  if (declared.includes(reqId)) return true;
  const haystack = `${issue?.summary ?? ''} ${issue?.description ?? ''}`.toUpperCase();
  const bounded = new RegExp(`(^|[^A-Z0-9])${reqId.replace(/[-]/g, '\\-')}([^A-Z0-9]|$)`);
  return bounded.test(haystack);
}

/**
 * Map Jira issues to requirements. Returns a coverage matrix: one row per
 * requirement listing the covering issue keys (possibly empty). Every row
 * carries the requirement's provenance so the briefing can cite it whether the
 * requirement is covered or not.
 */
export function buildCoverageMatrix(requirements, issues) {
  return requirements.map((req) => {
    const covering = (issues || [])
      .filter((issue) => issueMentionsRequirement(issue, req.reqId))
      .map((issue) => issueKey(issue));
    return {
      reqId: req.reqId,
      text: req.text,
      provenance: req.provenance,
      coveredBy: covering,
      covered: covering.length > 0,
    };
  });
}

function draftTicketProposal(row, req) {
  return {
    providerId: JIRA_PROVIDER,
    writeKind: JIRA_WRITE_KIND,
    reqId: row.reqId,
    payload: {
      type: 'issue',
      issuetype: 'Task',
      summary: `Cover ${row.reqId}: ${req?.text ?? row.text}`,
      description: `Auto-drafted by the operations TPM preset because ${row.reqId} (source ${row.provenance}) has no covering Jira issue. Requirement text: ${req?.text ?? row.text}. Verify and edit before approving; nothing is created without approval.`,
      requirements: [row.reqId],
    },
  };
}

/**
 * Uncovered requirement → one missing-work finding + one proposed draft issue.
 * The finding cites the requirement id and the empty coverage; the proposal is
 * data only — the caller runs it through AuthorityGuard and the approval queue.
 */
export function findMissingWork(coverageMatrix, requirements) {
  const findings = [];
  const proposals = [];
  const byId = new Map((requirements || []).map((r) => [r.reqId, r]));
  for (const row of coverageMatrix) {
    if (row.covered) continue;
    const req = byId.get(row.reqId);
    findings.push({
      reqId: row.reqId,
      text: row.text,
      evidence: { requirement: row.provenance, coverage: 'none' },
      statement: `${row.reqId} ("${row.text}") has no covering Jira issue (source ${row.provenance}).`,
    });
    proposals.push(draftTicketProposal(row, req));
  }
  return { findings, proposals };
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function issueDeps(issue) {
  const raw = issue?.blockedBy ?? issue?.dependsOn ?? issue?.blocks ?? [];
  return Array.isArray(raw) ? raw.map((d) => String(d)) : [];
}

/**
 * Due-date / dependency-chain analysis. Walks each issue's blocking chain and
 * registers a timeline-risk finding when a blocker is due no earlier than the
 * dependent it gates (the dependent cannot finish on time), or when an issue is
 * explicitly flagged blocked. Every finding cites its evidence — the issue
 * keys, the due dates, and the chain — so no risk claim is unverifiable.
 *
 * `now` is injectable so a fixture is deterministic; it defaults to the current
 * time only when a caller omits it.
 */
export function findTimelineRisks(issues, { now = Date.now() } = {}) {
  const byKey = new Map((issues || []).map((i) => [issueKey(i), i]));
  const findings = [];

  for (const issue of issues || []) {
    const key = issueKey(issue);
    const due = parseDate(issue?.dueDate);
    const status = String(issue?.status ?? '').toLowerCase();

    if (status.includes('blocked')) {
      findings.push({
        issueKey: key,
        kind: 'blocked-status',
        evidence: { issue: key, status: issue?.status ?? 'unknown' },
        statement: `${key} is marked '${issue?.status ?? 'unknown'}' — flagged as an active blocker (source ${key}).`,
      });
    }

    for (const depKey of issueDeps(issue)) {
      const blocker = byKey.get(depKey);
      if (!blocker) {
        findings.push({
          issueKey: key,
          kind: 'unknown-blocker',
          evidence: { issue: key, dependsOn: depKey, blockerDueDate: '[unverified]' },
          statement: `${key} depends on ${depKey}, which is not in the bound snapshot — its schedule is [unverified] (source ${key}).`,
        });
        continue;
      }
      const blockerDue = parseDate(blocker?.dueDate);
      if (due != null && blockerDue != null && blockerDue >= due) {
        findings.push({
          issueKey: key,
          kind: 'slipping-chain',
          evidence: {
            issue: key,
            issueDueDate: issue.dueDate,
            blocker: depKey,
            blockerDueDate: blocker.dueDate,
          },
          statement: `${key} (due ${issue.dueDate}) is blocked by ${depKey} (due ${blocker.dueDate}); the blocker is due no earlier than the dependent, so ${key} cannot finish on time (sources ${key}, ${depKey}).`,
        });
      }
    }
  }
  return findings;
}

function messageId(msg) {
  return msg?.id ?? msg?.ts ?? msg?.permalink ?? 'unknown';
}

function matchTerms(text, terms) {
  const lower = String(text ?? '').toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

/**
 * Cross-reference Slack signals for blocker or contradiction mentions. Each
 * finding is a citation, not an interpretation: it names the message id, the
 * channel, and the exact terms that matched, and — when a requirement id or
 * issue key appears in the message — links the signal to that artifact.
 */
export function findSlackSignals(messages, { requirements = [], issues = [] } = {}) {
  const reqIds = requirements.map((r) => r.reqId);
  const issueKeys = (issues || []).map((i) => issueKey(i));
  const findings = [];

  for (const msg of messages || []) {
    const text = String(msg?.text ?? '');
    const blockers = matchTerms(text, BLOCKER_TERMS);
    const contradictions = matchTerms(text, CONTRADICTION_TERMS);
    if (blockers.length === 0 && contradictions.length === 0) continue;

    const upper = text.toUpperCase();
    const refReqs = reqIds.filter((id) => upper.includes(id));
    const refIssues = issueKeys.filter((k) => k !== 'unknown' && upper.includes(String(k).toUpperCase()));

    findings.push({
      messageId: messageId(msg),
      channel: msg?.channel ?? 'unknown',
      kind: contradictions.length > 0 ? 'contradiction' : 'blocker',
      terms: [...blockers, ...contradictions],
      references: { requirements: refReqs, issues: refIssues },
      evidence: { message: messageId(msg), channel: msg?.channel ?? 'unknown' },
      statement: `Slack message ${messageId(msg)} in ${msg?.channel ?? 'unknown'} mentions ${[...blockers, ...contradictions].map((t) => `'${t}'`).join(', ')}${refReqs.length || refIssues.length ? ` referencing ${[...refReqs, ...refIssues].join(', ')}` : ''} (source ${messageId(msg)}).`,
    });
  }
  return findings;
}

function renderList(items, render) {
  if (!items.length) return ['- _(none)_'];
  return items.map(render);
}

/**
 * Render the TPM briefing as markdown. Every load-bearing line ends with a
 * parenthetical source id; a "Provenance index" section enumerates every source
 * the briefing draws on so the reader can re-verify each claim.
 */
export function renderBriefing(analysis) {
  const { coverageMatrix, missingWork, timelineRisks, slackSignals, provenance, generatedAt } = analysis;

  const lines = [];
  lines.push('# TPM Briefing');
  lines.push('');
  lines.push(`Generated ${generatedAt} by the operations specialist (embed preset: operations).`);
  lines.push('Every load-bearing claim below cites a re-verifiable source id. Proposals are held for approval and never auto-created.');
  lines.push('');

  lines.push('## Requirement coverage');
  lines.push('');
  lines.push(...renderList(coverageMatrix, (row) => `- ${row.reqId}: ${row.covered ? `covered by ${row.coveredBy.join(', ')}` : 'NOT COVERED'} (source ${row.provenance})`));
  lines.push('');

  lines.push('## Missing work (uncovered requirements)');
  lines.push('');
  lines.push(...renderList(missingWork.findings, (f) => `- ${f.statement}`));
  lines.push('');

  lines.push('## Timeline risk');
  lines.push('');
  lines.push(...renderList(timelineRisks, (f) => `- [${f.kind}] ${f.statement}`));
  lines.push('');

  lines.push('## Misalignment signals (Slack)');
  lines.push('');
  lines.push(...renderList(slackSignals, (f) => `- [${f.kind}] ${f.statement}`));
  lines.push('');

  lines.push('## Proposed tickets (awaiting approval)');
  lines.push('');
  lines.push(...renderList(missingWork.proposals, (p) => `- ${p.providerId}.${p.writeKind} — ${p.payload.summary} (for ${p.reqId})`));
  lines.push('');

  lines.push('## Provenance index');
  lines.push('');
  lines.push(...renderList(provenance, (src) => `- ${src}`));
  lines.push('');

  return lines.join('\n');
}

function collectProvenance(requirements, issues, messages) {
  const sources = new Set();
  for (const r of requirements) sources.add(r.provenance);
  for (const i of issues) sources.add(issueKey(i));
  for (const m of messages) sources.add(messageId(m));
  return [...sources];
}

/**
 * Run the deterministic TPM analysis over a bound snapshot slice. Pure — no
 * provider calls, no queue writes. Returns the structured analysis, the output
 * packet (contract shape), the write proposals, and the rendered briefing.
 *
 * @param {Array<{provider:string, items:object[]}>} sections
 * @param {{ now?: number, generatedAt?: string }} [opts]
 */
export function analyzeTpm(sections, { now = Date.now(), generatedAt } = {}) {
  const docs = sectionItems(sections, CONFLUENCE_PROVIDER);
  const issues = sectionItems(sections, JIRA_PROVIDER);
  const messages = sectionItems(sections, SLACK_PROVIDER);

  const requirements = parseRequirements(docs);
  const coverageMatrix = buildCoverageMatrix(requirements, issues);
  const missingWork = findMissingWork(coverageMatrix, requirements);
  const timelineRisks = findTimelineRisks(issues, { now });
  const slackSignals = findSlackSignals(messages, { requirements, issues });
  const provenance = collectProvenance(requirements, issues, messages);

  const analysis = {
    generatedAt: generatedAt ?? new Date(now).toISOString(),
    requirements,
    coverageMatrix,
    missingWork,
    timelineRisks,
    slackSignals,
    provenance,
  };

  const briefing = renderBriefing(analysis);

  // Each contract field is a section wrapper ({ count, findings/rows/sources })
  // rather than a bare array so a legitimately empty section still counts as
  // present under the output contract — an absent section signals a broken
  // producer, an empty one signals "checked, nothing found".
  const outputPacket = {
    coverageMatrix: { count: coverageMatrix.length, rows: coverageMatrix },
    missingWork: { count: missingWork.findings.length, findings: missingWork.findings },
    timelineRisks: { count: timelineRisks.length, findings: timelineRisks },
    misalignment: { count: slackSignals.length, findings: slackSignals },
    proposals: {
      count: missingWork.proposals.length,
      items: missingWork.proposals.map((p) => ({ providerId: p.providerId, writeKind: p.writeKind, reqId: p.reqId, summary: p.payload.summary })),
    },
    provenance: { count: provenance.length, sources: provenance },
    briefing,
  };

  return { analysis, outputPacket, writeProposals: missingWork.proposals, briefing };
}

/**
 * The F5 reasoningExecutor. `runCapabilityTick` calls this with
 * `(plan, { manifest, sections, sliceErrors, specialistId })` and consumes the
 * returned `{ outputPacket, writeProposals }`. The plan is not needed for the
 * deterministic composition — the ops framework is already encoded in the
 * analysis moves — but it is accepted to match the F5 contract exactly.
 *
 * @param {{ now?: number, generatedAt?: string }} [config] injected for deterministic tests
 * @returns {(plan: object, ctx: object) => Promise<{outputPacket: object, writeProposals: object[], briefing: string}>}
 */
export function createTpmReasoningExecutor(config = {}) {
  return async function tpmReasoningExecutor(_plan, ctx = {}) {
    const { outputPacket, writeProposals, briefing } = analyzeTpm(ctx.sections ?? [], config);
    return { outputPacket, writeProposals, briefing };
  };
}

export default createTpmReasoningExecutor;
