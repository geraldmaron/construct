/**
 * lib/intake/tables/creative.mjs — Creative production intake classification.
 *
 * Loop: brief → research → draft → review → publish → measure. Covers content
 * creation, campaigns, design work. Roles are creative-org roles, not engineering.
 */

export const INTAKE_TYPES = ['brief', 'content-request', 'asset', 'experiment', 'report', 'legal-compliance', 'ops', 'unknown'];
export const STAGES = ['brief', 'research', 'draft', 'review', 'publish', 'measure'];

export const UNKNOWN_TRIAGE = {
  intakeType: 'unknown',
  rdStage: 'unknown',
  primaryOwner: 'operations',
  recommendedChain: ['operations'],
  recommendedAction: 'summarize',
  risk: 'low',
  requiresApproval: false,
};

export const CLASSIFICATION_TABLE = [
  {
    intakeType: 'legal-compliance',
    keywords: ['gdpr', 'ccpa', 'privacy', 'consent', 'unsubscribe', 'can-spam', 'cookie banner', 'disclosure', 'trademark'],
    rdStage: 'review',
    primaryOwner: 'legal-compliance',
    recommendedChain: ['legal-compliance', 'reviewer'],
    recommendedAction: 'clarify',
    risk: 'high',
    requiresApproval: true,
  },
  {
    intakeType: 'brief',
    keywords: ['brief', 'campaign', 'launch plan', 'go-to-market', 'gtm', 'positioning', 'narrative', 'audience'],
    rdStage: 'brief',
    primaryOwner: 'product-manager',
    recommendedChain: ['product-manager', 'researcher', 'docs-keeper'],
    recommendedAction: 'draft-prd',
    risk: 'medium',
    requiresApproval: false,
  },
  {
    intakeType: 'content-request',
    keywords: ['blog', 'article', 'landing page', 'social post', 'newsletter', 'email copy', 'video script', 'headline', 'post', 'content'],
    rdStage: 'draft',
    primaryOwner: 'docs-keeper',
    recommendedChain: ['docs-keeper', 'reviewer'],
    recommendedAction: 'draft-rfc',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'asset',
    keywords: ['asset', 'logo', 'image', 'banner', 'mockup', 'figma', 'brand guide', 'illustration'],
    rdStage: 'draft',
    primaryOwner: 'designer',
    recommendedChain: ['designer', 'reviewer'],
    recommendedAction: 'draft-rfc',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'experiment',
    keywords: ['a/b test', 'experiment', 'hypothesis', 'multivariate', 'pilot', 'audience test'],
    rdStage: 'measure',
    primaryOwner: 'data-analyst',
    recommendedChain: ['data-analyst', 'researcher'],
    recommendedAction: 'create-experiment',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'report',
    keywords: ['report', 'dashboard', 'attribution', 'ctr', 'cpa', 'roas', 'conversion', 'funnel', 'engagement'],
    rdStage: 'measure',
    primaryOwner: 'data-analyst',
    recommendedChain: ['data-analyst', 'product-manager'],
    recommendedAction: 'evaluate',
    risk: 'low',
    requiresApproval: false,
  },
  {
    intakeType: 'ops',
    keywords: ['process', 'workflow', 'template', 'sla', 'calendar', 'planning', 'editorial calendar'],
    rdStage: 'review',
    primaryOwner: 'operations',
    recommendedChain: ['operations', 'product-manager'],
    recommendedAction: 'create-runbook',
    risk: 'low',
    requiresApproval: false,
  },
];

export default { INTAKE_TYPES, STAGES, CLASSIFICATION_TABLE, UNKNOWN_TRIAGE };
