/**
 * lib/task-graph/generate.mjs — derive a task graph from an R&D triage packet.
 *
 * The triage's recommendedChain is the workflow template: one node per
 * persona in the chain, with depends_on edges linking each node to its
 * predecessor. Node types align with rdStage (implementation, design,
 * evaluation, …). Acceptance criteria are seeded from the triage stage;
 * verification requirements ride alongside the workflow contract.
 */

let counter = 0;
function uniqueSuffix() {
  counter = (counter + 1) % 1000;
  return String(counter).padStart(3, '0');
}

function timestamp() {
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${uniqueSuffix()}`;
}

const NODE_TYPE_BY_STAGE = {
  signal: 'framing',
  framing: 'framing',
  hypothesis: 'hypothesis',
  research: 'research',
  artifact: 'design',
  design: 'design',
  implementation: 'implementation',
  evaluation: 'evaluation',
  release: 'release',
  operations: 'runbook',
  unknown: 'framing',
};

const OWNER_NODE_TYPE_OVERRIDE = {
  qa: 'verification',
  reviewer: 'review',
  evaluator: 'evaluation',
  'trace-reviewer': 'evaluation',
  debugger: 'diagnosis',
  'docs-keeper': 'release',
  'legal-compliance': 'compliance-review',
  security: 'review',
};

const ACCEPTANCE_BY_STAGE = {
  framing: ['problem statement is explicit', 'success metric named', 'scope boundaries documented'],
  hypothesis: ['hypothesis is falsifiable', 'success / failure threshold named', 'evaluation method chosen'],
  research: ['three or more sources cited', 'date coverage stated', 'claim → source mapping recorded'],
  design: ['interface contract documented', 'tradeoffs called out', 'reversibility note attached'],
  implementation: ['tests pass locally', 'lint clean', 'diff scoped to the change'],
  evaluation: ['baseline metric recorded', 'failure cases enumerated', 'regression criterion explicit'],
  release: ['changelog entry drafted', 'docs cross-checked', 'rollback path stated'],
  operations: ['runbook step list complete', 'on-call notified', 'monitoring confirmed'],
  unknown: ['define acceptance criteria for this work'],
};

const VERIFICATION_BY_STAGE = {
  implementation: ['npm test', 'lint:comments'],
  evaluation: ['construct evals retrieval'],
  release: ['release:check'],
  operations: ['service health probe'],
};

function pickNodeType({ owner, rdStage }) {
  if (OWNER_NODE_TYPE_OVERRIDE[owner]) return OWNER_NODE_TYPE_OVERRIDE[owner];
  return NODE_TYPE_BY_STAGE[rdStage] || 'framing';
}

function pickNodeTitle({ owner, recommendedAction, request }) {
  const action = recommendedAction || 'work';
  const shortRequest = (request || '').trim().slice(0, 80);
  return shortRequest
    ? `${owner}: ${action} — ${shortRequest}`
    : `${owner}: ${action}`;
}

/**
 * Produce a task graph from a triage packet.
 *
 * @param {object} opts
 * @param {object} opts.triage — output of classifyRdIntake
 * @param {string} [opts.project]
 * @param {string} [opts.request] — original signal text, used for node titles
 * @param {object} [opts.intake] — intake metadata, persisted on node 1 for traceability
 * @returns {{ id, project, createdAt, triage, intake, nodes, edges, verificationRequirements }}
 */
export function generateTaskGraphFromTriage({ triage, project = 'construct', request = '', intake = null } = {}) {
  if (!triage) throw new Error('generateTaskGraphFromTriage: triage is required');
  const chain = Array.isArray(triage.recommendedChain) && triage.recommendedChain.length > 0
    ? triage.recommendedChain
    : [triage.primaryOwner || 'orchestrator'];

  const ts = timestamp();
  const graphId = `task-graph-${ts}`;
  const createdAt = new Date().toISOString();

  const nodes = chain.map((owner, idx) => {
    const nodeId = `${graphId}-${String(idx + 1).padStart(2, '0')}-${owner}`;
    const dependsOn = idx === 0 ? [] : [`${graphId}-${String(idx).padStart(2, '0')}-${chain[idx - 1]}`];
    return {
      id: nodeId,
      project,
      title: pickNodeTitle({ owner, recommendedAction: triage.recommendedAction, request }),
      type: pickNodeType({ owner, rdStage: triage.rdStage }),
      owner,
      status: 'pending',
      dependsOn,
      inputs: idx === 0 && intake ? [{ kind: 'intake', sourcePath: intake.sourcePath }] : [],
      outputs: [],
      acceptanceCriteria: ACCEPTANCE_BY_STAGE[triage.rdStage] || ACCEPTANCE_BY_STAGE.unknown,
      evidence: [],
      risk: triage.risk || 'low',
      createdAt,
      updatedAt: createdAt,
    };
  });

  const edges = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: nodes[i - 1].id, to: nodes[i].id, type: 'handoff_to' });
    edges.push({ from: nodes[i].id, to: nodes[i - 1].id, type: 'depends_on' });
  }

  return {
    id: graphId,
    project,
    createdAt,
    triage,
    intake,
    nodes,
    edges,
    verificationRequirements: VERIFICATION_BY_STAGE[triage.rdStage] || [],
  };
}
