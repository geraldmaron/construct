/**
 * lib/mermaid-interactive.mjs — Mermaid interactive renderer contract + Diagram Cards.
 *
 * Re-exports hardened browser defaults from packages/construct-ui and validates Diagram
 * Card provenance for client-side Mermaid renders (construct-tsyfe.4.2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDiagramCard } from './diagram-card.mjs';
import {
  MERMAID_DEGRADED_TIMEOUT,
  MERMAID_DEGRADED_TOO_LARGE,
  MERMAID_HAND_DRAWN_SEED,
  MERMAID_MAX_SOURCE_CHARS,
  MERMAID_PINNED_VERSION,
  MERMAID_SECURITY_PROFILE,
  assertMermaidComponentHardened,
  assessMermaidSource,
  buildInteractiveMermaidDiagramCard,
  buildMermaidInitializeConfig,
  sanitizeMermaidSvg,
  withRenderTimeout,
} from '../packages/construct-ui/mermaid-interactive.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MERMAID_COMPONENT_PATH = path.join(REPO_ROOT, 'packages', 'construct-ui', 'components', 'mermaid.tsx');
const DOCS_PACKAGE_JSON = path.join(REPO_ROOT, 'apps', 'docs', 'package.json');

export {
  MERMAID_DEGRADED_TIMEOUT,
  MERMAID_DEGRADED_TOO_LARGE,
  MERMAID_HAND_DRAWN_SEED,
  MERMAID_MAX_SOURCE_CHARS,
  MERMAID_PINNED_VERSION,
  MERMAID_SECURITY_PROFILE,
  assertMermaidComponentHardened,
  assessMermaidSource,
  buildInteractiveMermaidDiagramCard,
  buildMermaidInitializeConfig,
  sanitizeMermaidSvg,
  withRenderTimeout,
};

export function buildValidatedInteractiveMermaidDiagramCard(input = {}) {
  const card = buildInteractiveMermaidDiagramCard(input);
  const result = validateDiagramCard(card);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return card;
}

export function readMermaidComponentSource() {
  return fs.readFileSync(MERMAID_COMPONENT_PATH, 'utf8');
}

export function readDocsMermaidVersionPin() {
  const pkg = JSON.parse(fs.readFileSync(DOCS_PACKAGE_JSON, 'utf8'));
  const declared = pkg.dependencies?.mermaid ?? '';
  const exactPin = /^\d+\.\d+\.\d+$/.test(declared);
  return { declared, exactPin, pinnedVersion: exactPin ? declared : null };
}

export function assertDocsMermaidVersionPinned() {
  const { declared, exactPin } = readDocsMermaidVersionPin();
  if (!exactPin) {
    return {
      ok: false,
      errors: [`apps/docs/package.json mermaid dependency must be exact pin, got "${declared}"`],
    };
  }
  return { ok: true, errors: [] };
}
