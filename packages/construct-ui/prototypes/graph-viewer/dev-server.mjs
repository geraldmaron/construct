#!/usr/bin/env node
/**
 * packages/construct-ui/prototypes/graph-viewer/dev-server.mjs — static file server
 * for manual inspection of the Cytoscape.js prototype (construct-tsyfe.4.5).
 *
 * PROTOTYPE ONLY. Serves this directory plus one vendor route
 * (`/vendor/cytoscape.esm.min.mjs` -> node_modules/cytoscape/dist/), so
 * index.html's import map can resolve the bare `cytoscape` specifier without
 * a bundler. No other route escapes this directory or node_modules/cytoscape.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');
const cytoscapeEsm = path.join(rootDir, 'node_modules/cytoscape/dist/cytoscape.esm.min.mjs');

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
const PORT = Number(process.env.PORT) || 4173;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let filePath;
    if (url.pathname === '/vendor/cytoscape.esm.min.mjs') {
      filePath = cytoscapeEsm;
    } else {
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      filePath = path.join(__dirname, rel);
      if (!filePath.startsWith(__dirname)) throw Object.assign(new Error('forbidden'), { status: 403 });
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.status === 403 ? 403 : 404, { 'content-type': 'text/plain' });
    res.end(err.status === 403 ? 'forbidden' : 'not found');
  }
});

server.listen(PORT, () => console.log(`graph-viewer prototype: http://localhost:${PORT}/`));
