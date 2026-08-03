/**
 * kernel/intake/tables/research.ts — the research workspace preset's classification
 * table. Ported verbatim from construct-legacy lib/intake/tables/research.mjs:
 * keywords, ordering, owners, chains, risk and approval flags are unchanged.
 * Table order is load-bearing — classify.ts breaks score ties by it.
 */

import type { ClassificationTable } from '../table.ts';

const researchTable: ClassificationTable = {
  id: 'research',
  INTAKE_TYPES: [
    'question',
    'study',
    'synthesis',
    'report',
    'experiment',
    'ops',
    'unknown'
  ],
  STAGES: [
    'question',
    'gather',
    'analyze',
    'synthesize',
    'recommend'
  ],
  UNKNOWN_TRIAGE: {
    intakeType: 'unknown',
    rdStage: 'unknown',
    primaryOwner: 'researcher',
    recommendedChain: [
      'researcher'
    ],
    recommendedAction: 'summarize',
    risk: 'low',
    requiresApproval: false
  },
  CLASSIFICATION_TABLE: [
    {
      intakeType: 'study',
      keywords: [
        'interview',
        'user study',
        'survey',
        'focus group',
        'usability test',
        'diary study',
        'ethnography'
      ],
      rdStage: 'gather',
      primaryOwner: 'ux-researcher',
      recommendedChain: [
        'ux-researcher',
        'researcher'
      ],
      recommendedAction: 'create-experiment',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'experiment',
      keywords: [
        'hypothesis',
        'experiment',
        'controlled trial',
        'a/b test',
        'pilot',
        'falsifiable'
      ],
      rdStage: 'analyze',
      primaryOwner: 'evaluator',
      recommendedChain: [
        'evaluator',
        'researcher',
        'data-analyst'
      ],
      recommendedAction: 'evaluate',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'report',
      keywords: [
        'report',
        'finding',
        'dashboard',
        'metric',
        'benchmark',
        'baseline',
        'comparison'
      ],
      rdStage: 'recommend',
      primaryOwner: 'data-analyst',
      recommendedChain: [
        'data-analyst',
        'researcher',
        'reviewer'
      ],
      recommendedAction: 'evaluate',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'synthesis',
      keywords: [
        'synthesis',
        'literature review',
        'meta',
        'state of the art',
        'roundup',
        'survey paper',
        'taxonomy'
      ],
      rdStage: 'synthesize',
      primaryOwner: 'researcher',
      recommendedChain: [
        'researcher',
        'reviewer'
      ],
      recommendedAction: 'research',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'question',
      keywords: [
        'question',
        'research question',
        'what is',
        'why does',
        'how do',
        'investigate',
        'figure out',
        'understand'
      ],
      rdStage: 'question',
      primaryOwner: 'researcher',
      recommendedChain: [
        'researcher'
      ],
      recommendedAction: 'clarify',
      risk: 'low',
      requiresApproval: false
    },
    {
      intakeType: 'ops',
      keywords: [
        'process',
        'methodology',
        'template',
        'protocol',
        'consent form',
        'data handling'
      ],
      rdStage: 'gather',
      primaryOwner: 'operations',
      recommendedChain: [
        'operations',
        'researcher'
      ],
      recommendedAction: 'create-runbook',
      risk: 'low',
      requiresApproval: false
    }
  ]
};

export default researchTable;
