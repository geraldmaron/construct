/**
 * lib/orchestration/output-quality-gate.mjs — second validation layer on
 * finalized Worker Profile task output.
 *
 * Complements research-evidence-gate.mjs (citation presence for researcher) with
 * cross-profile presentation and fabrication checks:
 *   1. Em dash (U+2014) ban in human-facing task output
 *   2. Invented URL ban when the request forbids fabrication or when no
 *      governed webEvidence backs the cited URLs
 *
 * Honor-system prompts ask for these behaviors; this gate records durable
 * qualityGate verdicts so hosts and surfaces can refuse to treat unsound
 * output as verified. Researcher URLs without webEvidence hard-fail the task;
 * localhost URLs inside fenced code blocks are exempt.
 */

const EM_DASH = /\u2014/;
const URL_RE = /\bhttps?:\/\/[^\s)\]<>"']+/gi;
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;

const FORBID_INVENT_RE =
  /\b(?:do\s+not|don't|no)\s+(?:invent|fabricate|make\s+up)\b|\bno\s+(?:fake\s+)?(?:urls?|citations?|links?)\b|\bwithout\s+(?:inventing|fabricating)\b/i;

function extractUrls(text = '') {
  return Array.from(String(text).matchAll(URL_RE)).map((m) => m[0].replace(/[.,;:!?)]+$/, ''));
}

export function normalizeCitationUrl(url = '') {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(url).replace(/\/$/, '');
  }
}

function isLocalDevelopmentUrl(url = '') {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function extractFabricationRelevantUrls(text = '') {
  return extractUrls(text.replace(FENCED_CODE_BLOCK_RE, (block) => (
    block.replace(URL_RE, (url) => (isLocalDevelopmentUrl(url) ? '' : url))
  )));
}

export function buildWebEvidenceUrlSet(webEvidence = []) {
  return new Set(
    (webEvidence || [])
      .map((e) => normalizeCitationUrl(e?.url || e?.href || ''))
      .filter(Boolean),
  );
}

export function findUnverifiedOutputUrls(text = '', webEvidence = []) {
  const evidenceUrls = buildWebEvidenceUrlSet(webEvidence);
  return extractFabricationRelevantUrls(text).filter((url) => !evidenceUrls.has(normalizeCitationUrl(url)));
}

/**
 * Gate finalized task output for presentation and fabrication quality.
 *
 * @param {{output?: string, workerProfileId?: string, request?: string, webEvidence?: Array<{url?: string}>}} params
 * @returns {{applicable: boolean, ok: boolean, issues: Array<{code: string, reason: string}>, hardFail: boolean}}
 */
export function gateOutputQuality({
  output = '',
  workerProfileId = '',
  request = '',
  webEvidence = [],
} = {}) {
  const text = String(output || '');
  if (!text.trim()) {
    return { applicable: false, ok: true, issues: [], hardFail: false };
  }

  const issues = [];
  const normalizedRole = String(workerProfileId || '').replace(/^cx-/, '');

  if (EM_DASH.test(text)) {
    issues.push({
      code: 'em-dash',
      reason: 'output contains U+2014 em dash; use a period, colon, or hyphen instead',
    });
  }

  const urls = extractFabricationRelevantUrls(text);
  const forbidInvent = FORBID_INVENT_RE.test(String(request || ''));
  if (urls.length > 0) {
    const unverified = findUnverifiedOutputUrls(text, webEvidence);
    if (forbidInvent && unverified.length > 0) {
      issues.push({
        code: 'fabricated-url',
        reason: `request forbids inventing URLs but output cites ${unverified.length} URL(s) absent from governed webEvidence`,
      });
    } else if (unverified.length > 0 && normalizedRole === 'researcher') {
      issues.push({
        code: 'unverified-url',
        reason: `researcher output cites ${unverified.length} URL(s) without matching governed webEvidence`,
      });
    }
  }

  const hardFail = issues.some((i) => i.code === 'fabricated-url' || i.code === 'unverified-url');
  return {
    applicable: true,
    ok: issues.length === 0,
    issues,
    hardFail,
  };
}
