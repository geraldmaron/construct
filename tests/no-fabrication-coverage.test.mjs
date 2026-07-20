/**
 * tests/no-fabrication-coverage.test.mjs — Worker Profile prompt anti-fabrication ratchet.
 *
 * Every registry Worker Profile prompt and the construct front-door prompt must
 * reference rules/common/no-fabrication.md with a role-tailored contract paragraph.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const promptsDir = path.join(root, 'registry', 'worker-profiles', 'prompts');
const policyPath = path.join(root, 'rules', 'common', 'no-fabrication.md');
const constructPromptPath = path.join(promptsDir, 'construct.md');

function listWorkerProfilePrompts() {
  return fs.readdirSync(promptsDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => path.join(promptsDir, name));
}

describe('no-fabrication coverage', () => {
  it('the canonical policy file exists', () => {
    assert.ok(fs.existsSync(policyPath), `${policyPath} must exist as the canonical anti-fabrication policy`);
  });

  it('the construct Worker Profile prompt references the no-fabrication policy', () => {
    const text = fs.readFileSync(constructPromptPath, 'utf8');
    assert.match(
      text,
      /Anti-fabrication contract/,
      'registry/worker-profiles/prompts/construct.md must contain an "Anti-fabrication contract" paragraph',
    );
    assert.match(
      text,
      /rules\/common\/no-fabrication\.md/,
      'construct prompt must link to the canonical policy file',
    );
  });

  it('every Worker Profile prompt declares an Anti-fabrication contract', () => {
    const prompts = listWorkerProfilePrompts().filter((file) => path.basename(file) !== 'construct.md');
    assert.ok(prompts.length >= 11, `expected at least 11 worker prompts, found ${prompts.length}`);

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
      `these Worker Profile prompts lack an Anti-fabrication contract:\n${missing.join('\n')}`,
    );
  });

  it('every Anti-fabrication contract links to the canonical policy file', () => {
    const prompts = listWorkerProfilePrompts().filter((file) => path.basename(file) !== 'construct.md');
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
      `these contracts don't link to the canonical policy:\n${missingLink.join('\n')}`,
    );
  });

  it('every contract is role-tailored, not boilerplate-copy', () => {
    const prompts = listWorkerProfilePrompts().filter((file) => path.basename(file) !== 'construct.md');
    const contracts = new Map();
    for (const file of prompts) {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/(?:\*\*Anti-fabrication contract\*\*:|## Anti-fabrication contract\n\n)([\s\S]*?)(?=\n\n)/);
      if (!match) continue;
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
      `these Worker Profile contracts are byte-identical:\n${duplicates.map(([a, b]) => `  ${a} == ${b}`).join('\n')}`,
    );
  });
});
