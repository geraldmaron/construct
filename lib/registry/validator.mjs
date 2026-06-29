/**
 * lib/registry/validator.mjs — Validates unified registry invariants.
 *
 * Enforces 13 invariants that guarantee the registry is internally consistent:
 * teams have owners, specialists have teams, no cycles, decisions are covered by
 * policies, contracts reference valid parties, and escalation paths are sound.
 *
 * Export: validate(registry, opts) → { ok, errors, warnings }
 * Each error/warning has { id, severity, message, location }
 */

/**
 * Validate a unified registry against all invariants.
 * @param {object} registry - The unified registry object
 * @param {object} opts - Options (reserved for future use)
 * @returns {{ ok: boolean, errors: Array, warnings: Array }}
 */
export function validate(registry, opts = {}) {
  const errors = [];
  const warnings = [];

  if (!registry || typeof registry !== 'object') {
    return {
      ok: false,
      errors: [{ id: 'invalid-input', severity: 'error', message: 'Registry must be a non-null object', location: '#' }],
      warnings: [],
    };
  }

  // Schema compliance must pass before graph traversal; structural errors short-circuit.

  const schemaCheck = checkSchemaCompliance(registry);
  errors.push(...schemaCheck.errors);
  warnings.push(...schemaCheck.warnings);
  if (schemaCheck.errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const teams = registry.teams || {};
  const specialists = registry.specialists || {};
  const contracts = registry.contracts || {};
  const policies = registry.policies || {};

  // Team and specialist graph: owners, membership, and naming collisions.

  errors.push(...checkTeamHasOwner(teams, specialists));
  errors.push(...checkSpecialistTeamExists(specialists, teams));
  errors.push(...checkTeamHasSpecialists(teams, specialists));
  errors.push(...checkNoNameCollisions(specialists));

  // Policy coverage for team decision rights and forbidden actions.

  warnings.push(...checkDecisionHasPolicy(teams, policies));
  warnings.push(...checkForbiddenDecisions(teams, policies));

  // Escalation paths must resolve specialists and remain acyclic.

  errors.push(...checkEscalationPathValid(teams, specialists));
  errors.push(...checkNoCircularEscalation(teams));

  // Contracts and policies must reference teams and specialists that exist.

  errors.push(...checkContractPartiesExist(contracts, specialists));
  errors.push(...checkContractTeamBoundaries(contracts, teams));
  errors.push(...checkPolicyTeamOwnerExists(policies, teams));
  errors.push(...checkPolicyApproverTeamsExist(policies, teams));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// === Individual invariant checks ===

function checkSchemaCompliance(registry) {
  const errors = [];
  const warnings = [];

  if (registry.version !== 2 && registry.version !== 3) {
    errors.push({
      id: 'invalid-version',
      severity: 'error',
      message: `Schema version must be 2 or 3, got ${registry.version}`,
      location: '#/version',
    });
  }

  if (typeof registry.teams !== 'object' || registry.teams === null) {
    errors.push({
      id: 'missing-teams',
      severity: 'error',
      message: 'teams must be an object',
      location: '#/teams',
    });
  }

  if (typeof registry.specialists !== 'object' || registry.specialists === null) {
    errors.push({
      id: 'missing-specialists',
      severity: 'error',
      message: 'specialists must be an object',
      location: '#/specialists',
    });
  }

  if (typeof registry.contracts !== 'object' || registry.contracts === null) {
    errors.push({
      id: 'missing-contracts',
      severity: 'error',
      message: 'contracts must be an object',
      location: '#/contracts',
    });
  }

  if (typeof registry.policies !== 'object' || registry.policies === null) {
    errors.push({
      id: 'missing-policies',
      severity: 'error',
      message: 'policies must be an object',
      location: '#/policies',
    });
  }

  return { errors, warnings };
}

function isGroup(team) {
  return team?.kind === 'group';
}

function checkTeamHasOwner(teams, specialists) {
  const errors = [];

  for (const [teamId, team] of Object.entries(teams)) {
    if (isGroup(team)) continue;

    const ownerRole = team.owner;
    if (!ownerRole) {
      errors.push({
        id: 'team-missing-owner',
        severity: 'error',
        message: `Team ${teamId} missing owner field`,
        location: `#/teams/${teamId}/owner`,
      });
      continue;
    }

    const hasOwner = Object.values(specialists).some(
      (spec) => spec.team === teamId && (spec.role === 'owner' || spec.role === ownerRole),
    );

    if (!hasOwner) {
      errors.push({
        id: 'team-no-owner-specialist',
        severity: 'error',
        message: `Team ${teamId} has owner role ${ownerRole} but no specialist with that role assigned`,
        location: `#/teams/${teamId}`,
      });
    }
  }

  return errors;
}

function checkSpecialistTeamExists(specialists, teams) {
  const errors = [];
  const teamIds = Object.keys(teams);

  for (const [specId, spec] of Object.entries(specialists)) {
    if (!spec.team) {
      errors.push({
        id: 'specialist-missing-team',
        severity: 'error',
        message: `Specialist ${specId} missing team assignment`,
        location: `#/specialists/${specId}/team`,
      });
    } else if (!teamIds.includes(spec.team) && spec.team !== 'unknown') {
      errors.push({
        id: 'specialist-unknown-team',
        severity: 'error',
        message: `Specialist ${specId} references unknown team ${spec.team}`,
        location: `#/specialists/${specId}/team`,
      });
    }
  }

  return errors;
}

function checkTeamHasSpecialists(teams, specialists) {
  const errors = [];
  const specsByTeam = {};

  for (const spec of Object.values(specialists)) {
    if (spec.team) {
      if (!specsByTeam[spec.team]) specsByTeam[spec.team] = [];
      specsByTeam[spec.team].push(spec);
    }
  }

  for (const teamId of Object.keys(teams)) {
    const team = teams[teamId];
    if (isGroup(team)) continue;

    if (!specsByTeam[teamId] || specsByTeam[teamId].length === 0) {
      errors.push({
        id: 'team-no-specialists',
        severity: 'error',
        message: `Team ${teamId} has no assigned specialists`,
        location: `#/teams/${teamId}`,
      });
    }
  }

  return errors;
}

function checkNoNameCollisions(specialists) {
  const errors = [];
  const seen = new Map();

  for (const [specId, spec] of Object.entries(specialists)) {
    if (seen.has(spec.name)) {
      errors.push({
        id: 'specialist-name-collision',
        severity: 'error',
        message: `Specialist name collision: ${spec.name} appears in ${seen.get(spec.name)} and ${specId}`,
        location: `#/specialists/${specId}/name`,
      });
    }
    seen.set(spec.name, specId);
  }

  return errors;
}

function checkDecisionHasPolicy(teams, policies) {
  const warnings = [];
  const policyIds = Object.keys(policies);

  for (const [teamId, team] of Object.entries(teams)) {
    const rights = team.decisionRights || [];
    for (const right of rights) {
      if (!policyIds.includes(right)) {
        warnings.push({
          id: 'decision-no-policy',
          severity: 'warning',
          message: `Team ${teamId} claims decision right ${right} but no policy with that id exists`,
          location: `#/teams/${teamId}/decisionRights`,
        });
      }
    }
  }

  return warnings;
}

function checkForbiddenDecisions(teams, policies) {
  const warnings = [];

  for (const [teamId, team] of Object.entries(teams)) {
    const forbidden = team.forbiddenDecisions || [];
    for (const decision of forbidden) {
      if (!(decision in policies)) {
        warnings.push({
          id: 'forbidden-decision-invalid',
          severity: 'warning',
          message: `Team ${teamId} forbids decision ${decision} but it is not a recognized decision`,
          location: `#/teams/${teamId}/forbiddenDecisions`,
        });
      }
    }
  }

  return warnings;
}

function checkEscalationPathValid(teams, specialists) {
   const errors = [];
   
   // Build a set of all valid roles (from all teams)
   const allRoles = new Set();
   for (const team of Object.values(teams)) {
     for (const role of team.roles || []) {
       allRoles.add(role);
     }
   }

   for (const [teamId, team] of Object.entries(teams)) {
     const path = team.escalationPath || [];
     for (let i = 0; i < path.length; i++) {
       const role = path[i];
       if (role === 'orchestrator') continue; // orchestrator is always valid

       // Check if this role exists in any team's roles
       if (!allRoles.has(role)) {
         errors.push({
           id: 'escalation-path-invalid-role',
           severity: 'error',
           message: `Team ${teamId} escalation path references role ${role} at index ${i} with no team claiming that role`,
           location: `#/teams/${teamId}/escalationPath/${i}`,
         });
       }
     }
   }

   return errors;
 }

function checkNoCircularEscalation(teams) {
  const errors = [];

  for (const [teamId, team] of Object.entries(teams)) {
    const path = team.escalationPath || [];
    const visited = new Set();

    for (const role of path) {
      if (visited.has(role)) {
        errors.push({
          id: 'circular-escalation',
          severity: 'error',
          message: `Team ${teamId} escalation path contains cycle: ${role} appears twice`,
          location: `#/teams/${teamId}/escalationPath`,
        });
        break;
      }
      visited.add(role);
    }
  }

  return errors;
}

function checkContractPartiesExist(contracts, specialists) {
   const errors = [];
   const specialistIds = new Set(Object.keys(specialists));
   const validParties = new Set(['user', 'construct', '*', ...specialistIds]); // * = wildcard producer

   for (const [contractId, contract] of Object.entries(contracts)) {
     if (!validParties.has(contract.producer)) {
       errors.push({
         id: 'contract-unknown-producer',
         severity: 'error',
         message: `Contract ${contractId} references unknown producer ${contract.producer}`,
         location: `#/contracts/${contractId}/producer`,
       });
     }

     if (!validParties.has(contract.consumer)) {
       errors.push({
         id: 'contract-unknown-consumer',
         severity: 'error',
         message: `Contract ${contractId} references unknown consumer ${contract.consumer}`,
         location: `#/contracts/${contractId}/consumer`,
       });
     }
   }

   return errors;
 }

function checkContractTeamBoundaries(contracts, teams) {
  const errors = [];
  const teamIds = Object.keys(teams);

  for (const [contractId, contract] of Object.entries(contracts)) {
    if (contract.teamBoundary) {
      const { producerTeam, consumerTeam } = contract.teamBoundary;

      if (producerTeam && !teamIds.includes(producerTeam)) {
        errors.push({
          id: 'contract-unknown-team',
          severity: 'error',
          message: `Contract ${contractId} teamBoundary references unknown team ${producerTeam}`,
          location: `#/contracts/${contractId}/teamBoundary/producerTeam`,
        });
      }

      if (consumerTeam && !teamIds.includes(consumerTeam)) {
        errors.push({
          id: 'contract-unknown-team',
          severity: 'error',
          message: `Contract ${contractId} teamBoundary references unknown team ${consumerTeam}`,
          location: `#/contracts/${contractId}/teamBoundary/consumerTeam`,
        });
      }
    }
  }

  return errors;
}

function checkPolicyTeamOwnerExists(policies, teams) {
  const errors = [];
  const teamIds = Object.keys(teams);

  for (const [policyId, policy] of Object.entries(policies)) {
    if (policy.owner && !teamIds.includes(policy.owner) && policy.owner !== 'orchestrator') {
      errors.push({
        id: 'policy-unknown-owner',
        severity: 'error',
        message: `Policy ${policyId} owner team ${policy.owner} does not exist`,
        location: `#/policies/${policyId}/owner`,
      });
    }
  }

  return errors;
}

function checkPolicyApproverTeamsExist(policies, teams) {
   const errors = [];
   const teamIds = Object.keys(teams);
   const policyIds = Object.keys(policies);

   for (const [policyId, policy] of Object.entries(policies)) {
     const approvers = policy.requiresApprovalFrom || [];
     for (let i = 0; i < approvers.length; i++) {
       const approverId = approvers[i];
       // approvers can be team IDs or policy IDs (for nested approval requirements)
       const isTeamId = teamIds.includes(approverId);
       const isPolicyId = policyIds.includes(approverId);
       
       if (!isTeamId && !isPolicyId) {
         errors.push({
           id: 'policy-unknown-approver',
           severity: 'error',
           message: `Policy ${policyId} requiresApprovalFrom references unknown team or policy ${approverId}`,
           location: `#/policies/${policyId}/requiresApprovalFrom/${i}`,
         });
       }
     }
   }

   return errors;
 }
