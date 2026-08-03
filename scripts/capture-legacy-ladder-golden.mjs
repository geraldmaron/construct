/**
 * scripts/capture-legacy-ladder-golden.mjs — golden-transcript capture for the
 * extraction-ladder harvest, frozen into
 * tests/kernel/extract/fixtures/ladder-golden.json.
 *
 * v2 sources ported by construct-506.3:
 *   lib/document-extract/extraction-ladder.mjs
 *   lib/document-extract/formats.mjs
 *   lib/document-extract/routing-thresholds.mjs
 *   lib/document-extract/extraction-result-contract.mjs
 *
 * The ladder cannot be dual-run as a pure function — v2's version stats the
 * file, probes for a Docling install, shells out to `unzip`, and awaits real
 * providers. So this drives the REAL v2 ladder over a matrix of (format ×
 * backend availability × fidelity × privacy posture), with fake providers
 * injected the same way v2's own tests injected them, and records a TRANSCRIPT
 * of the routing decision: which rung won, which providers were called in what
 * order, and what was reported when every rung was exhausted.
 *
 * `calls` records only the INJECTED providers. v2's email rung dynamically
 * imported its own parser rather than accepting one, so that call is
 * unobservable from here and is absent from the transcript; the winning tier
 * and extractionMethod still pin which rung ran.
 *
 * The transcript — not the extracted bytes — is the thing being locked. Which
 * tier a document routes to is the ladder's actual job.
 *
 * Two knobs are pinned so the capture does not depend on this machine:
 *   - Docling local availability is expressed by whether a doclingExtract
 *     function is injected. v2 gates that rung on `doclingLocalReady && typeof
 *     doclingExtract === 'function'`, so with no injection the rung is skipped
 *     regardless of what is installed here.
 *   - Docling remote needs BOTH a serve URL in env and a remote-ok privacy
 *     posture, both set explicitly per case.
 *
 * Needs a construct-legacy checkout; NOT part of the test run. The frozen JSON
 * is. A diff on re-capture is a real behavior change.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LEGACY =
  process.env.CONSTRUCT_LEGACY ?? join(process.env.HOME ?? '', 'Developer/Projects/construct-legacy');

const { extractViaExtractionLadder } = await import(
  `${LEGACY}/lib/document-extract/extraction-ladder.mjs`
);

// A minimal but real .eml, so v2's email rung parses something rather than
// erroring on a stub. Every other format's bytes are irrelevant: the providers
// that would read them are faked.
const EML = [
  'From: a@example.com',
  'To: b@example.com',
  'Subject: ladder fixture',
  'Date: Thu, 1 Jan 2026 00:00:00 +0000',
  '',
  'body text',
  '',
].join('\n');

// '.docx!table' is not a format — it is a .docx whose bytes are a real zip
// carrying a <w:tbl>, so v2's structure probe (which shells out to `unzip`)
// reports hasTable and the high-fidelity escalation rung actually fires. Every
// other fixture's bytes are inert, which is why the probe otherwise sees
// nothing and that rung would never be covered.
const FORMATS = [
  '.pdf', '.docx', '.docx!table', '.doc', '.xlsx', '.pptx', '.odt',
  '.png', '.tiff',
  '.md', '.txt', '.csv', '.vtt', '.ics', '.rtf',
  '.xls', '.pages',
  '.eml',
  '.mp3', '.mov',
  '.zzz', '',
];

// Availability profiles. Each names how the environment is configured; the
// ported planner takes the same facts as declared inputs.
const PROFILES = [
  { id: 'bare', docling: false, remote: false, sync: false, whisper: false },
  { id: 'sync-only', docling: false, remote: false, sync: true, whisper: false },
  { id: 'docling-local', docling: true, remote: false, sync: true, whisper: false },
  { id: 'docling-remote-only', docling: false, remote: true, sync: true, whisper: false },
  { id: 'both-docling', docling: true, remote: true, sync: true, whisper: false },
  { id: 'whisper', docling: false, remote: false, sync: true, whisper: true },
];

// Lightweight-parser yields, chosen to exercise every accept rule: a dense
// digital PDF, a sparse multi-page one (scanned), an empty one, and a DOCX with
// and without the structure signals that force an escalation.
const YIELDS = [
  { id: 'lightweight-good', pdf: { text: 'x'.repeat(400), pageCount: 2 }, docx: { text: 'plain docx text' } },
  { id: 'lightweight-sparse', pdf: { text: 'x'.repeat(20), pageCount: 8 }, docx: { text: '' } },
  { id: 'lightweight-empty', pdf: { text: '', pageCount: 3 }, docx: null },
];

// A real (tiny) docx: a zip whose word/document.xml contains a table element.
function writeDocxWithTable(dir, filePath) {
  const staging = join(dir, 'docx-staging');
  mkdirSync(join(staging, 'word'), { recursive: true });
  writeFileSync(
    join(staging, 'word', 'document.xml'),
    '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:tbl><w:tr/></w:tbl></w:body></w:document>',
  );
  rmSync(filePath, { force: true });
  execFileSync('zip', ['-q', '-r', filePath, 'word'], { cwd: staging });
  rmSync(staging, { recursive: true, force: true });
}

const cases = [];
for (const extension of FORMATS) {
  for (const profile of PROFILES) {
    for (const yields of YIELDS) {
      for (const highFidelity of [true, false]) {
        cases.push({ extension, profile, yields, highFidelity });
      }
    }
  }
}

const root = mkdtempSync(join(tmpdir(), 'ladder-golden-'));
const golden = [];

try {
  for (const c of cases) {
    const withTable = c.extension === '.docx!table';
    const extension = withTable ? '.docx' : c.extension;
    const filePath = join(root, `fixture${extension}`);
    if (withTable) {
      writeDocxWithTable(root, filePath);
    } else {
      writeFileSync(filePath, extension === '.eml' ? EML : 'fixture bytes');
    }

    const calls = [];
    const opts = {
      maxChars: null,
      highFidelity: c.highFidelity,
      env: c.profile.remote
        ? { DOCLING_SERVE_URL: 'http://docling.invalid:5001', CONSTRUCT_EXTRACTION_PRIVACY: 'remote-ok' }
        : {},
      // Injected so the lightweight rungs never touch a real unpdf/mammoth.
      lightweightExtract: async () => {
        calls.push('unpdf');
        return c.yields.pdf;
      },
      lightweightDocxExtract: async () => {
        calls.push('mammoth');
        return c.yields.docx;
      },
    };
    if (c.profile.sync) {
      opts.syncExtract = () => {
        calls.push('sync');
        return { text: 'sync text', extractionMethod: 'sync', characters: 9, truncated: false };
      };
    }
    if (c.profile.docling) {
      opts.doclingExtract = async () => {
        calls.push('docling-local');
        return { markdown: '# docling', text: 'docling', extractionMethod: 'docling' };
      };
    }
    if (c.profile.remote) {
      opts.doclingRemoteExtract = async () => {
        calls.push('docling-remote');
        return { markdown: '# remote', text: 'remote', extractionMethod: 'docling-remote' };
      };
    }
    if (c.profile.whisper) {
      opts.whisperExtract = async () => {
        calls.push('whisper');
        return { text: 'transcript', extractionMethod: 'whisper' };
      };
    }

    let transcript;
    try {
      const r = await extractViaExtractionLadder(filePath, opts);
      transcript = {
        outcome: 'result',
        routingTier: r.routingTier ?? null,
        extractionMethod: r.extractionMethod ?? null,
        unsupported: Boolean(r.unsupported),
        reason: r.droppedInfo?.[0]?.reason ?? null,
        remediation: r.remediation ?? null,
        calls,
      };
    } catch (err) {
      transcript = { outcome: 'throw', code: err.code ?? null, message: err.message, calls };
    }

    golden.push({
      extension: c.extension,
      docxHasTable: withTable,
      profile: c.profile.id,
      yields: c.yields.id,
      highFidelity: c.highFidelity,
      transcript,
    });
    rmSync(filePath, { force: true });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

const out = new URL('../tests/kernel/extract/fixtures/ladder-golden.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(golden, null, 2)}\n`);
console.log(`captured ${golden.length} transcripts -> ${out.pathname}`);
