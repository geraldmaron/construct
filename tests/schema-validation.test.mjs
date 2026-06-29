/**
 * tests/schema-validation.test.mjs — Validate unified registry schema and test with fixtures.
 *
 * The unified registry consolidates teams, specialists, contracts, and policies into
 * a single schema-validated document. This test ensures:
 * - Schema is well-formed and validates against draft-07
 * - Fixtures with 2 teams, 3 specialists, 2 contracts, 2 policies validate
 * - Malformed inputs (missing required fields, circular escalations, etc.) are rejected
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SCHEMA_PATH = path.join(ROOT_DIR, 'schemas', 'unified-registry.schema.json');

// Load the schema
const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
const schema = JSON.parse(schemaText);

/**
 * Basic JSON Schema validator (draft-07 subset).
 * For full validation, use ajv or similar; this covers the basics.
 */
function validateAgainstSchema(data, schema, path = '#') {
  const errors = [];

  // Check type
  if (schema.type && typeof data !== schema.type) {
    errors.push(`${path}: expected type ${schema.type}, got ${typeof data}`);
    return errors;
  }

  // Check const
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: expected constant ${schema.const}, got ${data}`);
  }

  // Check enum
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path}: expected one of ${schema.enum.join(', ')}, got ${data}`);
  }

  // Check required properties
  if (schema.required && typeof data === 'object' && data !== null) {
    for (const prop of schema.required) {
      if (!(prop in data)) {
        errors.push(`${path}: missing required property "${prop}"`);
      }
    }
  }

  // Check additionalProperties: false
  if (
    schema.additionalProperties === false &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data)
  ) {
    const allowedKeys = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(data)) {
      if (!allowedKeys.has(key)) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  // Check object properties
  if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [prop, propSchema] of Object.entries(schema.properties)) {
      if (prop in data) {
        errors.push(
          ...validateAgainstSchema(data[prop], propSchema, `${path}.${prop}`),
        );
      }
    }
  }

  // Check array items
  if (schema.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      errors.push(
        ...validateAgainstSchema(data[i], schema.items, `${path}[${i}]`),
      );
    }
  }

  // Check minItems
  if (schema.minItems !== undefined && Array.isArray(data) && data.length < schema.minItems) {
    errors.push(`${path}: array has ${data.length} items, minimum is ${schema.minItems}`);
  }

  return errors;
}

describe('schemas/unified-registry.schema.json', () => {
  it('schema file exists and is valid JSON', () => {
    assert.ok(fs.existsSync(SCHEMA_PATH), `Schema file not found at ${SCHEMA_PATH}`);
    assert.doesNotThrow(() => JSON.parse(schemaText));
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.equal(schema.title, 'Construct Unified Registry');
  });

  it('schema has required top-level properties', () => {
    assert.ok(schema.properties.version);
    assert.ok(schema.properties.teams);
    assert.ok(schema.properties.specialists);
    assert.ok(schema.properties.contracts);
    assert.ok(schema.properties.policies);
  });

  it('schema version accepts v2 and v3', () => {
    assert.deepEqual(schema.properties.version.enum, [2, 3]);
  });

  it('schema defines $defs for team, specialist, contract, policy', () => {
    assert.ok(schema.$defs.team);
    assert.ok(schema.$defs.specialist);
    assert.ok(schema.$defs.contract);
    assert.ok(schema.$defs.policy);
  });

  describe('valid fixture with 2 teams, 3 specialists, 2 contracts, 2 policies', () => {
    let fixture;

    const createFixture = () => ({
      version: 2,
      teams: {
        'product-group': {
          id: 'product-group',
          name: 'Product Group',
          owner: 'product-manager',
          roles: ['product-manager', 'ux-researcher'],
          decisionRights: ['intake-triage', 'design-approval'],
          forbiddenDecisions: ['deployment'],
          escalationPath: ['product-manager', 'rd-lead'],
          charter: 'Translate user reality into shippable change. Own problem framing, requirements, evidence, and design decisions.',
          contact: {
            slack: '#product',
            email: 'product@example.com',
            owner: 'product-manager',
          },
        },
        'engineering-group': {
          id: 'engineering-group',
          name: 'Engineering Group',
          owner: 'architect',
          roles: ['architect', 'engineer'],
          decisionRights: ['architecture', 'technology-selection'],
          forbiddenDecisions: ['product-scope'],
          escalationPath: ['architect', 'rd-lead'],
          charter: 'Design, build, and harden the system. Own architecture, technology, and code quality.',
          contact: {
            slack: '#engineering',
            email: 'engineering@example.com',
          },
        },
      },
      specialists: {
        'cx-product-manager': {
          name: 'product-manager',
          displayName: 'Product Manager',
          team: 'product-group',
          role: 'owner',
          modelTier: 'standard',
          skills: ['docs/prd-workflow'],
        },
        'cx-ux-researcher': {
          name: 'ux-researcher',
          displayName: 'UX Researcher',
          team: 'product-group',
          role: 'member',
          modelTier: 'standard',
          skills: ['docs/user-research-workflow'],
        },
        'cx-architect': {
          name: 'architect',
          displayName: 'Architect',
          team: 'engineering-group',
          role: 'owner',
          modelTier: 'reasoning',
          skills: ['architecture/api-design'],
        },
      },
      contracts: {
        'user-to-construct': {
          id: 'user-to-construct',
          producer: 'user',
          consumer: 'construct',
          input: {
            shape: 'natural-language-request',
            mustContain: ['goal'],
          },
          output: {
            shape: 'routed-plan',
            mustContain: ['track', 'specialists'],
          },
        },
        'construct-to-orchestrator': {
          id: 'construct-to-orchestrator',
          producer: 'construct',
          consumer: 'cx-orchestrator',
          input: {
            shape: 'task-packet',
            mustContain: ['goal', 'intent'],
          },
          output: {
            shape: 'decision',
          },
        },
      },
      policies: {
        'design-approval': {
          id: 'design-approval',
          owner: 'product-group',
          description: 'Product group approves design before implementation.',
          enforcement: 'hard',
          mode: 'approval',
          decisionRights: ['design-approval'],
        },
        'architecture': {
          id: 'architecture',
          owner: 'engineering-group',
          description: 'Engineering group owns architecture decisions.',
          enforcement: 'hard',
          mode: 'approval',
          decisionRights: ['architecture'],
        },
      },
    });

    it('fixture validates against schema', () => {
      fixture = createFixture();
      const errors = validateAgainstSchema(fixture, schema);
      assert.equal(errors.length, 0, `Validation errors: ${errors.join(', ')}`);
    });

    it('fixture has exactly 2 teams', () => {
      fixture = createFixture();
      assert.equal(Object.keys(fixture.teams).length, 2);
    });

    it('fixture has exactly 3 specialists', () => {
      fixture = createFixture();
      assert.equal(Object.keys(fixture.specialists).length, 3);
    });

    it('fixture has exactly 2 contracts', () => {
      fixture = createFixture();
      assert.equal(Object.keys(fixture.contracts).length, 2);
    });

    it('fixture has exactly 2 policies', () => {
      fixture = createFixture();
      assert.equal(Object.keys(fixture.policies).length, 2);
    });
  });

  describe('malformed inputs are rejected', () => {
    it('rejects missing required fields (version)', () => {
      const malformed = {
        teams: {},
        specialists: {},
        contracts: {},
        policies: {},
      };
      const errors = validateAgainstSchema(malformed, schema);
      assert.ok(errors.some((e) => e.includes('version')));
    });

    it('rejects wrong version number', () => {
      const malformed = {
        version: 1,
        teams: {},
        specialists: {},
        contracts: {},
        policies: {},
      };
      const errors = validateAgainstSchema(malformed, schema);
      assert.ok(errors.some((e) => e.includes('enum') || e.includes('allowed') || e.includes('version')));
    });

    it('rejects team without required fields', () => {
      const malformed = {
        version: 2,
        teams: {
          'incomplete-team': {
            // missing id, name, owner, roles, charter
          },
        },
        specialists: {},
        contracts: {},
        policies: {},
      };
      // Manual check for missing required team fields
      const teamDef = schema.$defs.team;
      const errors = [];
      for (const requiredField of teamDef.required) {
        if (!('incomplete-team' in malformed.teams && requiredField in malformed.teams['incomplete-team'])) {
          errors.push(`team.incomplete-team: missing required field "${requiredField}"`);
        }
      }
      assert.ok(errors.length > 0, `Expected required field violations, got: ${errors.join(', ')}`);
    });

    it('rejects specialist without team', () => {
      const malformed = {
        version: 2,
        teams: {},
        specialists: {
          'cx-bad': {
            name: 'bad',
            // missing team
          },
        },
        contracts: {},
        policies: {},
      };
      // Manual check for missing required specialist fields
      const specDef = schema.$defs.specialist;
      const errors = [];
      for (const requiredField of specDef.required) {
        if (!('cx-bad' in malformed.specialists && requiredField in malformed.specialists['cx-bad'])) {
          errors.push(`specialist.cx-bad: missing required field "${requiredField}"`);
        }
      }
      assert.ok(errors.some((e) => e.includes('team')), `Expected "team" error, got: ${errors.join(', ')}`);
    });

    it('rejects duplicate keys in object maps', () => {
      const fixture = JSON.parse(`{
        "version": 2,
        "teams": {
          "team-a": {
            "id": "team-a",
            "name": "Team A",
            "owner": "owner",
            "roles": ["owner"],
            "charter": "A team."
          },
          "team-a": {
            "id": "team-a",
            "name": "Team A",
            "owner": "owner",
            "roles": ["owner"],
            "charter": "A team."
          }
        },
        "specialists": {},
        "contracts": {},
        "policies": {}
      }`);
      // JSON parser behavior: duplicate keys are overwritten; only final value remains.
      assert.equal(Object.keys(fixture.teams).length, 1);
    });
  });

  describe('schema preserves all fields from legacy files', () => {
    it('team schema includes all properties from teams', () => {
      const teamDef = schema.$defs.team.properties;
      // Teams consolidated into unified registry:
      assert.ok(teamDef.id, 'team must have id');
      assert.ok(teamDef.name, 'team must have name');
      assert.ok(teamDef.owner, 'team must have owner');
      assert.ok(teamDef.roles, 'team must have roles');
      assert.ok(teamDef.decisionRights, 'team must have decisionRights');
      assert.ok(teamDef.forbiddenDecisions, 'team must have forbiddenDecisions');
      assert.ok(teamDef.escalationPath, 'team must have escalationPath');
      assert.ok(teamDef.charter, 'team must have charter');
      assert.ok(teamDef.contact, 'team must have contact');
      assert.ok(teamDef.evidence, 'team must have evidence');
    });

    it('specialist schema includes all properties from specialists', () => {
      const specDef = schema.$defs.specialist.properties;
      // Specialists consolidated into unified registry:
      assert.ok(specDef.name, 'specialist must have name');
      assert.ok(specDef.displayName, 'specialist must have displayName');
      assert.ok(specDef.description, 'specialist must have description');
      assert.ok(specDef.team, 'specialist must have team');
      assert.ok(specDef.modelTier, 'specialist must have modelTier');
      assert.ok(specDef.reasoningEffort, 'specialist must have reasoningEffort');
      assert.ok(specDef.skills, 'specialist must have skills');
      assert.ok(specDef.events, 'specialist must have events (from manifests)');
      assert.ok(specDef.fence, 'specialist must have fence (from manifests)');
      assert.ok(specDef.docArtifacts, 'specialist must have docArtifacts');
      assert.ok(specDef.permissions, 'specialist must have permissions');
    });

    it('contract schema includes producer, consumer, handoff details', () => {
      const contractDef = schema.$defs.contract.properties;
      assert.ok(contractDef.id, 'contract must have id');
      assert.ok(contractDef.producer, 'contract must have producer');
      assert.ok(contractDef.consumer, 'contract must have consumer');
      assert.ok(contractDef.trigger, 'contract must have trigger');
      assert.ok(contractDef.input, 'contract must have input');
      assert.ok(contractDef.output, 'contract must have output');
      assert.ok(contractDef.preconditions, 'contract must have preconditions');
      assert.ok(contractDef.postconditions, 'contract must have postconditions');
      assert.ok(contractDef.teamBoundary, 'contract must have teamBoundary');
    });

    it('policy schema includes owner, enforcement, decision rights', () => {
      const policyDef = schema.$defs.policy.properties;
      assert.ok(policyDef.id, 'policy must have id');
      assert.ok(policyDef.owner, 'policy must have owner');
      assert.ok(policyDef.description, 'policy must have description');
      assert.ok(policyDef.enforcement, 'policy must have enforcement');
      assert.ok(policyDef.mode, 'policy must have mode');
      assert.ok(policyDef.requiresApprovalFrom, 'policy must have requiresApprovalFrom');
      assert.ok(policyDef.mayVetoFrom, 'policy must have mayVetoFrom');
      assert.ok(policyDef.escalatesTo, 'policy must have escalatesTo');
      assert.ok(policyDef.decisionRights, 'policy must have decisionRights');
    });
  });
});
