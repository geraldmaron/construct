/**
 * connectors/jira/api.ts — the wire: where the credential comes from, how a
 * request is addressed, and how Jira's two content shapes are read and
 * written.
 *
 * The credential arrives through the environment and nowhere else. That is
 * the same posture the role token seam holds and for the same reason: an
 * environment variable of a process crosses neither a transcript nor a
 * command line, and a token that reaches a stored session is a token that
 * has leaked. Nothing here reads `process.env` itself — a plain record is
 * passed in, so the live environment is read at the edge that owns it.
 *
 * Nothing here decides anything. Which project is surveyed, whether a
 * change may be carried out, what a failure means for the record: all of
 * that is connector.ts and the kernel behind it. This module knows only
 * how to address the API named in pin.ts and how to speak its two content
 * shapes.
 */

import { API_BASE_PATH } from './pin.ts';
import { redact } from '../../kernel/render/redact.ts';

export const JIRA_SITE_ENV = 'CONSTRUCT_JIRA_SITE';
export const JIRA_EMAIL_ENV = 'CONSTRUCT_JIRA_EMAIL';
export const JIRA_TOKEN_ENV = 'CONSTRUCT_JIRA_API_TOKEN';

export interface JiraCredentials {
  /** Origin of the Jira site, always https — `https://acme.atlassian.net`. */
  readonly site: string;
  readonly email: string;
  readonly token: string;
}

/**
 * The credential this connector runs on, or null when the environment does
 * not carry one. Null is also the answer to "is this connector available",
 * which is what the licensed ladder asks before it chooses a path: a
 * connector with no credential is a connector that is not there.
 */
export function readJiraCredentials(
  env: Record<string, string | undefined>,
): JiraCredentials | null {
  const site = (env[JIRA_SITE_ENV] ?? '').trim();
  const email = (env[JIRA_EMAIL_ENV] ?? '').trim();
  const token = (env[JIRA_TOKEN_ENV] ?? '').trim();
  if (site === '' || email === '' || token === '') return null;
  return { site: siteOrigin(site), email, token };
}

/** The one host suffix a Jira Cloud site can have. Nothing else is a Jira site. */
const JIRA_CLOUD_SUFFIX = '.atlassian.net';

/** Whether a host is a Jira Cloud site — a subdomain of atlassian.net, never the bare apex. */
function isJiraCloudHost(host: string): boolean {
  return host.length > JIRA_CLOUD_SUFFIX.length && host.endsWith(JIRA_CLOUD_SUFFIX);
}

/**
 * A site named with or without a scheme, as an https origin — host only, no
 * path, no trailing slash. https is forced rather than honored: the credential
 * rides in a header on every request, and a site written as `http://` would put
 * it on the wire in the clear.
 *
 * The host is validated, not merely reformatted. Stripping a leading scheme and
 * pasting `https://` in front leaves the rest untouched, so a value like
 * `evil.com/@acme.atlassian.net` becomes an origin whose host is `evil.com` —
 * an attacker's server, receiving the Authorization header on every call. So
 * the string is parsed and the resolved host checked against the one suffix a
 * Jira Cloud site can carry; anything else is refused by name rather than
 * silently addressed.
 */
export function siteOrigin(site: string): string {
  const bare = site.trim().replace(/^[a-zA-Z][\w+.-]*:\/\//, '').replace(/\/+$/, '');
  let host: string;
  try {
    host = new URL(`https://${bare}`).hostname;
  } catch {
    throw new Error(`${JIRA_SITE_ENV} is not a readable site: ${site}`);
  }
  if (!isJiraCloudHost(host)) {
    throw new Error(
      `${JIRA_SITE_ENV} must be a Jira Cloud site ending in ${JIRA_CLOUD_SUFFIX} — refusing ${host}, ` +
        'which would send the credential to a host that is not Jira.',
    );
  }
  return `https://${host}`;
}

export function authorizationHeader(credentials: JiraCredentials): string {
  const pair = `${credentials.email}:${credentials.token}`;
  return `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
}

/** Where a person opens an issue, for a receipt they can check by clicking it. */
export function issueBrowseUrl(site: string, key: string): string {
  return `${siteOrigin(site)}/browse/${key}`;
}

export interface JiraCall {
  readonly method: 'GET' | 'POST' | 'PUT';
  /** Rooted at the site, starting with `/rest/api/3`. */
  readonly path: string;
  readonly body?: unknown;
}

export interface JiraResult {
  readonly status: number;
  /** The parsed body, or null for an empty one — a 204 has no body at all. */
  readonly body: unknown;
}

/**
 * One round trip. Never throws for a status: a 401 and a 404 are answers
 * this connector records, not exceptions it handles. A transport that could
 * not reach the site at all does throw, because "the request never happened"
 * and "the request was refused" are different facts and a caller has to be
 * able to tell them apart.
 */
export type JiraTransport = (call: JiraCall) => Promise<JiraResult>;

export function createTransport(
  credentials: JiraCredentials,
  fetchImpl: typeof fetch = fetch,
): JiraTransport {
  const authorization = authorizationHeader(credentials);
  return async (call) => {
    const response = await fetchImpl(`${credentials.site}${call.path}`, {
      method: call.method,
      headers: {
        authorization,
        accept: 'application/json',
        ...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        // A body that is not JSON is still evidence — a proxy's HTML error
        // page is the usual one — and it is kept as text so the reason a
        // caller reports names what actually came back.
        body = text;
      }
    }
    return { status: response.status, body };
  };
}

/**
 * Why a call was refused, in the words Jira used. The status alone tells a
 * reader almost nothing, and the credential must never appear here: what
 * comes out of this is written into the record and read by a person.
 */
export function failureText(result: JiraResult): string {
  const body = result.body;
  if (typeof body === 'string' && body.trim() !== '') {
    // A non-JSON body is whatever a remote returned — a proxy's error page can
    // echo a request header, so credential shapes are stripped before the
    // sliced text reaches the record a person reads.
    return `Jira answered ${String(result.status)}: ${redact(body.trim().slice(0, 300))}`;
  }
  const record = (body ?? {}) as { errorMessages?: unknown; errors?: unknown };
  const messages = Array.isArray(record.errorMessages)
    ? record.errorMessages.filter((m): m is string => typeof m === 'string')
    : [];
  const fields = Object.entries((record.errors ?? {}) as Record<string, unknown>).map(
    ([field, message]) => `${field}: ${String(message)}`,
  );
  const said = [...messages, ...fields].join('; ');
  return said === ''
    ? `Jira answered ${String(result.status)} and said nothing about why`
    : `Jira answered ${String(result.status)}: ${said}`;
}

export interface AdfNode {
  readonly type: string;
  readonly text?: string;
  readonly content?: readonly AdfNode[];
}

export interface AdfDocument {
  readonly type: 'doc';
  readonly version: 1;
  readonly content: readonly AdfNode[];
}

/**
 * Plain text as the document node the v3 API takes for a description. One
 * paragraph per non-empty line: an empty text node is not a valid node, so
 * blank lines become paragraph breaks rather than empty paragraphs.
 */
export function adfFromText(text: string): AdfDocument {
  const paragraphs = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
  return { type: 'doc', version: 1, content: paragraphs };
}

/**
 * The words inside a description, whatever nodes carry them. Used to
 * measure what a read actually holds, so an issue's read row counts the
 * text a reader would see rather than the size of the markup around it.
 */
export function textFromAdf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '';
  const node = value as AdfNode;
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  const separator = node.type === 'doc' || node.type === 'bulletList' || node.type === 'orderedList' ? '\n' : '';
  return node.content.map(textFromAdf).join(separator);
}

/** The site-rooted path for one issue. */
export function issuePath(key: string): string {
  return `${API_BASE_PATH}/issue/${encodeURIComponent(key)}`;
}
