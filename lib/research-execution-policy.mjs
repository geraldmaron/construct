/**
 * lib/research-execution-policy.mjs — surface-agnostic research routing policy.
 *
 * Research is not tied to one MCP. Hosts can have Context7, plain web search,
 * attached files, or only repo access. This module returns the same evidence
 * ladder to every surface so research remains useful inside a project, outside a
 * project, or in a mixed conversation that turns into artifact drafting.
 */

const LIBRARY_DOC_PATTERNS = [
  /\b(api|sdk|framework|library|package|module|cli|tooling?)\b/i,
  /\bdocs?|documentation|reference|changelog|release notes?|migration guide\b/i,
  /\breact|next\.?js|node\.?js|typescript|python|go|rust|java|spring|django|rails|tailwind|prisma|aws|gcp|azure|kubernetes|terraform\b/i,
];

const SECURITY_PATTERNS = [
  /\bcve\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\badvisory|exploit|cwe|cvss|owasp|supply chain\b/i,
];

const LITERATURE_PATTERNS = [
  /\bpaper|study|benchmark|arxiv|anthology|proceedings|dataset|experiment|literature\b/i,
];

const MARKET_PATTERNS = [
  /\bmarket|pricing|adoption|competition|competitive|vendor|arr|revenue|survey|share\b/i,
];

const REGULATORY_PATTERNS = [
  /\bregulation|regulatory|compliance|standard|policy|law|gdpr|hipaa|soc 2|iso 27001|fedramp\b/i,
];

const REPO_PATTERNS = [
  /\bthis (repo|repository|project|codebase)\b/i,
  /\bin this (repo|repository|project|codebase)\b/i,
  /\bour (repo|repository|project|codebase)\b/i,
  /\bmodule\b|\bfunction\b|\bimplementation\b|\bsource code\b/i,
];

const CONSTRUCT_SELF_PATTERNS = [
  /\bconstruct\b/i,
  /\bthis tool\b/i,
  /\bthis system\b/i,
  /\bthis agent\b/i,
];

export function classifyResearchDomain(request = '') {
  const text = String(request || '');
  if (!text.trim()) return 'general-external';
  if (REPO_PATTERNS.some((pattern) => pattern.test(text))) return 'repo';
  if (CONSTRUCT_SELF_PATTERNS.some((pattern) => pattern.test(text))) return 'construct-self';
  if (SECURITY_PATTERNS.some((pattern) => pattern.test(text))) return 'security';
  if (LITERATURE_PATTERNS.some((pattern) => pattern.test(text))) return 'literature';
  if (MARKET_PATTERNS.some((pattern) => pattern.test(text))) return 'market';
  if (REGULATORY_PATTERNS.some((pattern) => pattern.test(text))) return 'regulatory';
  if (LIBRARY_DOC_PATTERNS.some((pattern) => pattern.test(text))) return 'library-docs';
  return 'general-external';
}

function domainStartingPoints(domain) {
  switch (domain) {
    case 'construct-self':
      return ['Construct knowledge base and shipped docs'];
    case 'repo':
      return ['repo code', 'repo tests', 'repo docs', 'attached or ingested project files'];
    case 'library-docs':
      return ['official versioned docs', 'official changelog', 'official migration guide', 'release notes'];
    case 'security':
      return ['NVD', 'GitHub Security Advisories', 'OWASP', 'vendor advisories'];
    case 'literature':
      return ['papers', 'conference proceedings', 'official benchmark writeups', 'dataset docs'];
    case 'market':
      return ['company announcements', 'SEC filings', 'official pricing/docs', 'named primary-source reporting'];
    case 'regulatory':
      return ['regulation text', 'issuing authority guidance', 'official standard text'];
    default:
      return ['most authoritative primary source for the claim', 'official docs', 'standards', 'source code', 'first-party announcements'];
  }
}

function externalLadder(domain) {
  if (domain === 'construct-self') {
    return [
      {
        step: 'construct-knowledge',
        when: 'The question is about Construct itself.',
        action: 'Use Construct knowledge and shipped docs first.',
        preferredTools: ['knowledge_search'],
      },
    ];
  }

  if (domain === 'repo') {
    return [
      {
        step: 'repo-evidence',
        when: 'The question is about the current project/repo or attached materials.',
        action: 'Read code, tests, configs, prior artifacts, and ingested files before any external search.',
        preferredTools: ['repo file search', 'project docs', 'ingested artifact search'],
      },
      {
        step: 'targeted-external',
        when: 'Local evidence is insufficient and the question depends on an external standard or dependency.',
        action: 'Fetch the exact external primary source that governs the claim.',
        preferredTools: ['context7 when it is a library/API docs question', 'web search + direct fetch of official docs otherwise'],
      },
    ];
  }

  if (domain === 'library-docs') {
    return [
      {
        step: 'context7-preferred',
        when: 'Context7 is available and the topic is a library/framework/API/CLI/cloud-docs question.',
        action: 'Use Context7 for current versioned documentation.',
        preferredTools: ['context7'],
      },
      {
        step: 'official-web-fallback',
        when: 'Context7 is unavailable, incomplete, or the answer needs confirmation.',
        action: 'Search and fetch official docs, changelogs, migration guides, and release notes directly on the web.',
        preferredTools: ['web search', 'direct fetch/open of official docs'],
      },
      {
        step: 'secondary-locator',
        when: 'Official docs are hard to locate.',
        action: 'Use secondary sources only to locate the primary source; do not treat them as final evidence.',
        preferredTools: ['web search'],
      },
    ];
  }

  return [
    {
      step: 'primary-external',
      when: 'The question concerns external facts beyond the current repo.',
      action: 'Go directly to the domain-appropriate primary sources.',
      preferredTools: ['web search', 'direct fetch/open of primary sources'],
    },
    {
      step: 'secondary-locator',
      when: 'Primary sources need discovery help.',
      action: 'Use secondary/tertiary sources only to locate the primary source, then verify against the primary.',
      preferredTools: ['web search'],
    },
  ];
}

export function buildResearchExecutionPolicy({ request = '' } = {}) {
  const domain = classifyResearchDomain(request);
  return {
    mode: 'evidence-first',
    supportsGeneralConversation: true,
    canResearchInsideOrOutsideProject: true,
    domain,
    internalFirst: [
      'user-supplied files and links',
      'current repo code, docs, tests, and configs when relevant',
      'prior project research and ingested knowledge when relevant',
    ],
    startingPoints: domainStartingPoints(domain),
    toolRouting: externalLadder(domain),
    sourceRules: [
      'Prefer primary sources for load-bearing claims.',
      'Use Context7 only for library/framework/API/cloud docs when available.',
      'Fall back to web search plus direct fetch of official docs when Context7 is absent or insufficient.',
      'For non-docs research, use domain-appropriate primary sources rather than a generic docs MCP.',
      'Community/blog/forum content may help locate sources or capture sentiment, but not replace primary evidence for factual claims.',
    ],
    recencyRule: 'Search most-recent-first. For fast-moving topics, treat sources older than 12 months as stale until reconfirmed.',
  };
}
