#!/usr/bin/env node
/**
 * run-org-harness-ollama.mjs — produce a scored-run candidate over the fixture
 * organization on a local Ollama model.
 *
 * The producer prompt comes from scripts/org-harness-producer-prompt.mjs (the
 * committed lens prompt — never an improvised one), with the corpus inlined
 * because a local model has no file tools: the model must see exactly what a
 * clean-context agent would read, and nothing else. Output lands as the run
 * JSON the scorer reads; score it with scripts/score-org-harness.mjs and
 * record both in fixtures/org-harness/runs/.
 *
 * Local-first on purpose: re-verification costs nothing (probe:opencode
 * pattern). curl carries the request because the generation legitimately
 * outlives fetch's header timeout on large local models.
 *
 * Usage:
 *   node scripts/run-org-harness-ollama.mjs --model qwen3.6:35b --out runs/<date>-<label>.json
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const model = arg('--model');
const out = arg('--out');
if (!model || !out) {
  console.error('usage: run-org-harness-ollama.mjs --model <ollama-model> --out <run.json>');
  process.exit(2);
}

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = join(repo, 'fixtures', 'org-harness', 'corpus');

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const base = execFileSync('node', [join(repo, 'scripts', 'org-harness-producer-prompt.mjs')], {
  encoding: 'utf8',
})
  .replace(/Your material is every file under:.*\n/, 'Your material is the corpus inlined below.\n')
  .replace(/^Read all of it.*\n/m, '');

let corpus = '\n\n## The corpus\n\n';
for (const file of walk(corpusRoot)) {
  const rel = relative(corpusRoot, file);
  corpus += `\n===== FILE: ${rel} =====\n${readFileSync(file, 'utf8')}\n`;
}

const prompt = `${base}${corpus}\n\nReturn only the JSON object.`;
const body = JSON.stringify({
  model,
  prompt,
  stream: false,
  options: { temperature: 0.2, num_ctx: 49152 },
});

const scratch = mkdtempSync(join(tmpdir(), 'org-harness-ollama-'));
try {
  const reqPath = join(scratch, 'request.json');
  writeFileSync(reqPath, body);
  const raw = execFileSync(
    'curl',
    ['-s', '--max-time', '3500', '-X', 'POST', 'http://localhost:11434/api/generate',
     '-H', 'content-type: application/json', '--data-binary', `@${reqPath}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const data = JSON.parse(raw);
  let text = data.response ?? '';
  const fence = text.match(/```json\n([\s\S]*?)\n```/);
  if (fence) text = fence[1];
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  writeFileSync(out, JSON.stringify(parsed, null, 1));
  console.log(
    `run recorded: ${out} — ${parsed.claims?.length ?? 0} claims, ` +
      `${data.prompt_eval_count ?? '?'} prompt tokens, ${data.eval_count ?? '?'} output tokens`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
