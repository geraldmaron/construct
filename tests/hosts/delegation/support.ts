import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshStore } from '../../kernel/state/support.ts';
import { commandFor, type DelegationConfig } from '../../../src/hosts/delegation/adapters.ts';
import type { Execution, Executor } from '../../../src/kernel/delegation/types.ts';

export function repository() {
  const state = freshStore();
  const home = join(state.root, 'home');
  const root = join(state.root, 'repo');
  mkdirSync(home);
  mkdirSync(join(root, 'src'), { recursive: true });
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: process.env.PATH, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.data'), XDG_STATE_HOME: join(home, '.state'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  writeFileSync(join(root, 'src/value.txt'), 'base\n');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture base');
  const execution: Execution = {
    version: 1, id: 'fixture-execution', childWorkId: 'child', leadSession: 'lead', workerSession: 'worker', target: root, machine: 'fixture', model: 'fixture-model', signature: 'signature',
    assignment: { workId: 'parent', requestKey: 'request', executor: 'codex', role: 'implement', instructions: 'edit', paths: ['src/'], acceptance: ['file is correct'], couplingKeys: [], timeoutMs: 5000 },
    repairCycle: 0, createdAt: '2026-09-27T12:00:00.000Z', updatedAt: '2026-09-27T12:00:00.000Z', state: 'running', supervisorPid: null, groupPid: null, snapshot: null, artifact: null, result: null, dispositions: [], reason: null, validation: [],
  };
  return { ...state, home, root, env, git, execution, artifactsDir: join(state.root, 'artifacts') };
}

export function fakeExecutor(fixture: ReturnType<typeof repository>, executor: Executor): DelegationConfig {
  const binary = join(fixture.home, `fixture-${executor}`);
  const source = `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('fixture-1'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true, authMethod:'claude.ai'})); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (args[0] === 'status') { console.log(JSON.stringify({status:'authenticated', isAuthenticated:true, hasAccessToken:true, hasRefreshToken:true, userInfo:{}})); process.exit(0); }
let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
if (input.instructions === 'hang') { setInterval(() => {}, 1000); }
else if (input.instructions === 'malformed') console.log('not json');
else if (input.instructions === 'denied') console.log(JSON.stringify({type:'result', permission_denials:[{tool:'Write'}], result:'denied'}));
else if (input.instructions === 'quota') console.log(JSON.stringify({type:'error', message:'quota exhausted'}));
else {
  const path = input.paths.includes('README.md') ? 'README.md' : 'src/value.txt';
  const content = readFileSync(join(process.cwd(), path), 'utf8').trim();
  const patch = input.role === 'implement' ? 'diff --git a/' + path + ' b/' + path + '\\n--- a/' + path + '\\n+++ b/' + path + '\\n@@ -1 +1 @@\\n-' + content + '\\n+worker\\n' : '';
  const result = JSON.stringify({state:'succeeded', summary:'fixture complete', patch, findings:[]});
  if (args[0] === 'exec') {
    console.log(JSON.stringify({type:'item.completed', item:{type:'agent_message', text:result}}));
    console.log(JSON.stringify({type:'turn.completed', usage:{input_tokens:1, output_tokens:1}}));
  } else console.log(JSON.stringify({type:'result', result}));
}
`;
  writeFileSync(binary, source, { mode: 0o700 });
  const receipt = join(fixture.home, `receipt-${executor}.json`);
  writeFileSync(receipt, JSON.stringify({ executor, version: 'fixture-1', model: 'fixture-model', checkedAt: '2026-09-26T12:00:00.000Z', subscriptionOnly: true,
    binarySha256: createHash('sha256').update(source).digest('hex'), roles: Object.fromEntries(['implement', 'review'].map(role => [role, {
      argsSha256: createHash('sha256').update(JSON.stringify(commandFor(executor, 'fixture-model', role as 'implement' | 'review', '<checkout>'))).digest('hex'),
      permissionBoundary: true, noMcp: true, noRecursiveLaunch: true, processTreeTermination: true, readOnly: true, record: 'synthetic CLI fixture, not live compatibility evidence',
    }])) }), { mode: 0o600 });
  return { executors: { [executor]: { binary, enabled: true, model: 'fixture-model', receipt } }, maxWorkers: 2, maxRepairCycles: 2, maxTimeoutMs: 20 * 60_000,
    validation: [[process.execPath, '-e', 'process.exit(0)']] };
}
