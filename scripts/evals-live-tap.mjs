#!/usr/bin/env node
/**
 * evals-live-tap.mjs — a stdio tap between a host and the MCP server it
 * starts: `evals-live-tap.mjs <log> <command> [args...]`.
 *
 * It starts the real server, relays bytes both ways unchanged, and appends
 * one JSON line per newline-delimited frame, decoded as UTF-8, to <log>: {t, dir, line}, with
 * dir host->server or server->host. Its first line, {t, dir: "tap", launch},
 * names the command it started, so a run can prove which server it measured.
 * The tap needs no change to the server and reads every host the same way.
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const [log, command, ...args] = process.argv.slice(2);
if (!log || !command) {
  process.stderr.write('usage: evals-live-tap.mjs <log> <command> [args...]\n');
  process.exit(2);
}

appendFileSync(log, `${JSON.stringify({ t: Date.now(), dir: 'tap', launch: [command, ...args] })}\n`);
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });

/** One direction's logger: its own decoder, so a character split across chunks is logged whole. */
function framer(dir) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return (chunk) => {
    buffer += decoder.write(chunk);
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) appendFileSync(log, `${JSON.stringify({ t: Date.now(), dir, line })}\n`);
    }
  };
}

// A side that closes first ends the relay; a write into it is not an error.
child.stdin.on('error', () => {});
process.stdout.on('error', () => {});

const up = framer('host->server');
const down = framer('server->host');
process.stdin.on('data', (chunk) => {
  up(chunk);
  child.stdin.write(chunk);
});
process.stdin.on('end', () => child.stdin.end());
child.stdout.on('data', (chunk) => {
  down(chunk);
  process.stdout.write(chunk);
});
child.on('error', (error) => {
  process.stderr.write(`tap: could not start ${command}: ${error.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
