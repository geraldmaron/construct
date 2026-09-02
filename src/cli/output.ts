/**
 * cli/output.ts — how the CLI talks: one line at a time, escaped for the
 * screen, the record as JSON when asked, and failures that lead with the
 * problem and then the safe next step. Stack traces appear only with --debug.
 */

import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { ProjectFileError, UnsupportedProjectFileError } from '../kernel/project/files.ts';
import { LegacyProjectError } from '../kernel/project/initialize.ts';
import { NoProjectError } from '../kernel/project/discover.ts';
import { ResetNotConfirmedError } from '../kernel/project/reset.ts';
import { UnsupportedStateError } from '../kernel/state/format.ts';

export const esc = escapeForTerminal;

export function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function warn(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** The command line was wrong before anything ran. Exit code 2. */
export class UsageError extends Error {
  readonly usage: string;

  constructor(message: string, usage = '') {
    super(message);
    this.name = 'UsageError';
    this.usage = usage;
  }
}

/** The command ran and could not complete. Exit code 1. */
export class OperationError extends Error {
  readonly next: string | null;

  constructor(message: string, next: string | null = null) {
    super(message);
    this.name = 'OperationError';
    this.next = next;
  }
}

function nextStepFor(error: unknown): string | null {
  if (error instanceof OperationError) return error.next;
  if (error instanceof NoProjectError) return null; // its message already says
  if (error instanceof LegacyProjectError) return null;
  if (error instanceof UnsupportedStateError) return null;
  if (error instanceof UnsupportedProjectFileError) return null;
  if (error instanceof ResetNotConfirmedError) return 'Run `construct reset` without --confirm to see the exact targets, then confirm them.';
  if (error instanceof ProjectFileError) return 'Fix the file, or run `construct project validate` to see every problem at once.';
  return null;
}

/** Print a failure for a person and return the exit code. */
export function reportFailure(command: string, error: unknown, debug: boolean): number {
  if (error instanceof UsageError) {
    warn(`construct ${command}: ${esc(error.message)}`);
    if (error.usage) process.stderr.write(error.usage);
    return 2;
  }
  const message = error instanceof Error ? error.message : String(error);
  warn(`construct ${command}: ${esc(message)}`);
  const next = nextStepFor(error);
  if (next) warn(`  next: ${esc(next)}`);
  if (debug && error instanceof Error && error.stack) warn(error.stack);
  return 1;
}
