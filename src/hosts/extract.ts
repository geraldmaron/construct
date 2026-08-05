/**
 * hosts/extract.ts — the executing half of the extraction ladder.
 *
 * The kernel PLANS (kernel/extract/ladder.ts): given routing signals, it
 * returns the rungs to attempt and the rule for accepting each. This module
 * EXECUTES: it probes the environment, reads files, and runs providers. The
 * split is what keeps the decision layer testable, so nothing here re-decides
 * routing — an unplanned rung is never attempted, and a planned rung this
 * host cannot run is reported, not skipped silently.
 *
 * Docling is admitted only behind a probe. No dependency lands on assertion:
 * the probe asks the installed binary to identify itself, and only a probe
 * that answered makes the docling rung plannable at all. When the probe
 * fails, the caller states the fallback path out loud (the work log carries
 * it) instead of quietly degrading.
 *
 * Provider coverage is honest rather than aspirational: this host runs the
 * `sync` rung (native UTF-8 text) itself and the `docling-local` rung through
 * the probed binary. The remaining providers (unpdf, mammoth, whisper, email,
 * docling-remote) are not bundled — the package ships zero dependencies — so
 * a plan that reaches only those rungs reports the ladder's own remediation
 * text rather than pretending a parser exists.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { planExtraction } from '../kernel/extract/ladder.ts';
import type { ExtractionPlan } from '../kernel/extract/ladder.ts';

/** A minimal subprocess seam so tests inject outcomes instead of binaries. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
) => { readonly status: number | null; readonly stdout: string; readonly stderr: string };

function defaultRunner(
  command: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
  try {
    const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 60_000 });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    return { status: null, stdout: '', stderr: (error as Error).message };
  }
}

export interface DoclingProbe {
  readonly available: boolean;
  /** What the binary reported, kept for the record. Null when unavailable. */
  readonly version: string | null;
  /** The probe's evidence either way, in words a work log can carry. */
  readonly detail: string;
}

/**
 * Ask the installed Docling to identify itself. The probe is the admission
 * gate: only an answer here makes the docling rung plannable.
 */
export function probeDocling(run: CommandRunner = defaultRunner): DoclingProbe {
  const result = run('docling', ['--version']);
  if (result.status === 0 && result.stdout.trim() !== '') {
    const version = result.stdout.trim().split('\n')[0] ?? '';
    return { available: true, version, detail: `docling responded: ${version}` };
  }
  return {
    available: false,
    version: null,
    detail:
      result.status === null
        ? `docling not found on PATH (${result.stderr.trim() || 'spawn failed'})`
        : `docling --version exited ${String(result.status)}`,
  };
}

export type SourceRead =
  | {
      readonly ok: true;
      readonly text: string;
      /** Which rung produced the text, for the record. */
      readonly tier: string;
      readonly method: string | null;
    }
  | {
      readonly ok: false;
      /** Why nothing could be read, in the ladder's own words. */
      readonly reason: string;
      /** What would make it readable, when the ladder names one. */
      readonly remediation: string | null;
    };

export interface ReadSourceOptions {
  /** Injected probe result; callers probe once and reuse. */
  readonly docling?: DoclingProbe;
  readonly run?: CommandRunner;
  readonly readFile?: (file: string) => string;
}

/**
 * Read one source file through the planned ladder. Every outcome is typed:
 * text with the rung that produced it, or a refusal carrying the ladder's own
 * reason and remediation — never garbage bytes passed downstream as prose.
 */
export function readSource(file: string, options: ReadSourceOptions = {}): SourceRead {
  const docling = options.docling ?? { available: false, version: null, detail: 'not probed' };
  const run = options.run ?? defaultRunner;
  const read = options.readFile ?? ((f: string) => readFileSync(f, 'utf8'));

  const plan: ExtractionPlan = planExtraction({
    extension: extname(file).toLowerCase(),
    syncExtractAvailable: true,
    doclingLocalAvailable: docling.available,
    platform: process.platform,
  });

  if (plan.unavailable) {
    return { ok: false, reason: plan.unavailable.message, remediation: null };
  }

  for (const step of plan.steps) {
    if (step.provider === 'sync') {
      try {
        return { ok: true, text: read(file), tier: step.tier, method: step.method ?? null };
      } catch (error) {
        return { ok: false, reason: `cannot read ${file} — ${(error as Error).message}`, remediation: null };
      }
    }
    if (step.provider === 'docling-local') {
      const result = run('docling', [file, '--to', 'md', '--output', '-']);
      if (result.status === 0 && result.stdout.trim() !== '') {
        return { ok: true, text: result.stdout, tier: step.tier, method: step.method ?? null };
      }
      // A probed-available docling that then fails is reported, not retried
      // into a lie; the ladder's exhaustion text carries the remediation.
      continue;
    }
    // Providers this host does not bundle: fall through to exhaustion.
  }

  const exhausted = plan.exhausted;
  return {
    ok: false,
    reason: exhausted?.reason ?? `no runnable extraction rung for ${extname(file) || 'this file'}`,
    remediation: exhausted?.remediation ?? null,
  };
}
