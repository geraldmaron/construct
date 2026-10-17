import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const handles = new Set();
let sent = false;
const originalOpen = fs.openSync,
  originalRead = fs.readFileSync,
  originalClose = fs.closeSync;
fs.openSync = function (path, ...args) {
  const fd = originalOpen.call(this, path, ...args);
  if (String(path).endsWith('/.construct/sources.json')) handles.add(fd);
  return fd;
};
fs.readFileSync = function (fd, ...args) {
  const result = originalRead.call(this, fd, ...args);
  if (handles.has(fd) && !sent) {
    sent = true;
    process.send({ event: 'declarations_read', ids: JSON.parse(result.toString()).sources.map((s) => s.id) });
    if (process.env.CONSTRUCT_SOURCE_READ_GATE) {
      const until = Date.now() + 15000;
      while (!fs.existsSync(process.env.CONSTRUCT_SOURCE_READ_GATE)) {
        if (Date.now() > until) throw new Error('source read gate timed out');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }
  return result;
};
fs.closeSync = function (fd, ...args) {
  handles.delete(fd);
  return originalClose.call(this, fd, ...args);
};
const originalRename = fs.renameSync;
fs.renameSync = function (from, to, ...args) {
  const result = originalRename.call(this, from, to, ...args);
  if (process.env.CONSTRUCT_SOURCE_CRASH_AFTER_REPLACE === '1' && String(to).endsWith('/.construct/sources.json'))
    process.kill(process.pid, 'SIGKILL');
  return result;
};
syncBuiltinESMExports();
await import(pathToFileURL(process.env.CONSTRUCT_AUDIT_LAUNCHER));
