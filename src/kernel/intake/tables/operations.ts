/**
 * kernel/intake/tables/operations.ts — the operations workspace preset's classification
 * table. Ported verbatim from construct-legacy lib/intake/tables/operations.mjs:
 * keywords, ordering, owners, chains, risk and approval flags are unchanged.
 * Table order is load-bearing — classify.ts breaks score ties by it.
 */

import type { ClassificationTable } from '../table.ts';

const operationsTable: ClassificationTable = {
  id: 'operations',
  INTAKE_TYPES: [
    'request',
    'bug',
    'incident',
    'ops',
    'security',
    'docs',
    'unknown'
  ],
  STAGES: [
    'request',
    'triage',
    'resolve',
    'document',
    'improve'
  ],
  UNKNOWN_TRIAGE: {
    intakeType: 'unknown',
    rdStage: 'unknown',
    primaryOwner: 'operations',
    recommendedChain: [
      'operations'
    ],
    recommendedAction: 'summarize',
    risk: 'low',
    requiresApproval: false
  },
  CLASSIFICATION_TABLE: [
    {
      intakeType: 'security',
      keywords: [
        'security',
        'cve',
        'vulnerability',
        'leak',
        'auth bypass',
        'pii',
        'secret'
      ],
      rdStage: 'resolve',
      primaryOwner: 'security',
      recommendedChain: [
        'security',
        'engineer',
        'reviewer'
      ],
      recommendedAction: 'diagnose',
      risk: 'high',
      requiresApproval: true
    },
    {
      intakeType: 'incident',
      keywords: [
        'incident',
        'outage',
        'down',
        'p0 ',
        'p1 ',
        'oncall',
        'pager',
        '5xx',
        'sla breach'
      ],
      rdStage: 'resolve',
      primaryOwner: 'sre',
      recommendedChain: [
        'sre',
        'engineer'
      ],
      recommendedAction: 'create-runbook',
      risk: 'high',
      requiresApproval: true
    },
    {
      intakeType: 'bug',
      keywords: [
        'bug',
        'broken',
        'error',
        'fails',
        'crash',
        'exception',
        'stack trace'
      ],
      rdStage: 'resolve',
      primaryOwner: 'engineer',
      recommendedChain: [
        'engineer',
        'qa',
        'reviewer'
      ],
      recommendedAction: 'diagnose',
      risk: 'medium',
      requiresApproval: false
    },
    {
      intakeType: 'docs',
      keywords: [
        'docs',
        'documentation',
        'how to',
        'guide',
        'readme',
        'wiki',
        'runbook missing'
      ],
      rdStage: 'document',
      primaryOwner: 'docs-keeper',
      recommendedChain: [
        'docs-keeper',
        'reviewer'
      ],
      recommendedAction: 'create-runbook',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'ops',
      keywords: [
        'cron',
        'scheduled job',
        'maintenance',
        'backup',
        'restore',
        'rotation',
        'capacity',
        'upgrade'
      ],
      rdStage: 'improve',
      primaryOwner: 'sre',
      recommendedChain: [
        'sre',
        'engineer'
      ],
      recommendedAction: 'create-runbook',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'request',
      keywords: [
        'request',
        'access',
        'feature request',
        'integration',
        'new tool',
        'change request',
        'how do i',
        'can someone'
      ],
      rdStage: 'triage',
      primaryOwner: 'operations',
      recommendedChain: [
        'operations',
        'engineer'
      ],
      recommendedAction: 'clarify',
      risk: 'low',
      requiresApproval: false
    }
  ]
};

export default operationsTable;
