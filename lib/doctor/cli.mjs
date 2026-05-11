/**
 * lib/doctor/cli.mjs — `construct doctor` handler.
 *
 * Subcommands:
 *   status       — show running state + last tick per watcher
 *   watch        — run the daemon in foreground (debugging)
 *   stop         — send SIGTERM to a running daemon
 *   logs         — print recent audit log entries (default 50; --watcher=X to filter)
 *   tick         — run all watchers once and exit (useful in tests)
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { readState } from './index.mjs';
import { recent } from './audit.mjs';

function fmtTime(ts) {
  if (!ts) return '(never)';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function ageStr(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export async function runCli(args) {
  const sub = args[0] || 'status';

  if (sub === 'status') {
    const state = readState();
    if (!state) { console.log('doctor: not running'); return 0; }
    console.log(`doctor: running (pid ${state.pid}, started ${fmtTime(state.startedAt)})`);
    console.log(`state updated: ${fmtTime(state.updatedAt)} (${ageStr(state.updatedAt)})`);
    console.log('watchers:');
    for (const name of (state.watchers || [])) {
      const last = recent({ watcher: name, limit: 1 })[0];
      console.log(`  ${name.padEnd(20)} last entry: ${last ? fmtTime(last.ts) + ' (' + ageStr(last.ts) + ')' : '(none yet)'}`);
    }
    return 0;
  }

  if (sub === 'logs') {
    const watcherArg = args.find((a) => a.startsWith('--watcher='))?.split('=')[1];
    const limitArg = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '50', 10);
    const entries = recent({ watcher: watcherArg, limit: limitArg });
    if (entries.length === 0) { console.log('no audit entries'); return 0; }
    for (const e of entries.reverse()) {
      const action = e.action ? `${e.action}` : e.kind;
      const tgt = e.target ? ` [${e.target}]` : '';
      console.log(`${fmtTime(e.ts)}  ${e.watcher.padEnd(18)} ${action.padEnd(12)}${tgt}  ${e.result || ''}  ${e.summary || ''}`);
    }
    return 0;
  }

  if (sub === 'stop') {
    const state = readState();
    if (!state) { console.log('doctor: not running'); return 0; }
    try { process.kill(state.pid, 'SIGTERM'); console.log(`doctor: SIGTERM sent to pid ${state.pid}`); return 0; }
    catch (err) { console.error(`failed to signal pid ${state.pid}: ${err.message}`); return 1; }
  }

  if (sub === 'watch') {
    process.env.CONSTRUCT_DOCTOR_VERBOSE = '1';
    const { start } = await import('./index.mjs');
    await start();
    return new Promise(() => { /* daemon loop runs until signal */ });
  }

  if (sub === 'tick') {
    const watchers = await Promise.all([
      import('./watchers/disk.mjs'),
      import('./watchers/cost.mjs'),
      import('./watchers/process-pressure.mjs'),
      import('./watchers/service-health.mjs'),
    ]);
    for (const w of watchers) {
      const r = await w.tick();
      console.log(`${w.name.padEnd(20)} actions=${r.actions?.length || 0} escalations=${r.escalations?.length || 0}`);
    }
    return 0;
  }

  console.error(`Unknown doctor subcommand: ${sub}`);
  console.error('Usage: construct doctor [status|watch|stop|logs|tick]');
  return 2;
}
