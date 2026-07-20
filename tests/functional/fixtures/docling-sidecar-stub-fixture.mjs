/**
 * tests/functional/fixtures/docling-sidecar-stub-fixture.mjs — controllable docling sidecar stand-in.
 *
 * Newline-delimited JSON-RPC over stdin/stdout, matching lib/document-extract/docling-sidecar.py.
 * Behavior is driven by environment variables so functional tests can exercise queueing,
 * malformed stdout, version reporting, and hang/timeout paths without a real docling venv.
 */
import readline from 'node:readline';

const STUB_VERSION = process.env.STUB_DOCLING_VERSION || '2.45.0';
const STUB_DELAY_MS = Number(process.env.STUB_DELAY_MS || 0);
const EMIT_MALFORMED = process.env.STUB_EMIT_MALFORMED === '1';
const EMIT_ORPHAN = process.env.STUB_EMIT_ORPHAN === '1';
const HANG_EXTRACT = process.env.STUB_HANG === '1';
const STUB_STRUCTURED_DICT = process.env.STUB_STRUCTURED_DICT === '1';

let concurrent = 0;
let maxConcurrent = 0;

function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handleExtract(requestId) {
  concurrent += 1;
  maxConcurrent = Math.max(maxConcurrent, concurrent);
  process.stderr.write(JSON.stringify({ event: 'extract-start', concurrent, maxConcurrent }) + '\n');
  if (EMIT_MALFORMED) {
    process.stdout.write('NOT-JSON-MALFORMED-LINE\n');
  }
  if (EMIT_ORPHAN) {
    writeResponse({ id: 999999, result: { ok: true } });
  }
  if (HANG_EXTRACT) {
    await new Promise(() => {});
  }
  if (STUB_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, STUB_DELAY_MS));
  }
  concurrent -= 1;
  const result = {
    markdown: '# stub extract\n\n| Metric | Value |\n| --- | --- |\n| Latency ms | 42 |',
    metadata: { doclingVersion: STUB_VERSION, sourcePath: '/stub' },
    droppedInfo: [],
  };
  if (STUB_STRUCTURED_DICT) {
    result.structuredDict = {
      schema_name: 'DoclingDocument',
      pages: [{ page_no: 1, size: { width: 612, height: 792 } }],
      texts: [{ label: 'paragraph', text: 'Quarterly metrics table fixture.' }],
      tables: [{
        data: {
          grid: [
            [{ text: 'Metric' }, { text: 'Value' }],
            [{ text: 'Latency ms' }, { text: '42' }],
          ],
          num_rows: 2,
          num_cols: 2,
        },
      }],
    };
  }
  writeResponse({ id: requestId, result });
}

async function handleRequest(request) {
  const method = request.method;
  const requestId = request.id;
  if (method === 'ping') {
    writeResponse({ id: requestId, result: { ok: true, doclingVersion: STUB_VERSION } });
    return;
  }
  if (method === 'extract') {
    await handleExtract(requestId);
    return;
  }
  if (method === 'shutdown') {
    writeResponse({ id: requestId, result: { ok: true } });
    process.exit(0);
  }
  writeResponse({
    id: requestId,
    error: { code: 'ValueError', message: `unknown method: ${method}` },
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  handleRequest(request).catch((err) => {
    writeResponse({
      id: request?.id ?? null,
      error: { code: err.name || 'Error', message: err.message || String(err) },
    });
  });
});
