/**
 * kernel/project/urls.ts — one reading of a web address, so an item recorded
 * under its address and a citation of that address meet whatever way each
 * was written.
 *
 * Complete Markdown, Slack and autolink wrappers are presentation only.
 * Only http and https count. Generic document heading fragments are dropped;
 * provider comment/review fragments retain identity. Http folds to https, and a trailing
 * slash on a path other than the root is dropped. The URL parser already
 * lowercases the host and drops a default port. The query is kept: on many
 * wikis it is what names the page. Only known permalink navigation fields
 * are removed; unknown fields remain significant.
 */

import { hasKnownSecret } from '../render/redact.ts';

/** Use the parser's userinfo and inspect escaped signatures before dropping any
 * navigation fields. Known secret signatures are ASCII; decoding those bytes
 * independently keeps a malformed escape elsewhere from disabling this check.
 * This is one URL decoding pass for inspection only, never a changed address. */
function carriesCredentials(url: URL): boolean {
  if (url.username !== '' || url.password !== '') return true;
  if ([...url.searchParams.keys(), ...url.searchParams.values()].some(hasKnownSecret)) return true;
  return [url.search, url.hash].some((part) => hasKnownSecret(part) || hasKnownSecret(part.replace(/%([0-7][0-9a-f])/gi, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))));
}

/** One parser; stored URL fields stay plain while citations may use complete wrappers. */
function parseUrl(ref: string, presentation: boolean): URL | null {
  if (typeof ref !== 'string') return null;
  let url: URL;
  try {
    const raw = ref.trim();
    // Match the entire presentation. Labels never become evidence identifiers.
    const address = presentation ? /^<([^<>|\s]+)(?:\|[^<>\r\n]*)?>$/.exec(raw)?.[1]
      ?? /^\[[^\]\r\n]*\]\((https?:\/\/[^\s]+)\)$/.exec(raw)?.[1]
      ?? raw : raw;
    url = new URL(address);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null;
  return url;
}

/** Whether a complete HTTP(S) reference carries credentials. Opaque item keys
 * and display labels are not URLs and cannot become addresses through this check. */
export function urlCarriesCredentials(ref: string): boolean {
  const url = parseUrl(ref, true);
  return url !== null && carriesCredentials(url);
}

/** The comparable form of an http(s) address, or null when the reference is not one. */
export function normalizeUrl(ref: string): string | null {
  const url = parseUrl(ref, true);
  if (!url) return null;
  // Never discard credentials into an otherwise matching address.
  if (carriesCredentials(url)) return null;
  const slackMessage = url.hostname.endsWith('.slack.com') && /^\/archives\/[^/]+\/p\d+\/?$/.test(url.pathname);
  const jiraIssue = url.hostname.endsWith('.atlassian.net') && /^\/browse\/[A-Z][A-Z0-9_]*-\d+\/?$/.test(url.pathname);
  const githubDiscussion = url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/.*)?$/.test(url.pathname);
  // These permalink paths identify the item. Keep every unknown parameter,
  // including Jira focusedCommentId; never infer identity from query text.
  if (slackMessage) for (const key of ['thread_ts', 'cid']) url.searchParams.delete(key);
  if (jiraIssue) url.searchParams.delete('atlOrigin');
  // Provider comments/reviews can be addressed by fragments. Generic document
  // heading fragments retain the historical page-level comparison behavior.
  if (!slackMessage && !jiraIssue && !githubDiscussion) url.hash = '';
  url.protocol = 'https:';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/**
 * Why an address cannot be kept as a recorded item's address, or null when it can: it has to be http(s), and it
 * must not carry credentials (a user and secret before the host, or a token shaped like a known provider's key in
 * the query or fragment). The host and path name the page and are not searched for key shapes: a page slug such as
 * Risk-Assessment-for-Q3-Launch holds "sk-" followed by a run of letters, which is a title, not a key.
 */
export function urlProblem(ref: string): string | null {
  const url = parseUrl(ref, false);
  if (!url) return 'is not an http(s) address';
  if (carriesCredentials(url)) return 'carries credentials; give the address without them';
  return null;
}
