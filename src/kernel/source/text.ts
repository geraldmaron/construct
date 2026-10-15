/** Shared retained source-text budget. Whole-source fingerprints remain separate. */
import { redact } from '../render/redact.ts';
import { StringDecoder } from 'node:string_decoder';

export const SOURCE_TEXT_CAP_BYTES = 256 * 1024;

/** Keep a credential-screened UTF-8 prefix without splitting a code point.
 * Inspect the full supplied text before cutting, so a secret crossing the
 * boundary cannot leave a retained credential prefix. */
export function captureSourceText(value: string): { readonly text: string; readonly truncated: boolean } {
  const clean = redact(value);
  const totalBytes = Buffer.byteLength(clean);
  // At most one extra UTF-16 code unit beyond the byte budget is needed to
  // include a boundary surrogate pair. Never allocate a whole-input Buffer.
  const bytes = Buffer.from(clean.slice(0, SOURCE_TEXT_CAP_BYTES + 1), 'utf8');
  let end = Math.min(bytes.length, SOURCE_TEXT_CAP_BYTES);
  if (end < bytes.length) while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { text: redact(bytes.toString('utf8', 0, end)), truncated: totalBytes > end };
}

/** A streaming reader has not supplied the rest of the file. Withhold the
 * incomplete final token and any unfinished private-key block before screening;
 * their missing suffix must not prevent credential detection. StringDecoder
 * keeps an unfinished UTF-8 sequence out of the retained text entirely. */
export function captureSourcePrefix(bytes: Buffer, incomplete: boolean): { readonly text: string; readonly truncated: boolean } {
  let text = incomplete ? new StringDecoder('utf8').write(bytes) : bytes.toString('utf8');
  if (incomplete) {
    text = text.replace(/\S+$/u, '');
    for (const match of text.matchAll(/-----BEGIN[^-]*PRIVATE KEY-----/g)) {
      if (!/-----END[^-]*PRIVATE KEY-----/.test(text.slice(match.index + match[0].length))) {
        text = text.slice(0, match.index) + '[redacted]';
        break;
      }
    }
  }
  const capture = captureSourceText(text);
  return { text: capture.text, truncated: incomplete || capture.truncated };
}
