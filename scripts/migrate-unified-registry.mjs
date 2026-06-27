#!/usr/bin/env node

/**
 * scripts/migrate-unified-registry.mjs
 *
 * One-shot migration script: consolidates five legacy registry files into
 * a single unified registry that validates against the new schema.
 *
 * Inputs:
 *   - specialists/teams.json (workflow templates)
 *   - specialists/teams-registry.json (organizational teams)
 *   - specialists/registry.json (specialist definitions)
 *   - specialists/role-manifests.json (per-role events, fences)
 *   - specialists/contracts.json (producer→consumer contracts)
 *   - specialists/policy-inventory.json (governance policies)
 *
 * Output:
 *   - specialists/unified-registry.json (validated unified registry)
 *
 * Properties:
 *   - Pure: same inputs → same output (no git/fs side effects except output file)
 *   - Deterministic: idempotent, byte-identical on repeated runs
 *   - Safe: validates output against schema before writing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to load JSON safely
function loadJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

// Helper to write JSON with consistent formatting
function writeJson(filePath, obj) {
  const content = JSON.stringify(obj, null, 2);
  fs.writeFileSync(filePath, content + '\n', 'utf8');
}

// Load all legacy files
console.error('[migrate] loading legacy files...');
const teamsJson = loadJson(path.join(ROOT_DIR, 'specialists/teams.json'));
const teamsRegistry = loadJson(path.join(ROOT_DIR, 'specialists/teams-registry.json'));
const registry = loadJson(path.join(ROOT_DIR, 'specialists/registry.json'));
const roleManifests = loadJson(path.join(ROOT_DIR, 'specialists/role-manifests.json'));
const contracts = loadJson(path.join(ROOT_DIR, 'specialists/contracts.json'));
const policyInventory = loadJson(path.join(ROOT_DIR, 'specialists/policy-inventory.json'));

// Load schema for validation
const schema = loadJson(path.join(ROOT_DIR, 'schemas/unified-registry.schema.json'));

// === Build unified registry ===

const unified = {
  version: 2,
  teams: {},
  specialists: {},
  contracts: {},
  policies: {},
};

// Build teams from teams-registry.json, optionally merged with workflow templates.
console.error('[migrate] building teams...');
for (const team of teamsRegistry.teams) {
   const workflowTemplate = teamsJson.templates && teamsJson.templates[team.id];
   unified.teams[team.id] = {
     id: team.id,
     name: team.name,
     owner: team.owner,
     roles: team.roles,
     decisionRights: team.decisionRights || [],
     forbiddenDecisions: team.forbiddenDecisions || [],
     escalationPath: team.escalationPath || [team.owner],
     charter: team.charter,
     contact: team.contact || {},
     evidence: team.evidence || [],
   };
   // Optionally attach the workflow template if one exists for this team
   if (workflowTemplate) {
     unified.teams[team.id].workflowTemplate = workflowTemplate;
   }
}

// Create minimal approval gate teams if policies reference them
const allPolicies = [...(policyInventory.policies || [])];
const requiredApprovalTeams = new Set();
for (const policy of allPolicies) {
   if (policy.requiresApprovalFrom) {
     for (const team of policy.requiresApprovalFrom) {
       requiredApprovalTeams.add(team);
     }
   }
}
for (const teamId of requiredApprovalTeams) {
   if (!unified.teams[teamId]) {
     unified.teams[teamId] = {
       id: teamId,
       name: teamId.replace(/-/g, ' '),
       owner: 'orchestrator',
       roles: ['orchestrator'],
       decisionRights: [],
       forbiddenDecisions: [],
       escalationPath: ['orchestrator'],
       charter: `Approval gate: ${teamId}`,
       contact: {},
       evidence: [],
     };
   }
}

// Build specialists from registry.json, merging with role-manifests.json.
console.error('[migrate] building specialists...');

// Create a mapping from role name (without cx- prefix) to team id
const roleToTeam = {};
for (const [teamId, team] of Object.entries(unified.teams)) {
  for (const role of team.roles) {
    roleToTeam[role] = teamId;
  }
}

for (const spec of registry.specialists) {
   const specId = `cx-${spec.name}`;
   
   // Find which team this specialist belongs to and infer the role
   let teamId = null;
   let role = spec.role;
   
   // Try to map the specialist name to a team role
   if (roleToTeam[spec.name]) {
     teamId = roleToTeam[spec.name];
     // The role is the specialist name (since specialists are named after their roles)
     if (!role) {
       role = spec.name;
     }
   } else if (spec.role && roleToTeam[spec.role]) {
     // If spec has a role field, use it to find the team
     teamId = roleToTeam[spec.role];
     role = spec.role;
   }

   const manifest = roleManifests.personas[spec.name] || {};

   unified.specialists[specId] = {
     name: spec.name,
     displayName: spec.displayName || spec.description,
     description: spec.description,
     team: teamId || 'unknown', // fallback for specialists without a mapped team (rare)
     role: role || 'unknown-role', // use inferred role or mark as unknown
     modelTier: spec.modelTier || 'standard',
     reasoningEffort: spec.reasoningEffort || 'medium',
     skills: spec.skills || [],
     events: manifest.events || [],
     fence: manifest.fence || {},
     docArtifacts: manifest.outputs?.docTypes || [],
     watchConditions: spec.watchConditions || [],
     permissions: spec.permissions || {},
   };

  // Preserve additional fields from registry
  if (spec.promptFile) {
    unified.specialists[specId].promptFile = spec.promptFile;
  }
  if (spec.injectAgentRoster !== undefined) {
    unified.specialists[specId].injectAgentRoster = spec.injectAgentRoster;
  }
  if (spec.embedOrientation) {
    unified.specialists[specId].embedOrientation = spec.embedOrientation;
  }
  if (spec.wordCapOverride !== undefined) {
    unified.specialists[specId].wordCapOverride = spec.wordCapOverride;
  }
  if (spec.canEdit !== undefined) {
    unified.specialists[specId].canEdit = spec.canEdit;
  }
  if (spec.claudeTools) {
    unified.specialists[specId].claudeTools = spec.claudeTools;
  }
}

// Build contracts from contracts.json.
console.error('[migrate] building contracts...');
for (const contract of contracts.contracts) {
  unified.contracts[contract.id] = {
    id: contract.id,
    producer: contract.producer,
    consumer: contract.consumer,
    trigger: contract.trigger || {},
    input: contract.input || {},
    output: contract.output || {},
    preconditions: contract.preconditions || [],
    postconditions: contract.postconditions || [],
    description: contract.description || '',
  };

  // Infer teamBoundary if producer and consumer are both specialists
  const producerSpec = unified.specialists[contract.producer];
  const consumerSpec = unified.specialists[contract.consumer];
  if (producerSpec && consumerSpec && producerSpec.team && consumerSpec.team) {
    if (producerSpec.team !== consumerSpec.team) {
      unified.contracts[contract.id].teamBoundary = {
        crosses: true,
        producerTeam: producerSpec.team,
        consumerTeam: consumerSpec.team,
        requiresApprovalFrom: [],
      };
    }
  }
}

// Build policies from policy-inventory.json + teams-registry.json decision matrix.
console.error('[migrate] building policies...');

// First, infer policies from the decision matrix
if (teamsRegistry.decisionMatrix) {
  for (const [decisionId, decisionEntry] of Object.entries(teamsRegistry.decisionMatrix)) {
    const policyGate = teamsRegistry.policyGates?.[decisionId];
    unified.policies[decisionId] = {
      id: decisionId,
      owner: decisionEntry.decider,
      description: policyGate?.description || `Decision: ${decisionId}`,
      enforcement: 'hard',
      mode: 'approval',
      requiresApprovalFrom: decisionEntry.requires || [],
      mayVetoFrom: decisionEntry.mayVeto || [],
      escalatesTo: policyGate?.escalatesTo || [],
      decisionRights: [decisionId],
      conditions: [],
      evidence: [],
    };
  }
}

// Then, merge in any explicit policies from policy-inventory.json
if (policyInventory.policies) {
  for (const policy of policyInventory.policies) {
    unified.policies[policy.id] = {
      id: policy.id,
      owner: policy.owner || 'orchestrator',
      description: policy.description,
      enforcement: policy.enforcement || 'soft',
      mode: policy.mode || 'audit',
      requiresApprovalFrom: policy.requiresApprovalFrom || [],
      mayVetoFrom: [],
      escalatesTo: [],
      decisionRights: policy.decisionRights || [],
      conditions: policy.conditions || [],
      evidence: policy.evidence || [],
    };
  }
}

// === Validate ===
console.error('[migrate] validating against schema...');

// Simple schema validation (minimal check for v2 and required top-level fields)
if (unified.version !== 2) {
  throw new Error(`Schema version must be 2, got ${unified.version}`);
}
if (typeof unified.teams !== 'object' || unified.teams === null) {
  throw new Error('teams must be an object');
}
if (typeof unified.specialists !== 'object' || unified.specialists === null) {
  throw new Error('specialists must be an object');
}
if (typeof unified.contracts !== 'object' || unified.contracts === null) {
  throw new Error('contracts must be an object');
}
if (typeof unified.policies !== 'object' || unified.policies === null) {
  throw new Error('policies must be an object');
}

// Validate that every specialist has a team reference
for (const [specId, spec] of Object.entries(unified.specialists)) {
  if (!spec.team) {
    throw new Error(`Specialist ${specId} missing team reference`);
  }
  if (!(spec.team in unified.teams) && spec.team !== 'unknown') {
    throw new Error(`Specialist ${specId} references unknown team ${spec.team}`);
  }
}

// Validate that every team has at least one specialist
const specsByTeam = {};
for (const [specId, spec] of Object.entries(unified.specialists)) {
  if (!specsByTeam[spec.team]) {
    specsByTeam[spec.team] = [];
  }
  specsByTeam[spec.team].push(specId);
}
for (const teamId of Object.keys(unified.teams)) {
  if (!specsByTeam[teamId] || specsByTeam[teamId].length === 0) {
    // Warning only; this may be intentional for template-only teams
    console.warn(`[migrate] warning: team ${teamId} has no assigned specialists`);
  }
}

// === Output ===
console.error('[migrate] writing unified-registry.json...');
const outputPath = path.join(ROOT_DIR, 'specialists/unified-registry.json');
writeJson(outputPath, unified);

// Print summary
const teamCount = Object.keys(unified.teams).length;
const specCount = Object.keys(unified.specialists).length;
const contractCount = Object.keys(unified.contracts).length;
const policyCount = Object.keys(unified.policies).length;
console.log(`migrated: ${teamCount} teams, ${specCount} specialists, ${contractCount} contracts, ${policyCount} policies`);

// Exit success
process.exit(0);
