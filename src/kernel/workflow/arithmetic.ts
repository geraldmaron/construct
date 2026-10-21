/** Shared bounded figure parsing and arithmetic. No dynamic evaluation. */
const YEAR = /^(?:19|20)\d\d$/;
const NUMBER = /(?<![\w.\-/:#])[$€£]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|[kKmMbB]\b|ms\b|h\b|x\b))?(?![\w\-:])/g;

/** A figure as it would be matched: no currency sign, no thousands separators, no inner space. */
export function normalizeFigure(raw: string): string {
  return raw
    .replace(/[$€£,]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi;
const DATES = [
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?![.,]?\\d|\\s?(?:%|[kmb]\\b))`, 'gi'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b`, 'gi'),
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  CLOCK,
];

/** Whether "h:mm" is a time a clock can show; "80:80" is a port mapping, not a time. */
function onAClock(time: string): boolean {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  return hours !== undefined && minutes !== undefined && hours <= 23 && minutes <= 59;
}

/** A digit run cited text gives, with an optional unit: not inside a word, a key, a path, an anchor or a version. */
const CITED_FIGURE = /(?<![\w\-#/.])[$€£]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|[kKmMbB]\b|ms\b|h\b|x\b))?(?![a-zA-Z_]*\d)/g;
const CITED_RUN = /(?<![\w\-#/.])\d+(?:\.\d+)?(?![a-zA-Z_]*\d)/g;

/**
 * Every figure cited text could be giving. Configuration writes figures
 * inside other tokens ("postgres:16", "80:80", "PORT=8443"), so the cited
 * side is read more loosely than an output: a digit run after a colon, quote,
 * equals sign or comma counts, and so does each number of a list. Dates,
 * times, years, lone digits, one group of "1,600", and digits inside an
 * identifier (a ticket key, an issue or page number, a hash, a version's
 * tail) are never prose figures. Arithmetic mode retains small and year-shaped
 * magnitudes for operands, while still stripping dates/times and identifier digits.
 */
export function citedFiguresIn(text: string, arithmetic = false): string[] {
  let body = text;
  for (const d of DATES) body = body.replace(d, (m) => (d === CLOCK && !onAClock(m) ? m : ' '));
  const out: string[] = [];
  const keep = (f: string) => {
    const digits = f.replace(/[^\d.]/g, '');
    if (!arithmetic && (/^\d$/.test(f) || (YEAR.test(digits) && f === digits))) return;
    out.push(f);
  };
  for (const m of body.matchAll(CITED_FIGURE)) keep(normalizeFigure(m[0]));
  for (const m of body.matchAll(CITED_RUN)) {
    if (/^\d{3}(?:\.\d+)?$/.test(m[0]) && /\d,$/.test(body.slice(Math.max(0, m.index - 2), m.index))) continue;
    keep(m[0]);
  }
  if (arithmetic)
    for (const m of body.matchAll(/(?<![\w#/.])-\d[\d,]*(?:\.\d+)?(?:\s?(?:%|[kKmMbB]\b|ms\b|h\b|x\b))?(?![a-zA-Z_]*\d)/g))
      keep(normalizeFigure(m[0]));
  return out;
}

/** Figures worth checking: not a lone digit, a year, a date or time, or a list or section number. */
export function figuresIn(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let body = line.replace(/^\s*(?:#+\s*)?(?:[-*]\s+)?\d+[.)]\s+/, '');
    for (const d of DATES) body = body.replace(d, ' ');
    for (const m of body.matchAll(NUMBER)) {
      const f = normalizeFigure(m[0]);
      const digits = f.replace(/[^\d.]/g, '');
      if (YEAR.test(digits) && f === digits) continue;
      if (/^\d$/.test(f)) continue;
      out.push(f);
    }
  }
  return out;
}

/** A figure's magnitude: 2.1M -> 2100000, 18% -> 18, 1,600 -> 1600. Null when it is not a figure. */
export function figureValue(raw: string): number | null {
  const f = normalizeFigure(raw);
  const m = /^([+-]?\d+(?:\.\d+)?)(%|k|m|b|ms|h|x)?$/.exec(f);
  if (!m) return null;
  const n = Number(m[1]);
  // A percentage is a fraction, so 1.6M * 50% is 0.8M and "18%" compares as 0.18.
  const scale = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : m[2] === '%' ? 0.01 : 1;
  const value = n * scale;
  return Number.isFinite(value) ? value : null;
}

/** The half-unit of a figure's last written digit: "2M" covers 1.5M to 2.5M, "2.1M" covers 2.05M to 2.15M. */
function roundingTolerance(fig: string): number {
  const f = normalizeFigure(fig);
  const m = /^(\d+)(?:\.(\d+))?(%|k|m|b|ms|h|x)?$/.exec(f);
  if (!m) return 0;
  const decimals = m[2]?.length ?? 0;
  const scale = m[3] === 'k' ? 1e3 : m[3] === 'm' ? 1e6 : m[3] === 'b' ? 1e9 : m[3] === '%' ? 0.01 : 1;
  return (10 ** -decimals * scale) / 2;
}

/** A written figure is supported when a cited figure has the same value, allowing for how far it was rounded. */
export function figureSupported(fig: string, cited: ReadonlySet<string>, citedValues: readonly number[]): boolean {
  if (cited.has(fig)) return true;
  const v = figureValue(fig);
  if (v === null) return false;
  const tol = roundingTolerance(fig);
  return citedValues.some((c) => Math.abs(c - v) <= tol + 1e-9 * Math.max(1, Math.abs(c)));
}

/** Arithmetic identities and unit constants: zero/one, per-cent, per-mille, calendar and clock. */
export const CONSTANTS = new Set(['0', '1', '2', '3', '4', '7', '10', '12', '24', '52', '60', '100', '365', '1000']);

/** Evaluate + - * / and parentheses over figures; anything else is refused. */
export function arithmeticTokens(expr: string): string[] | null {
  const tokens = expr.match(/\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB](?![a-z]))?|[()+\-*/]/g);
  return tokens && tokens.join('').replace(/\s/g, '') === expr.replace(/\s/g, '') ? tokens : null;
}

export function evaluateExpression(expr: string): number | null {
  const tokens = arithmeticTokens(expr);
  if (!tokens) return null;
  let i = 0;
  const peek = () => tokens[i];
  const num = (): number | null => {
    const t = tokens[i++];
    if (t === '(') {
      const v = sum();
      if (tokens[i++] !== ')') return null;
      return v;
    }
    if (t === '-') {
      const v = num();
      return v === null ? null : -v;
    }
    return t === undefined ? null : figureValue(t);
  };
  const product = (): number | null => {
    let v = num();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = tokens[i++];
      const r = num();
      if (r === null) return null;
      v = op === '*' ? v * r : r === 0 ? null : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = tokens[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v !== null && Number.isFinite(v) && i === tokens.length ? v : null;
}
