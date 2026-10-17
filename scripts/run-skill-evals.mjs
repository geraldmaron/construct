#!/usr/bin/env node
/**
 * run-skill-evals.mjs — runs a skill's evals against a real Claude Code, the
 * way the Agent Skills guides describe (agentskills.io, "Optimizing skill
 * descriptions" and "Evaluating skill output quality"). Manual: it uses the
 * person's own Claude Code login and costs real model calls, so CI only checks
 * the eval files' shape (tests/kernel/skills/evals-format.test.ts).
 *
 *   node scripts/run-skill-evals.mjs triggers <skill...> [--runs=3] [--split=train|validation]
 *     Each query in evals/trigger-queries.json runs --runs times in a scratch
 *     project that holds every shipped skill under .claude/skills, so a
 *     near-miss meant for another skill has that skill to go to. A run counts as
 *     triggered when it calls the Skill tool naming this skill; it is stopped
 *     at its first Skill call, its answer, or its eighth tool call, since a
 *     model often looks around before it loads a skill. A run that times out,
 *     errors, or exits without an answer is recorded and never scored: a
 *     query whose runs all failed is incomplete, not passed. A should-trigger
 *     query passes at a trigger rate of 0.5 or more over its scored runs, a
 *     near-miss below it.
 *
 *   node scripts/run-skill-evals.mjs outputs <skill> [--iteration=1]
 *     Each case in evals/evals.json runs once with the skill and once without,
 *     saving the answer, the full event trace and timing for grading. Grading
 *     the assertions is a separate pass by a person or a model; this script
 *     never marks a pass. The construct skill's cases run in a scratch project
 *     that is initialized and wired to this checkout's Construct, because the
 *     skill does nothing without its tools.
 *
 * A copy of the skill already installed for this user (for example in
 * ~/.claude/skills) also loads in every run and outranks the project copy, so
 * each result records it as a confound, and the without-skill arm refuses to
 * run while one exists.
 *
 * Results go to .tmp-evals/skills/ (gitignored). Runs start in plan mode, so a
 * query that asks for an edit cannot change anything.
 */

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.tmp-evals', 'skills');
const RUN_TIMEOUT_MS = 180_000;
const TOOL_CAP = 8;

function flag(args, name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Copies of the skill this user already has installed, which load beside the one under test. */
function installedCopies(skill) {
  return [join(homedir(), '.claude', 'skills', skill), join(homedir(), '.agents', 'skills', skill)].filter((dir) =>
    existsSync(join(dir, 'SKILL.md')),
  );
}

function scratchProject(skill, { withConstruct = false, allSkills = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-skill-eval-'));
  writeFileSync(join(dir, 'README.md'), '# Scratch project\n\nA project used to evaluate one skill.\n');
  if (withConstruct) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync(
      process.execPath,
      [join(ROOT, 'bin', 'construct.mjs'), 'init', '--client=claude-code', '--scale=solo', '--outcome=evaluate a skill'],
      { cwd: dir, stdio: 'ignore' },
    );
  }
  const names = allSkills
    ? readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'skills', e.name, 'SKILL.md')))
        .map((e) => e.name)
    : skill
      ? [skill]
      : [];
  for (const name of names) cpSync(join(ROOT, 'skills', name), join(dir, '.claude', 'skills', name), { recursive: true });
  return dir;
}

/**
 * One `claude -p` run. Resolves with its status (ok, timeout, error, exited),
 * the first Skill it called (when watching for one), its answer, and every
 * event it emitted.
 */
function runOnce(cwd, prompt, { watchSkills, projectMcp = false }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan'];
    if (projectMcp) args.push('--settings', JSON.stringify({ enableAllProjectMcpServers: true }));
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const events = [];
    let stderr = '';
    let buffer = '';
    let done = false;
    let tools = 0;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve({ skill: null, text: null, ...result, events, stderr: stderr.slice(-4000), durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), RUN_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        events.push(event);
        if (event.type === 'assistant') {
          for (const part of event.message?.content ?? []) {
            if (part.type !== 'tool_use' || !watchSkills) continue;
            if (part.name === 'Skill') return finish({ status: 'ok', skill: String(part.input?.skill ?? '') });
            tools += 1;
            if (tools >= TOOL_CAP) return finish({ status: 'ok' });
          }
        }
        if (event.type === 'result') {
          const failed = event.is_error === true || (event.subtype && event.subtype !== 'success');
          return finish({ status: failed ? 'error' : 'ok', text: event.result ?? '', usage: event.usage ?? null });
        }
      }
    });
    child.on('close', (code) => finish({ status: 'exited', exitCode: code }));
  });
}

async function triggers(skills, args) {
  const runs = Number(flag(args, 'runs', '3'));
  const split = flag(args, 'split', null);
  for (const skill of skills) {
    const confounds = installedCopies(skill);
    if (confounds.length) process.stdout.write(`${skill}: CONFOUNDED, also installed at ${confounds.join(', ')}\n`);
    const queries = JSON.parse(readFileSync(join(ROOT, 'skills', skill, 'evals', 'trigger-queries.json'), 'utf8')).filter(
      (q) => !split || q.split === split,
    );
    const project = scratchProject(skill, { allSkills: true });
    const results = [];
    try {
      for (const q of queries) {
        let triggered = 0;
        let scored = 0;
        const failures = [];
        for (let i = 0; i < runs; i += 1) {
          const r = await runOnce(project, q.query, { watchSkills: true });
          if (r.status !== 'ok') {
            failures.push({ status: r.status, exitCode: r.exitCode ?? null, stderr: r.stderr });
            continue;
          }
          scored += 1;
          if (r.skill !== null && (r.skill === skill || r.skill.endsWith(`:${skill}`))) triggered += 1;
        }
        const rate = scored ? triggered / scored : null;
        const passed = rate === null ? null : q.should_trigger ? rate >= 0.5 : rate < 0.5;
        results.push({ ...q, triggers: triggered, scored, failed: failures.length, failures, trigger_rate: rate, passed });
        const mark = passed === null ? 'INCOMPLETE' : passed ? 'pass' : 'FAIL';
        process.stdout.write(
          `${mark}  ${q.should_trigger ? 'should   ' : 'shouldnt '} ${rate === null ? ' n/a' : rate.toFixed(2)}  ${q.query}\n`,
        );
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
    const summary = {};
    for (const s of ['train', 'validation']) {
      const inSplit = results.filter((r) => r.split === s);
      if (inSplit.length)
        summary[s] = {
          passed: inSplit.filter((r) => r.passed === true).length,
          failed: inSplit.filter((r) => r.passed === false).length,
          incomplete: inSplit.filter((r) => r.passed === null).length,
          total: inSplit.length,
        };
    }
    mkdirSync(OUT, { recursive: true });
    const path = join(OUT, `${skill}.triggers.json`);
    writeFileSync(path, `${JSON.stringify({ skill, runs, at: new Date().toISOString(), confounds, summary, results }, null, 2)}\n`);
    process.stdout.write(`${skill}: ${JSON.stringify(summary)}${confounds.length ? ' (confounded)' : ''} -> ${path}\n`);
  }
}

async function outputs([skill], args) {
  const iteration = flag(args, 'iteration', '1');
  const confounds = installedCopies(skill);
  if (confounds.length) {
    process.stderr.write(`the without-skill arm would still load ${confounds.join(', ')}; move it aside before comparing\n`);
    process.exit(1);
  }
  const evals = JSON.parse(readFileSync(join(ROOT, 'skills', skill, 'evals', 'evals.json'), 'utf8')).evals;
  const workspace = join(OUT, `${skill}-workspace`, `iteration-${iteration}`);
  const withConstruct = skill === 'construct';
  for (const c of evals) {
    for (const [config, withSkill] of [
      ['with_skill', true],
      ['without_skill', false],
    ]) {
      const project = scratchProject(withSkill ? skill : null, { withConstruct });
      try {
        const r = await runOnce(project, c.prompt, { watchSkills: false, projectMcp: withConstruct });
        const dir = join(workspace, `eval-${String(c.id)}`, config);
        mkdirSync(join(dir, 'outputs'), { recursive: true });
        writeFileSync(join(dir, 'outputs', 'response.md'), r.text ?? '');
        writeFileSync(join(dir, 'events.jsonl'), r.events.map((e) => JSON.stringify(e)).join('\n'));
        writeFileSync(
          join(dir, 'timing.json'),
          `${JSON.stringify({ status: r.status, exit_code: r.exitCode ?? null, duration_ms: r.durationMs, usage: r.usage ?? null, stderr: r.stderr }, null, 2)}\n`,
        );
        process.stdout.write(`eval ${String(c.id)} ${config}: ${r.status} ${String(r.durationMs)}ms\n`);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    }
  }
  process.stdout.write(`outputs in ${workspace}; grade each case's assertions into grading.json beside them\n`);
}

const [command, ...rest] = process.argv.slice(2);
const names = rest.filter((a) => !a.startsWith('--'));
if (command === 'triggers' && names.length) await triggers(names, rest);
else if (command === 'outputs' && names.length === 1) await outputs(names, rest);
else {
  process.stderr.write(
    'usage: run-skill-evals.mjs triggers <skill...> [--runs=3] [--split=train|validation] | outputs <skill> [--iteration=1]\n',
  );
  process.exit(2);
}
