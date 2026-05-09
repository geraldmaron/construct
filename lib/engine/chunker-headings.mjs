/**
 * lib/engine/chunker-headings.mjs — heading-prefix Chunker plugin.
 *
 * Splits a markdown document into chunks at heading boundaries (`#`, `##`,
 * `###`, …) and prepends each chunk with the chain of ancestor headings so
 * that each retrieved chunk carries enough doc-relative context to be
 * understood on its own. This is a zero-dep approximation of contextual
 * retrieval: instead of a per-chunk LM-generated context (the strongest
 * available technique), the heading chain provides "where in the document
 * is this from" context for free.
 *
 * Plain-text docs (no headings) collapse to a single chunk; the input is
 * returned as one chunk with no prefix.
 *
 * Plugin contract (Chunker):
 *   meta: { id }
 *   chunk(doc) → chunk[]
 *
 * `doc` shape:
 *   { id, title?, body, metadata? } — body is the markdown source.
 *
 * Output chunk shape:
 *   { id, body, title, prefix?, metadata }
 *
 * The prefix is the joined heading chain (e.g. "# Auth > ## JWT > ### Refresh").
 * Callers that embed `prefix + body` will retrieve more accurately than if
 * they embedded body alone.
 */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

function* iterChunks(body) {
  const lines = String(body || '').split(/\r?\n/);
  const stack = [];
  let buffer = [];
  let active = null;

  function flush() {
    const content = buffer.join('\n').trim();
    if (content || active) {
      yieldOne({
        prefix: stack.map((h) => '#'.repeat(h.level) + ' ' + h.text).join(' > '),
        title: active?.text || '',
        body: content,
      });
    }
  }

  let queue = [];
  function yieldOne(chunk) { queue.push(chunk); }

  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) {
      flush();
      buffer = [];
      const level = m[1].length;
      const text = m[2];
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const heading = { level, text };
      stack.push(heading);
      active = heading;
      while (queue.length) yield queue.shift();
    } else {
      buffer.push(line);
    }
  }
  flush();
  while (queue.length) yield queue.shift();
}

export function create(/* opts */) {
  return {
    meta: { id: 'headings-prefix' },
    async chunk(doc) {
      const docs = Array.isArray(doc) ? doc : [doc];
      const out = [];
      for (const d of docs) {
        if (!d) continue;
        const baseId = d.id || '';
        const body = d.body || '';
        const sub = [...iterChunks(body)];
        if (sub.length <= 1) {
          out.push({
            id: baseId,
            title: d.title || sub[0]?.title || '',
            body,
            prefix: sub[0]?.prefix || '',
            metadata: d.metadata || {},
          });
          continue;
        }
        sub.forEach((chunk, i) => {
          out.push({
            id: `${baseId}#${i}`,
            title: chunk.title,
            body: chunk.body,
            prefix: chunk.prefix,
            metadata: { ...(d.metadata || {}), parentDocId: baseId, headingChainIndex: i },
          });
        });
      }
      return out;
    },
  };
}

export default create;
