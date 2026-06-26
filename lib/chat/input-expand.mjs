/**
 * lib/chat/input-expand.mjs — expand pasted paths and @file references in chat input.
 *
 * Terminal drag-and-drop and bracketed paste often arrive as bare filesystem paths.
 * Bare paths are read (with a size cap) and appended as fenced content so the
 * model receives the attachment without a separate upload step.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_MAX_BYTES = 256 * 1024;
const BRACKETED_PASTE_RE = /\x1b\[200~([\s\S]*?)\x1b\[201~/g;

const PATH_LIKE =
  /^(?:@)?(?:"([^"]+)"|'([^']+)'|(~\/[^\s]+|\/[^\s]+|\.\.?\/[^\s]+|[A-Za-z]:\\[^\s]+))$/;

function unwrapBracketedPaste(text) {
  if (!text.includes('\x1b[200~')) return text;
  return text.replace(BRACKETED_PASTE_RE, '$1').trim();
}

function expandHome(filePath, home = os.homedir()) {
  if (filePath === '~') return home;
  if (filePath.startsWith('~/')) return path.join(home, filePath.slice(2));
  return filePath;
}

function resolveExistingPath(raw, { cwd, home }) {
  const candidate = expandHome(raw.trim(), home);
  const abs = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
  try {
    const stat = fs.statSync(abs);
    if (stat.isFile()) return abs;
  } catch {
    return null;
  }
  return null;
}

function readAttachment(absPath, { maxBytes }) {
  const stat = fs.statSync(absPath);
  if (stat.size > maxBytes) {
    return {
      ok: false,
      absPath,
      error: `skipped ${path.basename(absPath)} (${stat.size} bytes > ${maxBytes} byte cap)`,
    };
  }
  const content = fs.readFileSync(absPath, 'utf8');
  return { ok: true, absPath, content };
}

function formatAttachment(absPath, content, { cwd }) {
  const rel = path.relative(cwd, absPath) || absPath;
  const lang = path.extname(absPath).replace(/^\./, '') || 'text';
  return [
    `[Attached: ${rel}]`,
    '```' + lang,
    content.trimEnd(),
    '```',
  ].join('\n');
}

function extractAtReferences(text) {
  const refs = [];
  const re = /@(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    refs.push(match[1] || match[2] || match[3]);
  }
  return refs;
}

function stripAtReferences(text) {
  return text.replace(/@(?:"[^"]+"|'[^']+'|\S+)/g, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Expand drag-dropped paths, bracketed paste, and @file tokens into prompt text.
 * Returns { text, attachments: [{ path, relPath, bytes }], skipped: string[] }.
 */
export function expandUserInput(text, { cwd = process.cwd(), home = os.homedir(), maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const skipped = [];
  const attachments = [];
  let body = unwrapBracketedPaste(String(text || '').trim());
  if (!body) return { text: '', attachments, skipped };

  const pathCandidates = new Set();
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length === 1) {
    const line = lines[0];
    const m = line.match(PATH_LIKE);
    const raw = m ? (m[1] || m[2] || m[3]) : line;
    pathCandidates.add(raw);
  } else {
    for (const line of lines) {
      const m = line.match(PATH_LIKE);
      if (m) pathCandidates.add(m[1] || m[2] || m[3]);
    }
  }

  if (pathCandidates.size === 1 && lines.length === 1) {
    const only = [...pathCandidates][0];
    const abs = resolveExistingPath(only, { cwd, home });
    if (abs) {
      const read = readAttachment(abs, { maxBytes });
      if (read.ok) {
        attachments.push({
          path: abs,
          relPath: path.relative(cwd, abs) || abs,
          bytes: Buffer.byteLength(read.content, 'utf8'),
        });
        return {
          text: formatAttachment(abs, read.content, { cwd }),
          attachments,
          skipped,
        };
      }
      skipped.push(read.error);
    }
  }

  const atRefs = extractAtReferences(body);
  const blocks = [];
  let prompt = body;
  if (atRefs.length) {
    prompt = stripAtReferences(body);
    for (const ref of atRefs) {
      const abs = resolveExistingPath(ref, { cwd, home });
      if (!abs) {
        skipped.push(`@file not found: ${ref}`);
        continue;
      }
      const read = readAttachment(abs, { maxBytes });
      if (!read.ok) {
        skipped.push(read.error);
        continue;
      }
      attachments.push({
        path: abs,
        relPath: path.relative(cwd, abs) || abs,
        bytes: Buffer.byteLength(read.content, 'utf8'),
      });
      blocks.push(formatAttachment(abs, read.content, { cwd }));
    }
  }

  const merged = [prompt, ...blocks].filter(Boolean).join('\n\n');
  return { text: merged, attachments, skipped };
}
