/**
 * lib/prompt-validation-contract.mjs — Inline shared validation contract at sync time.
 *
 * Prepends specialists/prompts/_shared/validation-contract.md to every cx-* prompt
 * so assume-nothing discipline is present at runtime without 29 copy-paste edits.
 */

import fs from 'node:fs';
import path from 'node:path';

const MARKER = '<!-- cx:validation-contract -->';

export function readValidationContract(root) {
  const p = path.join(root, 'specialists', 'prompts', '_shared', 'validation-contract.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim();
}

export function inlineValidationContract(prompt, root, agentName = '(unknown)') {
  if (!prompt || prompt.includes(MARKER)) return prompt;
  const block = readValidationContract(root);
  if (!block) return prompt;
  return `${MARKER}\n\n${block}\n\n${prompt}`;
}
