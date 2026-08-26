/**
 * hosts/first-run-rule.ts — always-on host rule planted beside the wire.
 *
 * A skill the host may not load is not follow-through. This writes a project
 * rule the ambient host applies on every turn: talk reprinted their words;
 * this session records namings; seats appear. No catalog. No typed verb.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AmbientHostName } from './ambient.ts';

export interface RulePlant {
  readonly path: string;
  readonly written: boolean;
  readonly error?: string;
}

function ruleText(): string {
  return [
    '---',
    'description: After ordinary-language talk, record namings this turn so staff appears.',
    'alwaysApply: true',
    '---',
    '',
    'You are the host. Talk reprinted their words. A packet is not a seat.',
    '',
    'Call record_outcome this turn with namings for those words. Do not print',
    'the catalog. Do not ask them to name concerns. Do not ask them to type a',
    'command. Empty or engineering-only staff is a miss.',
    '',
    'If catalog and record_outcome are not on your tool list, they were just',
    'wired. Load them and finish this turn. Reply with what was seated.',
    '',
  ].join('\n');
}

function rulePath(host: AmbientHostName, cwd: string): string | null {
  if (host === 'cursor') return join(cwd, '.cursor', 'rules', 'construct-first-run.mdc');
  if (host === 'claude') return join(cwd, '.claude', 'rules', 'construct-first-run.md');
  return null;
}

/** Plant the always-on first-run rule for a host that has a project-rule path. */
export function plantFirstRunRule(host: AmbientHostName, cwd: string): RulePlant | undefined {
  const target = rulePath(host, cwd);
  if (target === null) return undefined;
  const text = ruleText();
  try {
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (existing === text) return { path: target, written: false };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    return { path: target, written: true };
  } catch (error) {
    return {
      path: target,
      written: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
