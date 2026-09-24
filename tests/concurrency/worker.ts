/**
 * tests/concurrency/worker.ts — one OS process in a contention run. It loads
 * the command line once and runs `work add` a given number of times against
 * the project in its working directory, then prints how each call exited.
 *
 * Loading once and looping keeps the run about lock contention between
 * processes rather than about Node start-up time.
 */

import { run } from '../../src/cli/index.ts';

const [label = 'w', countText = '10'] = process.argv.slice(2);
const count = Number(countText);
const exits: number[] = [];
const quiet = (): boolean => true;
process.stdout.write = quiet as typeof process.stdout.write;
const stderr: string[] = [];
const originalErr = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array) => {
  stderr.push(String(chunk));
  return true;
}) as typeof process.stderr.write;

for (let i = 0; i < count; i += 1) {
  exits.push(await run(['work', 'add', `${label}-${String(i)}`]));
}
originalErr(`${JSON.stringify({ label, exits, locked: stderr.filter((l) => /locked|busy/i.test(l)).length })}\n`);
