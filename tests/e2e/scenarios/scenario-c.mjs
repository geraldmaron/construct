/**
 * tests/e2e/scenarios/scenario-c.mjs — Research project scenario executor.
 *
 * Builds a sterile env on the `research` profile, seeds a real primary-source
 * corpus into inbox/ (three arXiv PDFs on retrieval/embeddings plus five
 * markdown notes representing prior internal thinking), drives the intake loop,
 * and sets up the Tier-3 evidence brief produced by the host researcher →
 * cx-evaluator chain.
 *
 * The PDFs are downloaded at run time from their canonical arXiv URLs rather
 * than committed, so the repo stays clean and the corpus is reproducible from
 * the manifest. The five notes are inline and deterministic.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeSterileEnv, timedRun, gitInit } from '../lib/sterile-env.mjs';

// A coherent corpus: dense vs sparse retrieval and context positioning — the
// same problem space Construct's own hybrid retrieval occupies, so the evidence
// brief has a real synthesis target.

export const CORPUS_PDFS = [
  { id: 'sbert', url: 'https://arxiv.org/pdf/1908.10084', file: 'sentence-bert.pdf', cite: 'Reimers & Gurevych 2019, Sentence-BERT (arXiv:1908.10084)' },
  { id: 'dpr', url: 'https://arxiv.org/pdf/2004.04906', file: 'dense-passage-retrieval.pdf', cite: 'Karpukhin et al. 2020, Dense Passage Retrieval (arXiv:2004.04906)' },
  { id: 'lostmiddle', url: 'https://arxiv.org/pdf/2307.03172', file: 'lost-in-the-middle.pdf', cite: 'Liu et al. 2023, Lost in the Middle (arXiv:2307.03172)' },
];

export const NOTES = {
  'note-01-hybrid-rationale.md': '# Internal note: why hybrid retrieval\n\nPrior thinking: cosine-only retrieval misses exact-term matches (IDs, error codes); BM25-only misses paraphrase. We hypothesize a weighted merge beats either alone. UNVERIFIED against literature.\n',
  'note-02-normalization.md': '# Internal note: score normalization\n\nBM25 is unbounded; cosine is [0,1]. We normalize BM25 against its own max before merging. Open question: does this distort ranking when the corpus is small?\n',
  'note-03-context-order.md': '# Internal note: context ordering\n\nObservation from our own traces: answers degrade when the relevant chunk lands in the middle of a long prompt. We reorder retrieved chunks to put the strongest first/last. Needs external validation.\n',
  'note-04-chunking.md': '# Internal note: chunk size\n\nWe chunk at ~512 tokens. Guess, not measured. Larger chunks = fewer, more diluted; smaller = more precise but more of them.\n',
  'note-05-eval-gap.md': '# Internal note: eval gap\n\nWe have no offline retrieval eval. We judge quality anecdotally. This is the biggest risk to any retrieval change we make.\n',
};

export function setup({ repoRoot }) {
  const sterile = makeSterileEnv({ repoRoot, prefix: 'cx-e2e-c-' });
  gitInit({ cwd: sterile.project, env: sterile.env });

  const install = timedRun({ bin: process.execPath, args: [sterile.launcher, 'install', '--scope=user', '--yes'], cwd: sterile.project, env: sterile.env });
  const init = timedRun({ bin: process.execPath, args: [sterile.launcher, 'init', '--yes'], cwd: sterile.project, env: sterile.env });
  const profile = timedRun({ bin: process.execPath, args: [sterile.launcher, 'profile', 'set', 'research'], cwd: sterile.project, env: sterile.env });

  const inbox = join(sterile.project, 'inbox');
  mkdirSync(inbox, { recursive: true });
  for (const [name, content] of Object.entries(NOTES)) writeFileSync(join(inbox, name), content);

  const pdfResults = [];
  for (const pdf of CORPUS_PDFS) {
    const out = join(inbox, pdf.file);
    const dl = timedRun({ bin: 'curl', args: ['-fsSL', '-o', out, pdf.url], cwd: sterile.project, env: sterile.env, timeoutMs: 60_000 });
    let bytes = 0;
    try { bytes = statSync(out).size; } catch { /* failed download */ }
    pdfResults.push({ id: pdf.id, url: pdf.url, status: dl.status, bytes, ok: dl.status === 0 && bytes > 1000 });
  }

  const inboxFiles = existsSync(inbox) ? readdirSync(inbox) : [];
  return { sterile, install, init, profile, pdfResults, inboxFiles, inbox };
}

// Drive the intake loop: list the queued packets, then classify the corpus.
// Capture exit + output so the report shows the research-profile intake working.

export function tierIntake({ env, project, launcher }) {
  const list = timedRun({ bin: process.execPath, args: [launcher, 'intake', 'list'], cwd: project, env });
  const listJson = timedRun({ bin: process.execPath, args: [launcher, 'intake', 'list', '--json'], cwd: project, env });
  const classify = timedRun({ bin: process.execPath, args: [launcher, 'intake', 'classify', '--json'], cwd: project, env });
  return {
    list: { status: list.status, stdout: list.stdout, stderr: list.stderr },
    listJson: { status: listJson.status, stdoutLen: listJson.stdout.length },
    classify: { status: classify.status, stdoutLen: classify.stdout.length, stdout: classify.stdout.slice(0, 2000) },
  };
}
