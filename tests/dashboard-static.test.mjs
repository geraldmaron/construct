import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { syncDashboardStatic, getDashboardStaticStatus } from '../lib/dashboard-static.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(rootDir, relPath, content) {
  const fullPath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

test('syncDashboardStatic copies dashboard dist into server static and removes stale files', () => {
  const rootDir = tempDir('construct-dashboard-static-');
  writeFile(rootDir, 'dashboard/dist/index.html', '<html>ok</html>');
  writeFile(rootDir, 'dashboard/dist/assets/app.js', 'console.log("ok");');
  writeFile(rootDir, 'lib/server/static/stale.txt', 'old');

  const result = syncDashboardStatic({ rootDir });

  assert.equal(result.changed, true);
  assert.deepEqual(result.copied.sort(), ['assets/app.js', 'index.html']);
  assert.deepEqual(result.removed, ['stale.txt']);
  assert.equal(fs.readFileSync(path.join(rootDir, 'lib/server/static/index.html'), 'utf8'), '<html>ok</html>');
  assert.equal(fs.existsSync(path.join(rootDir, 'lib/server/static/stale.txt')), false);
});

test('syncDashboardStatic --check reports drift without writing files', () => {
  const rootDir = tempDir('construct-dashboard-check-');
  writeFile(rootDir, 'dashboard/dist/index.html', '<html>new</html>');
  writeFile(rootDir, 'lib/server/static/index.html', '<html>old</html>');

  const before = fs.readFileSync(path.join(rootDir, 'lib/server/static/index.html'), 'utf8');
  const result = syncDashboardStatic({ rootDir, check: true });
  const after = fs.readFileSync(path.join(rootDir, 'lib/server/static/index.html'), 'utf8');

  assert.equal(result.changed, true);
  assert.deepEqual(result.copied, ['index.html']);
  assert.equal(before, after);
});

test('getDashboardStaticStatus reports aligned trees when dist matches static', () => {
  const rootDir = tempDir('construct-dashboard-status-');
  writeFile(rootDir, 'dashboard/dist/index.html', '<html>ok</html>');
  writeFile(rootDir, 'lib/server/static/index.html', '<html>ok</html>');

  const status = getDashboardStaticStatus({ rootDir });

  assert.equal(status.inSync, true);
  assert.deepEqual(status.copied, []);
  assert.deepEqual(status.removed, []);
});
