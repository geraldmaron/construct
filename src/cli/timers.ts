/**
 * cli/timers.ts — the platform timers this machine holds for Construct
 * triggers: where they live, the facts a unit is written from, and the
 * report status and doctor give. Installing and removing stay in
 * `workflow install-timer` and `workflow remove-timer`; this module only
 * resolves and reads.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findOnPath } from '../hosts/presence.ts';
import { LAUNCHER } from '../hosts/wiring/clients.ts';
import {
  listTimers,
  platformScheduler,
  systemTimezone,
  timerPathFor,
  timerPlatformFor,
  type InstalledTimer,
  type SchedulerControl,
  type TimerTarget,
} from '../hosts/timer.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { resolveAccountScheduleDir, resolveScheduleDir } from '../kernel/paths.ts';
import { getTrigger } from '../kernel/state/triggers.ts';
import type { StateStore } from '../kernel/state/open.ts';
import { TIMER_ENV_KEYS, type TimerFacts } from '../kernel/workflow/timer-unit.ts';
import type { CliContext } from './context.ts';

export interface TimerSetup {
  readonly target: TimerTarget;
  readonly control: SchedulerControl;
  readonly systemTimezone: string;
  readonly launcher: string;
}

/** Where this machine's timers live, from the command's own env; null on a platform with no per-user scheduler. */
export function timerSetup(ctx: CliContext): TimerSetup | null {
  const platform = ctx.timers?.platform ?? process.platform;
  const kind = timerPlatformFor(platform);
  const dir = resolveScheduleDir(platform, ctx.env);
  if (!kind || !dir) return null;
  return {
    target: { platform: kind, dir },
    control: ctx.timers?.control ?? platformScheduler(resolveAccountScheduleDir(platform), process.getuid?.() ?? -1),
    systemTimezone: ctx.timers?.systemTimezone ?? systemTimezone(),
    launcher: ctx.timers?.launcher ?? LAUNCHER,
  };
}

/** The non-secret facts a unit is written from. Only PATH and the executor's own home variable leave the shell. */
export function timerFacts(ctx: CliContext, setup: TimerSetup, projectId: string, executor: string): TimerFacts {
  const env: Record<string, string> = {};
  for (const key of TIMER_ENV_KEYS) {
    if (key === 'PATH') continue;
    const value = ctx.env[key];
    if (value && value.trim()) env[key] = value;
  }
  return {
    projectId,
    node: process.execPath,
    launcher: setup.launcher,
    path: timerPathFor(process.execPath, findOnPath(executor, ctx.env)),
    logDir: join(ctx.paths.stateDir, 'timers'),
    systemTimezone: setup.systemTimezone,
    env,
  };
}

export interface TimerRow extends InstalledTimer {
  /** True for a unit that belongs to the project the command runs in. */
  readonly here: boolean;
  /** Whether the scheduler will fire it (loaded on launchd, active and enabled on systemd); null when it cannot be asked. */
  readonly firing: boolean | null;
  /** False for another project's unit: its trigger lives in that project's store, which this command does not open. */
  readonly triggerChecked: boolean;
  /** Why the unit would not fire as intended; null when nothing is wrong. */
  readonly problem: string | null;
}

/**
 * Every Construct timer on this machine, each checked against the project it
 * names: a project that moved or is gone, or a trigger that was removed or
 * disabled, is a unit that will fire into nothing.
 */
export function timerRows(
  ctx: CliContext,
  here: { readonly id: string | null; readonly root: string; readonly store: StateStore | null },
): TimerRow[] {
  const setup = timerSetup(ctx);
  if (!setup) return [];
  return listTimers(setup.target).map((t) => {
    const isHere = here.id !== null && t.projectId === here.id;
    let problem: string | null = null;
    const missing = t.program.find((p) => !existsSync(p));
    if (t.program.length < 2 || missing)
      problem = `the program it starts, ${missing ?? '(unreadable)'}, no longer exists (Node or Construct moved); install the timer again from its project`;
    else if (!t.projectRoot || !existsSync(t.projectRoot))
      problem = `its project directory ${t.projectRoot ?? '(unnamed)'} no longer exists`;
    else {
      let id: string | null = null;
      try {
        id = readProjectFiles(t.projectRoot).config?.id ?? null;
      } catch {
        id = null;
      }
      if (id !== t.projectId) problem = `${t.projectRoot} is no longer project ${t.projectId}`;
      else if (isHere && here.store) {
        const trigger = getTrigger(here.store, t.triggerId);
        if (!trigger) problem = `trigger ${t.triggerId} no longer exists`;
        else if (!trigger.enabled) problem = `trigger ${t.triggerId} is disabled, so every firing is recorded and skipped`;
      }
    }
    let firing: boolean | null = null;
    try {
      firing = setup.control.firing(setup.target, t.label);
    } catch (error) {
      problem ??= (error as Error).message;
    }
    if (!problem && firing === false) problem = 'its file is installed but the scheduler will not fire it';
    return { ...t, here: isHere, firing, triggerChecked: isHere && here.store !== null, problem };
  });
}

export function describeTimer(t: TimerRow): string {
  const state = [t.firing === null ? '' : t.firing ? 'firing' : 'not firing', t.triggerChecked ? '' : 'trigger state unchecked from here']
    .filter(Boolean)
    .join(', ');
  return `${t.label} (trigger ${t.triggerId}${t.executor ? `, executor ${t.executor}` : ''}${state ? `, ${state}` : ''})${t.problem ? `: ${t.problem}; \`construct workflow remove-timer ${t.label}\` removes it` : ''}`;
}
