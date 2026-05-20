/**
 * lib/evaluator-optimizer.mjs — Iterative refinement loop for document authoring.
 *
 * Implements the evaluator-optimizer pattern from Anthropic's best practices:
 * 1. Generator creates a draft
 * 2. Evaluator scores against rubric (0.0 - 1.0)
 * 3. If score < threshold, generate revision with feedback
 * 4. Repeat until score >= threshold or max iterations reached
 *
 * Usage:
 *   const result = await runEvaluatorOptimizer({
 *     request: 'Write a PRD for feature X',
 *     docType: 'prd',
 *     threshold: 0.7,
 *     maxIterations: 3,
 *   });
 *
 * Returns:
 *   {
 *     content: string,
 *     iterations: number,
 *     finalScore: number,
 *     scores: [0.6, 0.75, 0.82],
 *     feedback: [...],
 *     reachedThreshold: boolean,
 *   }
 */

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_MAX_ITERATIONS = 3;

const RUBRICS = {
  prd: {
    name: 'PRD Quality Rubric',
    criteria: [
      { id: 'summary', name: 'Summary', description: 'One paragraph that captures what, who, why', weight: 0.1 },
      { id: 'problem', name: 'Problem Statement', description: 'Clear user pain, not solution-speak', weight: 0.15 },
      { id: 'goals', name: 'Goals', description: '3-5 outcome-focused goals, not activities', weight: 0.1 },
      { id: 'scope', name: 'Scope', description: 'In/out of scope clearly bounded', weight: 0.1 },
      { id: 'phases', name: 'Phases', description: 'Each phase independently shippable', weight: 0.15 },
      { id: 'requirements', name: 'Requirements', description: 'FRs/NFRs with acceptance criteria', weight: 0.2 },
      { id: 'metrics', name: 'Success Metrics', description: 'Leading and lagging indicators', weight: 0.1 },
      { id: 'risks', name: 'Risks', description: 'Likelihood/impact with mitigations', weight: 0.1 },
    ],
  },
  adr: {
    name: 'ADR Quality Rubric',
    criteria: [
      { id: 'title', name: 'Title', description: 'Clear, imperative format', weight: 0.05 },
      { id: 'status', name: 'Status', description: 'Proposed/Accepted/Deprecated with date', weight: 0.05 },
      { id: 'context', name: 'Context', description: 'Forces, constraints, assumptions', weight: 0.2 },
      { id: 'decision', name: 'Decision', description: 'Clear statement of what was decided', weight: 0.25 },
      { id: 'alternatives', name: 'Alternatives', description: 'Rejected options with rationale', weight: 0.2 },
      { id: 'consequences', name: 'Consequences', description: 'Positive, negative, neutral outcomes', weight: 0.15 },
      { id: 'compliance', name: 'Compliance', description: 'Links to related ADRs, PRDs', weight: 0.1 },
    ],
  },
  rfc: {
    name: 'RFC Quality Rubric',
    criteria: [
      { id: 'summary', name: 'Summary', description: 'Executive summary for busy readers', weight: 0.1 },
      { id: 'motivation', name: 'Motivation', description: 'Why this matters now', weight: 0.15 },
      { id: 'proposal', name: 'Proposal', description: 'Clear, specific technical change', weight: 0.25 },
      { id: 'alternatives', name: 'Alternatives Considered', description: 'Other approaches and why not', weight: 0.15 },
      { id: 'implementation', name: 'Implementation Plan', description: 'Phases, milestones, owners', weight: 0.15 },
      { id: 'risks', name: 'Risks & Mitigations', description: 'What could go wrong', weight: 0.1 },
      { id: 'success', name: 'Success Criteria', description: 'How we know this worked', weight: 0.1 },
    ],
  },
  runbook: {
    name: 'Runbook Quality Rubric',
    criteria: [
      { id: 'trigger', name: 'Trigger', description: 'When to run this runbook', weight: 0.1 },
      { id: 'steps', name: 'Steps', description: 'Numbered, executable steps', weight: 0.3 },
      { id: 'verification', name: 'Verification', description: 'How to confirm it worked', weight: 0.2 },
      { id: 'rollback', name: 'Rollback', description: 'How to undo if needed', weight: 0.15 },
      { id: 'escalation', name: 'Escalation', description: 'Who to call if stuck', weight: 0.1 },
      { id: 'references', name: 'References', description: 'Related docs, runbooks, alerts', weight: 0.15 },
    ],
  },
};

/**
 * Evaluate a document against its rubric.
 * Returns a score (0.0 - 1.0) and detailed feedback.
 */
export async function evaluateDocument({ content, docType, evaluatorFn = null }) {
  const rubric = RUBRICS[docType];
  if (!rubric) {
    throw new Error(`Unknown document type: ${docType}. Available: ${Object.keys(RUBRICS).join(', ')}`);
  }
  
  // If custom evaluator function provided, use it
  if (evaluatorFn) {
    return await evaluatorFn({ content, docType, rubric });
  }
  
  // Default: deterministic rubric-based evaluation
  // In production, this would call an LLM evaluator
  // For now, we use structural checks as a proxy
  
  const scores = [];
  const feedback = [];
  
  for (const criterion of rubric.criteria) {
    // Check if the criterion section exists in the content
    const sectionPatterns = getSectionPatterns(docType, criterion.id);
    let score = 0;
    let found = false;
    
    for (const pattern of sectionPatterns) {
      if (content.toLowerCase().includes(pattern.toLowerCase())) {
        found = true;
        break;
      }
    }
    
    if (found) {
      // Check for quality indicators
      const qualityIndicators = getQualityIndicators(criterion.id);
      let qualityScore = 0.5; // Base score for having the section
      
      for (const indicator of qualityIndicators) {
        if (content.toLowerCase().includes(indicator.toLowerCase())) {
          qualityScore += 0.1;
        }
      }
      
      score = Math.min(1.0, qualityScore);
    }
    
    scores.push(score * criterion.weight);
    feedback.push({
      criterion: criterion.name,
      score,
      maxScore: 1.0,
      weight: criterion.weight,
      comment: found ? `Section present, quality: ${(score * 100).toFixed(0)}%` : 'Section missing',
    });
  }
  
  const finalScore = scores.reduce((a, b) => a + b, 0);
  
  return {
    score: finalScore,
    feedback,
    rubric: rubric.name,
    docType,
    evaluatedAt: new Date().toISOString(),
  };
}

function getSectionPatterns(docType, criterionId) {
  const patterns = {
    prd: {
      summary: ['## summary', '## overview', '## executive summary'],
      problem: ['## problem', '## problem statement', '## background'],
      goals: ['## goals', '## objectives'],
      scope: ['## in scope', '## out of scope', '## scope'],
      phases: ['## phase', '## phases'],
      requirements: ['functional', 'non-functional', 'FR-', 'NFR-', 'acceptance'],
      metrics: ['## success metric', '## metrics', 'kpi'],
      risks: ['## risk', '## risks', 'mitigation'],
    },
    adr: {
      title: ['# adr:', '## title'],
      status: ['## status', 'status:'],
      context: ['## context', '## background', '## forces'],
      decision: ['## decision', '## proposed solution'],
      alternatives: ['## alternatives', '## alternative', 'rejected'],
      consequences: ['## consequences', '## implications'],
      compliance: ['## compliance', '## related', 'links to'],
    },
    rfc: {
      summary: ['## summary', '## abstract', '## overview'],
      motivation: ['## motivation', '## why', '## rationale'],
      proposal: ['## proposal', '## design', '## solution'],
      alternatives: ['## alternatives', '## alternative approaches'],
      implementation: ['## implementation', '## plan', '## timeline'],
      risks: ['## risks', '## concerns'],
      success: ['## success criteria', '## how we measure'],
    },
    runbook: {
      trigger: ['## trigger', '## when to run', '## purpose'],
      steps: ['## steps', '## procedure', '## instructions'],
      verification: ['## verification', '## confirm', '## validate'],
      rollback: ['## rollback', '## undo', '## revert'],
      escalation: ['## escalation', '## contacts', '## who to call'],
      references: ['## references', '## related', '## see also'],
    },
  };
  
  return patterns[docType]?.[criterionId] || [];
}

function getQualityIndicators(criterionId) {
  const indicators = {
    summary: ['one paragraph', 'in brief', 'tl;dr'],
    problem: ['user', 'customer', 'pain', 'currently unable'],
    goals: ['reduce', 'increase', 'eliminate', 'from', 'to'],
    scope: ['explicitly', 'deferred', 'not included'],
    phases: ['phase 1', 'phase 2', 'phase 3', 'independently shippable'],
    requirements: ['must', 'should', 'acceptance:', 'falsifiable'],
    metrics: ['leading', 'lagging', 'baseline', 'target'],
    risks: ['likelihood', 'impact', 'mitigation', 'low', 'medium', 'high'],
  };
  
  return indicators[criterionId] || [];
}

/**
 * Generate revision feedback based on evaluation results.
 */
export function generateRevisionFeedback(evaluationResult) {
  const improvements = [];
  
  for (const item of evaluationResult.feedback) {
    if (item.score < 0.7) {
      improvements.push(`- **${item.criterion}** (score: ${(item.score * 100).toFixed(0)}%): ${item.comment}`);
    }
  }
  
  if (improvements.length === 0) {
    return 'Document meets all quality criteria. No revisions needed.';
  }
  
  return `Please revise the document to address the following:\n\n${improvements.join('\n')}`;
}

/**
 * Run the full evaluator-optimizer loop.
 */
export async function runEvaluatorOptimizer({
  request,
  docType,
  threshold = DEFAULT_THRESHOLD,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  generatorFn,
  evaluatorFn,
}) {
  if (!generatorFn) {
    throw new Error('generatorFn is required — provide a function that generates document drafts');
  }
  
  const results = {
    content: null,
    iterations: 0,
    finalScore: 0,
    scores: [],
    feedback: [],
    reachedThreshold: false,
  };
  
  let currentContent = null;
  let iterationFeedback = null;
  
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    results.iterations = iteration;
    
    // Generate draft (or revision)
    currentContent = await generatorFn({
      request,
      docType,
      iteration,
      previousFeedback: iterationFeedback,
    });
    
    // Evaluate
    const evaluation = await evaluateDocument({
      content: currentContent,
      docType,
      evaluatorFn,
    });
    
    results.scores.push(evaluation.score);
    results.feedback.push(evaluation.feedback);
    results.finalScore = evaluation.score;
    
    if (evaluation.score >= threshold) {
      results.reachedThreshold = true;
      results.content = currentContent;
      break;
    }
    
    // Generate feedback for next iteration
    iterationFeedback = generateRevisionFeedback(evaluation);
  }
  
  results.content = currentContent;
  
  return results;
}

/**
 * Get available rubrics for a document type.
 */
export function getRubric(docType) {
  return RUBRICS[docType] || null;
}

/**
 * List all available rubrics.
 */
export function listRubrics() {
  return Object.keys(RUBRICS).map(type => ({
    docType: type,
    name: RUBRICS[type].name,
    criteriaCount: RUBRICS[type].criteria.length,
    criteria: RUBRICS[type].criteria.map(c => ({
      id: c.id,
      name: c.name,
      weight: c.weight,
    })),
  }));
}
