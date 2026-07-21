/**
 * lib/document-extract/email-sync-worker.mjs — subprocess entry for sync email
 * extraction. Lets lib/distill.mjs and extractDocumentText call mailparser without
 * blocking the parent event loop (construct-tsyfe.2.8).
 */
import { readFileSync } from 'node:fs';
import { extractEmlAsync, extractEmlMessageAsync } from './email-extract.mjs';

const input = readFileSync(0, 'utf8');
const { mode, filePath, opts } = JSON.parse(input);

try {
  const result = mode === 'message'
    ? await extractEmlMessageAsync(filePath, opts)
    : await extractEmlAsync(filePath, opts);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({
    error: {
      message: error.message,
      code: error.code,
      filePath: error.filePath,
    },
  }));
  process.exit(1);
}
