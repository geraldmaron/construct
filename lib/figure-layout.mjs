/**
 * lib/figure-layout.mjs — proof helpers for published diagram SVGs.
 *
 * Detects pairwise overlap among label-like `<text>` nodes in D2 (and similar)
 * SVG exports so Construct can fail closed on colliding labels instead of
 * shipping hand-drawn cargo that covers itself. Geometry is approximate:
 * width ≈ glyph count × font-size × 0.55; height ≈ font-size. Nested tspans
 * inherit parent position. Not a full SVG layout engine — enough to catch the
 * failure mode Mermaid handDrawn produced on multi-subgraph flows.
 */

const TEXT_OPEN = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
const ATTR = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(attrBlob) {
  const out = {};
  let match;
  ATTR.lastIndex = 0;
  while ((match = ATTR.exec(attrBlob)) !== null) {
    out[match[1]] = match[2] ?? match[3] ?? '';
  }
  return out;
}

function textContent(inner) {
  return String(inner || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function readNumber(value, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function fontSizeFromAttrs(attrs) {
  if (attrs['font-size']) return readNumber(attrs['font-size'], 12);
  const style = attrs.style || '';
  const m = /font-size\s*:\s*([0-9.]+)px/i.exec(style);
  return m ? readNumber(m[1], 12) : 12;
}

/**
 * Extract approximate axis-aligned boxes for SVG text labels.
 * @param {string} svg
 * @returns {{ id: string, text: string, x: number, y: number, width: number, height: number }[]}
 */
export function extractSvgTextBoxes(svg) {
  const boxes = [];
  let match;
  let index = 0;
  TEXT_OPEN.lastIndex = 0;
  while ((match = TEXT_OPEN.exec(String(svg || ''))) !== null) {
    const attrs = parseAttrs(match[1] || '');
    const text = textContent(match[2]);
    if (!text) {
      index += 1;
      continue;
    }
    const fontSize = fontSizeFromAttrs(attrs);
    const x = readNumber(attrs.x, 0);
    const y = readNumber(attrs.y, 0);
    const width = Math.max(fontSize * 0.55 * text.length, fontSize);
    const height = fontSize * 1.15;
    boxes.push({
      id: `text-${index}`,
      text,
      x,
      y: y - fontSize * 0.85,
      width,
      height,
    });
    index += 1;
  }
  return boxes;
}

function boxesOverlap(a, b, pad = 1) {
  return !(
    a.x + a.width + pad <= b.x
    || b.x + b.width + pad <= a.x
    || a.y + a.height + pad <= b.y
    || b.y + b.height + pad <= a.y
  );
}

/**
 * @param {string} svg
 * @param {{ pad?: number, ignoreIdentical?: boolean }} [options]
 * @returns {{ ok: boolean, overlaps: { a: string, b: string, texts: [string, string] }[], boxes: object[] }}
 */
export function assessSvgTextOverlap(svg, options = {}) {
  const pad = options.pad ?? 1;
  const ignoreIdentical = options.ignoreIdentical !== false;
  const boxes = extractSvgTextBoxes(svg);
  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (ignoreIdentical && a.text === b.text && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) {
        continue;
      }
      if (boxesOverlap(a, b, pad)) {
        overlaps.push({ a: a.id, b: b.id, texts: [a.text, b.text] });
      }
    }
  }
  return { ok: overlaps.length === 0, overlaps, boxes };
}

/**
 * Throw-friendly assert for tests and publish proof hooks.
 * @param {string} svg
 * @param {{ pad?: number, label?: string }} [options]
 */
export function assertSvgLabelsDoNotOverlap(svg, options = {}) {
  const result = assessSvgTextOverlap(svg, options);
  if (result.ok) return result;
  const sample = result.overlaps
    .slice(0, 5)
    .map((o) => `"${o.texts[0]}" × "${o.texts[1]}"`)
    .join('; ');
  const label = options.label ? `${options.label}: ` : '';
  throw new Error(`${label}figure labels overlap (${result.overlaps.length}): ${sample}`);
}
