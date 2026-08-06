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
 * The prompt shape is chosen the same way it is for any other family: --lens
 * <name> or --notes produce one dispatch's prompt, which is the shape the spine
 * ships and the shape pack-depth acceptance reads; with neither flag the
 * whole-roster monolith is produced, for cross-family comparison only. A local
 * family measured on the monolith is being measured on a shape the product does
 * not use.
 *
 * Usage:
 *   node scripts/run-org-harness-ollama.mjs --model qwen3.6:35b --out runs/<date>-<label>.json
 *   node scripts/run-org-harness-ollama.mjs --model qwen3.6:35b --lens compliance --out <part.json>
 *
 * Hosted families run through the same script so the measured prompt is
 * byte-identical across providers: --endpoint openrouter switches the
 * transport to OpenRouter's OpenAI-compatible chat API (OPENROUTER_API_KEY
 * must be in the environment) and nothing else changes. The artifact then
 * records a hosted model's run on exactly the shape a local one is scored on.
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
const lens = arg('--lens');
const notesMode = args.includes('--notes');
if (!model || !out) {
  console.error(
    'usage: run-org-harness-ollama.mjs --model <ollama-model> --out <run.json> [--lens <name> | --notes]',
  );
  process.exit(2);
}
if (lens && notesMode) {
  console.error('--lens and --notes are different dispatches; pass one');
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

const shape = lens ? ['--lens', lens] : notesMode ? ['--notes'] : [];
const base = execFileSync(
  'node',
  [join(repo, 'scripts', 'org-harness-producer-prompt.mjs'), ...shape],
  { encoding: 'utf8' },
)
  .replace(/Your material is every file under:.*\n/, 'Your material is the corpus inlined below.\n')
  .replace(/^Read all of it.*\n/m, '');

let corpus = '\n\n## The corpus\n\n';
for (const file of walk(corpusRoot)) {
  const rel = relative(corpusRoot, file);
  corpus += `\n===== FILE: ${rel} =====\n${readFileSync(file, 'utf8')}\n`;
}

const endpoint = arg('--endpoint', 'ollama');
const prompt = `${base}${corpus}\n\nReturn only the JSON object.`;

let url;
let headers = ['-H', 'content-type: application/json'];
let body;
if (endpoint === 'openrouter') {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('--endpoint openrouter needs OPENROUTER_API_KEY in the environment');
    process.exit(2);
  }
  url = 'https://openrouter.ai/api/v1/chat/completions';
  headers = [...headers, '-H', `Authorization: Bearer ${key}`];
  body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    stream: false,
  });
} else {
  url = 'http://localhost:11434/api/generate';
  body = JSON.stringify({
    model,
    prompt,
    stream: false,
    options: { temperature: 0.2, num_ctx: 49152 },
  });
}

const scratch = mkdtempSync(join(tmpdir(), 'org-harness-ollama-'));
try {
  const reqPath = join(scratch, 'request.json');
  writeFileSync(reqPath, body);
  const raw = execFileSync(
    'curl',
    ['-s', '--max-time', '3500', '-X', 'POST', url,
     ...headers, '--data-binary', `@${reqPath}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const data = JSON.parse(raw);
  let text = endpoint === 'openrouter'
    ? data.choices?.[0]?.message?.content ?? ''
    : data.response ?? '';
  if (endpoint === 'openrouter' && !text) {
    console.error(`openrouter returned no content: ${raw.slice(0, 400)}`);
    process.exit(1);
  }
  const fence = text.match(/```json\n([\s\S]*?)\n```/);
  if (fence) text = fence[1];
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  writeFileSync(out, JSON.stringify(parsed, null, 1));
  const promptTokens = data.prompt_eval_count ?? data.usage?.prompt_tokens ?? '?';
  const outputTokens = data.eval_count ?? data.usage?.completion_tokens ?? '?';
  console.log(
    `run recorded: ${out} — ${parsed.claims?.length ?? 0} claims, ` +
      `${promptTokens} prompt tokens, ${outputTokens} output tokens`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
