/**
 * lib/cli/directives.mjs — `construct directives` CLI handler.
 *
 * Read-only visibility into construct.config.json's `directives[]` and
 * their due status (lib/directives/due-tracker.mjs). Nothing here executes
 * a directive — lib/embed/daemon.mjs's "directive-runner" job only ever
 * records that one is due; actual execution is oracle-side wiring
 * (lib/oracle/execute.mjs's directive-execution branch), not this CLI.
 */

import { loadProjectConfig } from '../config/project-config.mjs';
import { validateDirective, validateDirectives, resolveEffectiveDirectivesFromConfig } from '../directives/directive-config.mjs';
import { readDirectiveState, isDirectiveDue } from '../directives/due-tracker.mjs';

/**
 * @param {string[]} args
 * @param {object} ctx
 * @param {string} ctx.rootDir
 * @param {object} ctx.env
 * @param {Function} ctx.println
 * @param {Function} ctx.errorln
 * @returns {number} exit code
 */
export async function runDirectivesCli(args, { rootDir, env, println, errorln }) {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    println('Usage: construct directives <list|status>');
    println('');
    println('Subcommands:');
    println('  list          List configured directives and their due status');
    println('  status <id>   Show full status of a specific directive');
    println('');
    println('Directives are standing instructions; this CLI is read-only. A due');
    println('directive is surfaced by the embed daemon as an observation and a');
    println('stderr line — nothing here executes one.');
    return 0;
  }

  const { config } = loadProjectConfig(rootDir, env);
  const rawDirectives = config?.directives ?? [];
  const configErrors = validateDirectives(rawDirectives);
  const directives = resolveEffectiveDirectivesFromConfig(config);

  if (sub === 'list') {
    if (configErrors.length) {
      errorln('directives config errors:');
      for (const err of configErrors) errorln(`  ${err}`);
    }
    if (directives.length === 0) {
      println('No directives configured.');
      return 0;
    }
    for (const directive of directives) {
      const state = readDirectiveState(rootDir, directive.id);
      const due = isDirectiveDue(directive, state);
      println(`${directive.id}`);
      println(`  provider:    ${directive.provider}`);
      println(`  specialist:  ${directive.specialist}`);
      println(`  action:      ${directive.action}`);
      println(`  trigger:     ${directive.trigger?.kind}${directive.trigger?.kind === 'interval' ? ` (every ${directive.trigger.intervalMinutes}m)` : ''}`);
      println(`  autoRun:     ${directive.autoRun}`);
      println(`  lastRunAt:   ${state.lastRunAt ?? 'never'}`);
      println(`  due:         ${due}`);
      println('');
    }
    return 0;
  }

  if (sub === 'status') {
    const id = args[1];
    if (!id) {
      errorln('Usage: construct directives status <id>');
      return 1;
    }
    const directive = directives.find((d) => d.id === id);
    if (!directive) {
      errorln(`Directive not found: ${id}`);
      return 1;
    }
    const shapeErrors = validateDirective(directive, 0);
    const state = readDirectiveState(rootDir, id);
    println(JSON.stringify({
      directive,
      state,
      due: isDirectiveDue(directive, state),
      shapeErrors,
    }, null, 2));
    return 0;
  }

  errorln(`Unknown directives subcommand: ${sub}. Available: list, status`);
  return 1;
}
