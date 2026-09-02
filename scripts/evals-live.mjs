#!/usr/bin/env node
/**
 * evals-live.mjs — what a real model picks from the shipped skill
 * descriptions, recorded.
 *
 * For every case in skills/evals/routing.json, a subscription model is shown
 * the catalog exactly as a host lists it (name and description, nothing
 * else) and asked which skill it would load, or none. The verdicts, the
 * model, and the date are written to skills/evals/live-judge.json. The test
 * suite checks that the record covers the current cases; it never runs this.
 *
 * Development calls come from a subscription CLI, never a local model. The
 * default judge is Codex because it shares no model family with the author
 * of the cases; pass --judge=claude to use the claude CLI instead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillRegistry } from '../src/kernel/registry/skill-registry.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const judge = (process.argv.find((a) => a.startsWith('--judge=')) ?? '--judge=codex').slice('--judge='.length);
const skills = createSkillRegistry({ projectDir: null });
const list = skills.list().map((s) => `- ${s.manifest.id}: ${s.description}`).join('\n');
const file = JSON.parse(readFileSync(join(ROOT, 'skills', 'evals', 'routing.json'), 'utf8'));

function ask(prompt) {
  if (judge === 'codex') {
    const r = spawnSync('codex', ['exec', '--skip-git-repo-check', prompt], { encoding: 'utf8', timeout: 600000 });
    if (r.status !== 0) throw new Error(`codex exec failed: ${r.stderr}`);
    return r.stdout;
  }
  if (judge === 'claude') {
    const r = spawnSync('claude', ['-p', prompt, '--output-format', 'text'], { encoding: 'utf8', timeout: 600000, env: { ...process.env, CLAUDECODE: undefined } });
    if (r.status !== 0) throw new Error(`claude -p failed: ${r.stderr}`);
    return r.stdout;
  }
  throw new Error(`unknown judge ${judge}; use codex or claude`);
}

const verdicts = [];
for (let i = 0; i < file.cases.length; i += 25) {
  const batch = file.cases.slice(i, i + 25);
  const prompt = `You are an AI coding assistant with these skills available. A skill is loaded only when a request matches its description; otherwise you answer directly with no skill.\n\nSKILLS:\n${list}\n\nFor each numbered request below, output the single best skill name, or "none" if no skill should load. Output ONLY a JSON array of strings, one per request, in order, nothing else.\n\n${batch.map((c, j) => `${j + 1}. ${c.text}`).join('\n')}`;
  const out = ask(prompt);
  const m = out.match(/\[[\s\S]*?\]/g);
  const arr = m ? JSON.parse(m[m.length - 1]) : [];
  batch.forEach((c, j) => verdicts.push({ text: c.text, expected: c.skill, picked: arr[j] ?? null }));
}
const agree = verdicts.filter((v) => v.picked === v.expected).length;
const record = { format: 'construct-live-judge', formatVersion: 1, judge, recordedAt: new Date().toISOString().slice(0, 10), cases: verdicts.length, agree, verdicts };
writeFileSync(join(ROOT, 'skills', 'evals', 'live-judge.json'), `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`live judge (${judge}): ${String(agree)}/${String(verdicts.length)} agree with the labels; recorded in skills/evals/live-judge.json\n`);
for (const v of verdicts.filter((v) => v.picked !== v.expected)) process.stdout.write(`  ${v.expected} -> ${String(v.picked)} :: ${v.text}\n`);
