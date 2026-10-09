/**
 * kernel/project/urls.ts — one reading of a web address, so an item recorded
 * under its address and a citation of that address meet whatever way each
 * was written.
 *
 * Only http and https count. The fragment is dropped (it points inside a
 * page, it does not name another one), http folds to https, and a trailing
 * slash on a path other than the root is dropped. The URL parser already
 * lowercases the host and drops a default port. The query is kept: on many
 * wikis it is what names the page.
 */

import { hasKnownSecret } from '../render/redact.ts';
import { locatorCarriesCredentials } from './sources-file.ts';

/** The comparable form of an http(s) address, or null when the reference is not one. */
export function normalizeUrl(ref: string): string | null {
  if (typeof ref !== 'string') return null;
  let url: URL;
  try {
    url = new URL(ref.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null;
  url.hash = '';
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
  if (normalizeUrl(ref) === null) return 'is not an http(s) address';
  const url = new URL(ref.trim());
  const carried = [url.search, url.hash, ...url.searchParams.keys(), ...url.searchParams.values()];
  if (locatorCarriesCredentials(ref) || carried.some((part) => hasKnownSecret(part))) return 'carries credentials; give the address without them';
  return null;
}
