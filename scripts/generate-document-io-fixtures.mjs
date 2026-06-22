#!/usr/bin/env node
/**
 * scripts/generate-document-io-fixtures.mjs — regenerate document I/O intake fixture samples.
 */

import { writeDocumentIoFixtures } from '../lib/certification/document-io-fixtures.mjs';

const { written } = writeDocumentIoFixtures();
process.stdout.write(`Wrote ${written.length} document I/O fixture file(s)\n`);
