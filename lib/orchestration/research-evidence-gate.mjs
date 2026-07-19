/**
 * lib/orchestration/research-evidence-gate.mjs — deterministic evidence gate for
 * research task output.
 *
 * The researcher persona forbids fabrication and mandates honest
 * insufficient-evidence, but that is honor-system enforcement (a persona prompt)
 * — a weak model, including any free-tier host model, ignores it and ships a
 * confident answer with no sources (construct-6yo6o: a Free-Models-Router session
 * fabricated a whole "research" answer, zero citations, every web fetch failed).
 *
 * The deterministic backstop applies wherever a research task's output is
 * finalized (provider AND host backends), independent of model tier — validating
 * the OUTPUT, never the choice of model, so the user's free-model choice is
 * honored (no paid escalation). Complements findUnverifiedCitations (which flags
 * a cited URL absent from governed webEvidence) by catching the opposite gap: an
 * answer that cites NOTHING of the evidence kind its own research mode requires.
 *
 * A substantial research answer that carries no citation of its expected kind is
 * unverifiable and is flagged degraded rather than presented as done. It stays a
 * signal, not a hard failure: the task still completes (the output exists), but a
 * surface can see it was never grounded. An honestly short or self-declared
 * insufficient-evidence answer is never penalized — that is the behavior the
 * persona asks for.
 */

const RESEARCH_ROLES = new Set(['researcher', 'researcher']);

// Shorter answers are too brief to be a load-bearing research claim — an honest
// "insufficient evidence" reply falls here and must pass untouched.
const SUBSTANTIVE_MIN_CHARS = 500;

const CODEBASE_HINTS = /\b(codebase|repo|repository|source code|source file|implementation|the code|this file|which function|call site|grep|trace (the|through)|execution path)\b/i;
const UX_HINTS = /\b(user research|ux research|usability|interview|transcript|user journey|friction points?|jobs.to.be.done|personas?)\b/i;

// An answer that declares its own limits is honest degradation, not fabrication,
// and passes at any length.
const SELF_DEGRADED = /insufficient evidence|could not (reach|verify|access|retrieve|confirm)|no (live )?web access|unable to (verify|reach|retrieve)|\[unverified\]|no verifiable sources?|without (live |web )?access/i;

const URL_RE = /\bhttps?:\/\/[^\s)\]<>"']+/g;
const DOI_ARXIV_RE = /\b(?:doi:\s*10\.\d{4,}|arxiv:\s*\d{4}\.\d{4,})/gi;
const FILELINE_RE = /\b[\w./-]+\.[a-z0-9]{1,6}:\d+\b/gi;
const TRANSCRIPT_RE = /\b(?:transcript|recording|interview|participant|session)\b[^.\n]{0,60}(?:\d{4}-\d{2}|#\d+|P\d+|\.(?:txt|md|vtt|srt|json))/gi;

function countMatches(text, re) {
  const m = String(text).match(re);
  return m ? m.length : 0;
}

/**
 * Infer which evidence kind a research request expects. Codebase questions cite
 * file:line, user/UX questions cite transcripts, everything else cites external
 * verifiable sources (URLs / DOIs / arXiv ids).
 */
export function inferEvidenceKind(request = '') {
  const text = String(request || '');
  if (CODEBASE_HINTS.test(text)) return 'codebase';
  if (UX_HINTS.test(text)) return 'ux';
  return 'external';
}

function countEvidenceForKind(output, kind) {
  if (kind === 'codebase') return countMatches(output, FILELINE_RE);
  if (kind === 'ux') return countMatches(output, TRANSCRIPT_RE);
  return countMatches(output, URL_RE) + countMatches(output, DOI_ARXIV_RE);
}

const KIND_REMEDIATION = {
  external: 'cite at least one verifiable primary source (a fetched URL, DOI, or arXiv id)',
  codebase: 'cite at least one file:line reference from a read you performed',
  ux: 'cite at least one transcript, recording, or participant reference',
};

/**
 * Gate a research task's output on evidence presence.
 *
 * @param {{output?: string, role?: string, request?: string}} params
 * @returns {{applicable: boolean, ok: boolean, kind: string|null, citationCount: number, reason: string|null}}
 */
export function gateResearchEvidence({ output = '', role = '', request = '' } = {}) {
  const normalizedRole = String(role || '').replace(/^cx-/, '');
  if (!RESEARCH_ROLES.has(normalizedRole) && !RESEARCH_ROLES.has(String(role || ''))) {
    return { applicable: false, ok: true, kind: null, citationCount: 0, reason: null };
  }

  const text = String(output || '');
  const kind = inferEvidenceKind(request);

  if (text.trim().length < SUBSTANTIVE_MIN_CHARS || SELF_DEGRADED.test(text)) {
    return { applicable: true, ok: true, kind, citationCount: countEvidenceForKind(text, kind), reason: null };
  }

  const citationCount = countEvidenceForKind(text, kind);
  if (citationCount > 0) {
    return { applicable: true, ok: true, kind, citationCount, reason: null };
  }

  return {
    applicable: true,
    ok: false,
    kind,
    citationCount: 0,
    reason: `${kind}-research output carries no verifiable citation — ${KIND_REMEDIATION[kind]}, or return insufficient-evidence instead of an unsourced answer`,
  };
}
