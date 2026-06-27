/**
 * tests/visual/lib/role-expectations.mjs — per-role UX and output-depth contracts.
 *
 * Maps user-facing personas (developer, PM, architect, …) to the specialists and
 * skills they should experience in Construct chat. Depth rubrics here are the
 * primary tuning signal when adjusting specialist prompts and skill workflows.
 */

export const VISUAL_LIVE_MODEL = 'anthropic/claude-sonnet-4-6';

export const ROLE_EXPECTATIONS = [
  {
    id: 'developer',
    label: 'Software developer',
    specialistIds: ['cx-engineer', 'cx-debugger', 'cx-platform-engineer'],
    expectedSkills: ['roles/engineer', 'exploration/repo-map'],
    slashCommands: ['/help', '/model', '/layers', '/usage', '/clear'],
    prompts: [
      {
        id: 'dev-pattern-fit',
        text: 'Where does the owned-loop chat driver live, and what file should I read first to add a new provider adapter?',
        followUp: 'Show me the exact import path and one concrete next step I can take in this repo.',
      },
    ],
    surfaceUX: {
      mustShowHelpHint: true,
      slashPaletteWorks: true,
      linksClickable: true,
    },
    depthRubric: {
      minWords: 180,
      minHeadings: 2,
      minProseParagraphs: 2,
      minRepoPaths: 2,
      minNumberedSteps: 2,
      minCodeFences: 1,
      minSkillSignals: 1,
      requiresTradeoffs: false,
      warnShallow: true,
      warnBulletOnly: true,
      mustMatch: [/apps\/chat\/engine|lib\/chat|provider-adapters/i],
    },
    experienceNotes: [
      'Developer expects repo-grounded paths, not generic advice.',
      'Answers should name real files and show where to edit.',
      'Tool/activity visibility during the turn is part of trust.',
    ],
  },
  {
    id: 'product-manager',
    label: 'Product manager',
    specialistIds: ['cx-product-manager', 'cx-ux-researcher'],
    expectedSkills: [
      'docs/prd-workflow',
      'docs/product-intelligence-workflow',
      'docs/backlog-proposal-workflow',
    ],
    slashCommands: ['/loop', '/skills suggest prd', '/export', '/context'],
    prompts: [
      {
        id: 'pm-prd-depth',
        text: 'Draft a lean PRD outline for OIDC login in Construct chat. Who is it for, what problem does it solve, and how will we measure success?',
        followUp: 'Add risks, non-goals, and two acceptance criteria that are testable without subjective judgment.',
      },
    ],
    surfaceUX: {
      mustShowHelpHint: true,
      slashPaletteWorks: true,
      linksClickable: true,
    },
    depthRubric: {
      minWords: 250,
      minHeadings: 4,
      minProseParagraphs: 3,
      minBullets: 4,
      minCitations: 1,
      minSkillSignals: 2,
      requiresMetrics: true,
      requiresRisks: true,
      warnShallow: true,
      warnUnsourced: true,
      mustMatch: [/problem|goal|user|success|metric|acceptance/i],
      mustNotMatch: [/lorem ipsum|as an ai language model/i],
    },
    experienceNotes: [
      'PM expects testable acceptance criteria, not vibes.',
      '/loop should feel like a credible artifact path.',
      'Success metrics need baseline/target or explicit unknown.',
    ],
  },
  {
    id: 'architect',
    label: 'Architect',
    specialistIds: ['cx-architect', 'cx-devil-advocate'],
    expectedSkills: ['docs/adr-workflow', 'roles/architect'],
    slashCommands: ['/team', '/oracle', '/context', '/inspect'],
    prompts: [
      {
        id: 'arch-tradeoffs',
        text: 'Compare terminal-only chat vs a revived web cockpit for Construct. What are the invariants we must not break?',
        followUp: 'Give me an ADR-style recommendation with alternatives considered and a rollback path.',
      },
    ],
    depthRubric: {
      minWords: 280,
      minHeadings: 4,
      minProseParagraphs: 3,
      minRepoPaths: 1,
      requiresTradeoffs: true,
      requiresRisks: true,
      minSkillSignals: 1,
      warnShallow: true,
      mustMatch: [/invariant|boundary|ADR|alternative|decision/i],
    },
    experienceNotes: [
      'Architect expects explicit trade-offs, not a single blessed answer.',
      'References to ADR/RFC patterns and repo boundaries build confidence.',
    ],
  },
  {
    id: 'qa',
    label: 'QA engineer',
    specialistIds: ['cx-qa', 'cx-test-automation', 'cx-reviewer'],
    expectedSkills: ['roles/qa', 'quality-gates/verify-change'],
    slashCommands: ['/inspect', '/usage', '/export'],
    prompts: [
      {
        id: 'qa-test-plan',
        text: 'What should a visual live test suite for Construct chat verify beyond happy-path slash commands?',
        followUp: 'List edge cases, failure modes, and how we know the test itself is not flaky.',
      },
    ],
    depthRubric: {
      minWords: 200,
      minHeadings: 3,
      minProseParagraphs: 2,
      minNumberedSteps: 3,
      requiresTestCases: true,
      requiresRisks: true,
      warnBulletOnly: true,
      mustMatch: [/edge case|regression|verify|assert|flaky/i],
    },
    experienceNotes: [
      'QA expects explicit verification steps and negative cases.',
      'Flakiness and observability of the harness matter.',
    ],
  },
  {
    id: 'security',
    label: 'Security engineer',
    specialistIds: ['cx-security', 'cx-legal-compliance'],
    expectedSkills: ['roles/security', 'compliance/data-privacy'],
    slashCommands: ['/context', '/oracle', '/team'],
    prompts: [
      {
        id: 'sec-oidc-review',
        text: 'Review OIDC authentication for Construct chat from an appsec perspective. What are the top threats and control gaps?',
        followUp: 'Separate what is verified in-repo vs what remains unknown. No fabricated CVEs.',
      },
    ],
    depthRubric: {
      minWords: 220,
      minHeadings: 3,
      minProseParagraphs: 2,
      requiresThreat: true,
      requiresRisks: true,
      minCitations: 1,
      warnUnsourced: true,
      mustNotMatch: [/CVE-\d{4}-\d{4,7}(?!.*\[unverified\])/i],
    },
    experienceNotes: [
      'Security expects threat framing and honest unknowns.',
      'Fabricated ticket IDs or CVEs are blocking failures.',
    ],
  },
  {
    id: 'designer',
    label: 'Designer / UX',
    specialistIds: ['cx-designer', 'cx-ux-researcher', 'cx-accessibility'],
    expectedSkills: ['frontend-design/ux-principles', 'frontend-design/accessibility'],
    slashCommands: ['/layers', '/set', '/help'],
    prompts: [
      {
        id: 'ux-terminal-chat',
        text: 'Critique the Construct terminal chat experience for a new user. What is confusing in the first 60 seconds?',
        followUp: 'Call out keyboard-only and screen-reader risks in slash palette, links, and turn layout.',
      },
    ],
    depthRubric: {
      minWords: 180,
      minHeadings: 3,
      minProseParagraphs: 2,
      requiresA11y: true,
      minBullets: 3,
      mustMatch: [/user|flow|confus|keyboard|read/i],
    },
    experienceNotes: [
      'Designer expects user-journey language, not implementation dumps.',
      'A11y must be substantive, not a single WCAG name-drop.',
    ],
  },
  {
    id: 'sre',
    label: 'SRE / operations',
    specialistIds: ['cx-sre', 'cx-release-manager', 'cx-operations'],
    expectedSkills: ['docs/runbook-workflow', 'roles/operator.sre'],
    slashCommands: ['/usage', '/oracle', '/export'],
    prompts: [
      {
        id: 'sre-release-gates',
        text: 'What release gates should block shipping a change to Construct chat surfaces, and how would on-call detect a regression?',
        followUp: 'Include rollback steps and what telemetry or logs to check first.',
      },
    ],
    depthRubric: {
      minWords: 200,
      minHeadings: 3,
      minNumberedSteps: 3,
      requiresRunbook: true,
      requiresRisks: true,
      mustMatch: [/gate|rollback|monitor|CI|release/i],
    },
    experienceNotes: [
      'SRE expects operational paths, not product essays.',
      'Rollback and detection must be actionable.',
    ],
  },
  {
    id: 'researcher',
    label: 'Researcher',
    specialistIds: ['cx-researcher', 'cx-data-analyst', 'cx-explorer'],
    expectedSkills: ['docs/research-workflow', 'docs/evidence-ingest-workflow'],
    slashCommands: ['/skills suggest research', '/context', '/export'],
    prompts: [
      {
        id: 'research-intake',
        text: 'Summarize what Construct documentation says about intake and triage. Cite specific docs paths.',
        followUp: 'Label confidence on each claim and mark anything you cannot verify in-repo as [unverified].',
      },
    ],
    depthRubric: {
      minWords: 200,
      minHeadings: 2,
      minProseParagraphs: 2,
      minRepoPaths: 2,
      minCitations: 2,
      minSkillSignals: 1,
      warnUnsourced: true,
      mustMatch: [/confidence|source|intake|triage|\[unverified\]/i],
    },
    experienceNotes: [
      'Researcher expects sourced claims or explicit unknowns.',
      'Doc paths should be real and preferably clickable.',
    ],
  },
  {
    id: 'ai-engineer',
    label: 'AI engineer',
    specialistIds: ['cx-ai-engineer', 'cx-evaluator'],
    expectedSkills: ['ai/prompt-and-eval', 'ai/orchestration-workflow'],
    slashCommands: ['/model', '/layers', '/set thinking on'],
    prompts: [
      {
        id: 'ai-eval-harness',
        text: 'How should we evaluate specialist output depth when tuning skills — what metrics belong in a visual harness?',
        followUp: 'Propose a scoring rubric that catches shallow bullet outlines but does not overfit wording.',
      },
    ],
    depthRubric: {
      minWords: 220,
      minHeadings: 3,
      minProseParagraphs: 2,
      requiresMetrics: true,
      requiresTradeoffs: true,
      minSkillSignals: 2,
      mustMatch: [/eval|rubric|depth|specialist|skill/i],
    },
    experienceNotes: [
      'AI engineer expects eval design, not generic ML advice.',
      'Depth metrics should map to specialist/skill tuning loops.',
    ],
  },
];

export function getRoleExpectation(roleId) {
  return ROLE_EXPECTATIONS.find((r) => r.id === roleId) || null;
}

export function listRoleIds() {
  return ROLE_EXPECTATIONS.map((r) => r.id);
}
