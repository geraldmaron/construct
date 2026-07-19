/**
 * tests/no-fabrication-coverage.test.mjs — every specialist prompt and the
 * construct persona must reference the canonical no-fabrication rule.
 *
 * The rule lives at rules/common/no-fabrication.md. Prompts are expected to
 * include an "Anti-fabrication contract" paragraph tailored to the role's
 * fabrication risk, ending with a reference to the canonical file. This test
 * prevents new specialists or persona revisions from silently shipping
 * without the rule.
 *
 * The test is intentionally strict: every specialist must (a) name a role-
 * specific risk and (b) reference rules/common/no-fabrication.md. The
 * regression we're guarding against is the failure mode where someone adds a
 * new specialist or rewrites an existing one and the contract gets dropped.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const promptsDir = path.join(root, 'specialists', 'prompts');
const policyPath = path.join(root, 'rules', 'common', 'no-fabrication.md');
const personaPath = path.join(root, 'personas', 'construct.md');

function listSpecialistPrompts() {
  return fs.readdirSync(promptsDir)
    .filter((name) => name.startsWith('cx-') && name.endsWith('.md'))
    .map((name) => path.join(promptsDir, name));
}

describe('no-fabrication coverage', () => {
  it('the canonical policy file exists', () => {
    assert.ok(fs.existsSync(policyPath), `${policyPath} must exist as the canonical anti-fabrication policy`);
  });

  it('the construct persona references the no-fabrication policy', () => {
    const text = fs.readFileSync(personaPath, 'utf8');
    assert.match(
      text,
      /Anti-fabrication contract/,
      'registry/worker-profiles/prompts/construct.md must contain an "Anti-fabrication contract" paragraph',
    );
    assert.match(
      text,
      /rules\/common\/no-fabrication\.md/,
      'persona must link to the canonical policy file',
    );
  });

  it('every cx-* specialist prompt declares an Anti-fabrication contract', () => {
    const prompts = listSpecialistPrompts();
    // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
    assert.ok(prompts.length >= 12, `expected at least 12 specialist prompts, found ${prompts.length}`);

    const missing = [];
    for (const file of prompts) {
      const text = fs.readFileSync(file, 'utf8');
      if (!/Anti-fabrication contract/.test(text)) {
        missing.push(path.relative(root, file));
      }
    }
    assert.deepEqual(
      missing,
      [],
      `these specialists lack an Anti-fabrication contract — every cx-* prompt must declare one tailored to the role's fabrication risk and link to rules/common/no-fabrication.md:\n${missing.join('\n')}`,
    );
  });

  it('every Anti-fabrication contract links to the canonical policy file', () => {
    const prompts = listSpecialistPrompts();
    const missingLink = [];
    for (const file of prompts) {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/(?:\*\*Anti-fabrication contract\*\*:|## Anti-fabrication contract[^\n]*\n\n)([\s\S]*?)(?=\n\n)/);
      if (!match) {
        missingLink.push(`${path.relative(root, file)} (no contract paragraph found at all)`);
        continue;
      }
      if (!/rules\/common\/no-fabrication\.md/.test(match[0])) {
        missingLink.push(`${path.relative(root, file)} (contract present but no policy link)`);
      }
    }
    assert.deepEqual(
      missingLink,
      [],
      `these contracts don't link to the canonical policy — every contract must end with "See \`rules/common/no-fabrication.md\`.":\n${missingLink.join('\n')}`,
    );
  });

  it('every contract is role-tailored, not boilerplate-copy', () => {
    // Boilerplate detection: any two byte-identical specialist contracts fail.
    // The persona contract is exempt (umbrella; specialists tailor from it).

    const prompts = listSpecialistPrompts();
    const contracts = new Map();
    for (const file of prompts) {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/(?:\*\*Anti-fabrication contract\*\*:|## Anti-fabrication contract\n\n)([\s\S]*?)(?=\n\n)/);
      if (!match) continue;
      // Normalize whitespace for comparison
      const normalized = match[1].replace(/\s+/g, ' ').trim();
      contracts.set(path.basename(file), normalized);
    }

    const duplicates = [];
    const entries = [...contracts.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i][1] === entries[j][1]) {
          duplicates.push([entries[i][0], entries[j][0]]);
        }
      }
    }
    assert.deepEqual(
      duplicates,
      [],
      `these specialist contracts are byte-identical — each role must name its own fabrication risk:\n${duplicates.map(([a, b]) => `  ${a} == ${b}`).join('\n')}`,
    );
  });
});
