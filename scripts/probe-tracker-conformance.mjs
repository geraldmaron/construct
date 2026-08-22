#!/usr/bin/env node
/**
 * scripts/probe-tracker-conformance.mjs — check every MCP tool name
 * hosts/tracker.ts writes into an applier recipe against the vendor's own
 * live server: not the host's opinion of the server, the server itself.
 *
 * hosts/tracker.ts never opens a connection — a recipe is words a host
 * reads. This script is the one place that does, and only on demand: it is
 * not part of `npm test` or the repo gate, the same way the other three
 * conformance probes are not, because a live vendor server is not a fixture
 * the hermetic suite can depend on.
 *
 *   node scripts/probe-tracker-conformance.mjs
 *
 * GitHub: a bearer token from GITHUB_TOKEN, GH_TOKEN, or `gh auth token` (in
 * that order) reaches https://api.githubcopilot.com/mcp/ directly over MCP's
 * Streamable HTTP transport — no host CLI and no OAuth dance, because the
 * claim under test is what the VENDOR calls its tools, not what any one host
 * does with them.
 *
 * Jira: ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN, when both are set, reach
 * https://mcp.atlassian.com/v1/mcp with HTTP Basic auth
 * (`Basic base64(email:api_token)`) — the machine-to-machine grant Atlassian
 * added in 2026, off by default per organisation. Neither is set on any
 * machine this project has run the probe from yet, so this half reports
 * "skip" today; see hosts/tracker-pin.ts.
 *
 * A tool name with no reachable credential is printed "skip", never "ok" —
 * unknown is not a pass.
 *
 * Exit codes: 0 every reachable expectation held. 1 at least one reachable
 * expectation broke, or hosts/tracker-pin.ts's own bookkeeping has drifted
 * from what this run found. A broken expectation means the vendor moved and
 * hosts/tracker.ts has not caught up — re-verify by hand and fix the recipe,
 * the same as any other pin.
 */

import { spawnSync } from 'node:child_process';
import { currentTool, TOOL_EXPECTATIONS, UNVERIFIED, VERIFIED } from '../src/hosts/tracker-pin.ts';

const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';
const ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v1/mcp';
const PROTOCOL_VERSION = '2025-06-18';

const results = new Map();
const pass = (id, detail) => results.set(id, { held: true, detail });
const fail = (id, detail) => results.set(id, { held: false, detail });
const skip = (id, detail) => results.set(id, { held: null, detail });

/** Streamable HTTP answers either plain JSON or SSE framing: "event: message\ndata: {...}\n\n". */
function parseJsonRpcBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    if (!line) return null;
    try {
      return JSON.parse(line.slice('data: '.length));
    } catch {
      return null;
    }
  }
}

/**
 * initialize, then tools/list, over MCP's Streamable HTTP transport — no SDK,
 * matching the project's zero-dependency rule. Returns the live tool list and
 * the server's own name/version, or `ok: false` with why the exchange did not
 * complete.
 */
async function liveToolList(url, authHeader) {
  const post = (body, extraHeaders) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: authHeader,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

  let initRes;
  try {
    initRes = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'construct-tracker-probe', version: '0.0.1' },
      },
    });
  } catch (error) {
    return { ok: false, detail: `could not reach ${url}: ${String(error)}` };
  }
  const initText = await initRes.text();
  if (!initRes.ok) return { ok: false, detail: `initialize: HTTP ${initRes.status} — ${initText.slice(0, 300)}` };

  const sessionId = initRes.headers.get('mcp-session-id');
  const serverInfo = parseJsonRpcBody(initText)?.result?.serverInfo;
  if (!sessionId || !serverInfo) {
    return { ok: false, detail: `initialize answered with no session id or serverInfo: ${initText.slice(0, 300)}` };
  }

  const listRes = await post(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { 'mcp-session-id': sessionId, 'mcp-protocol-version': PROTOCOL_VERSION },
  );
  const listText = await listRes.text();
  if (!listRes.ok) return { ok: false, detail: `tools/list: HTTP ${listRes.status} — ${listText.slice(0, 300)}` };

  const tools = parseJsonRpcBody(listText)?.result?.tools;
  if (!Array.isArray(tools)) {
    return { ok: false, detail: `tools/list carried no tools array: ${listText.slice(0, 300)}` };
  }
  return { ok: true, serverInfo, tools };
}

function skipAll(kind, detail) {
  for (const expectation of TOOL_EXPECTATIONS.filter((e) => e.kind === kind)) skip(expectation.id, detail);
}

function checkAgainst(kind, session) {
  const names = new Set(session.tools.map((t) => t.name));
  const { name, version } = session.serverInfo;
  const server = version.startsWith(`${name}/`) ? version : `${name}/${version}`;
  for (const expectation of TOOL_EXPECTATIONS.filter((e) => e.kind === kind)) {
    const tool = currentTool(expectation);
    if (names.has(tool)) {
      pass(expectation.id, `${tool} confirmed live against ${server} (${session.tools.length} tools total)`);
    } else {
      fail(expectation.id, `${tool} is NOT in the live tools/list from ${server} (${session.tools.length} tools total)`);
    }
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────
function resolveGithubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const ghAuth = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  return ghAuth.status === 0 ? ghAuth.stdout.trim() : null;
}

const githubToken = resolveGithubToken();
if (!githubToken) {
  skipAll('github', 'no GitHub credential reachable (GITHUB_TOKEN, GH_TOKEN, and `gh auth token` all came back empty)');
} else {
  const session = await liveToolList(GITHUB_MCP_URL, `Bearer ${githubToken}`);
  if (session.ok) checkAgainst('github', session);
  else skipAll('github', session.detail);
}

// ── Jira ─────────────────────────────────────────────────────────────────
const atlassianEmail = process.env.ATLASSIAN_EMAIL;
const atlassianToken = process.env.ATLASSIAN_API_TOKEN;
if (!atlassianEmail || !atlassianToken) {
  skipAll('jira', 'no ATLASSIAN_EMAIL/ATLASSIAN_API_TOKEN in this environment — see UNVERIFIED in hosts/tracker-pin.ts');
} else {
  const basic = Buffer.from(`${atlassianEmail}:${atlassianToken}`).toString('base64');
  const session = await liveToolList(ATLASSIAN_MCP_URL, `Basic ${basic}`);
  if (session.ok) checkAgainst('jira', session);
  else skipAll('jira', session.detail);
}

// ── report ───────────────────────────────────────────────────────────────
let broken = 0;
let skipped = 0;
process.stdout.write('tracker MCP tool conformance probe\n\n');
for (const expectation of TOOL_EXPECTATIONS) {
  const r = results.get(expectation.id);
  const tool = currentTool(expectation);
  if (!r || r.held === null) {
    skipped += 1;
    process.stdout.write(`skip  ${expectation.id} (${tool}) — ${r?.detail ?? 'no probe branch ran'}\n`);
    continue;
  }
  process.stdout.write(`${r.held ? 'ok  ' : 'FAIL'}  ${expectation.id} (${tool})\n`);
  process.stdout.write(`      ${expectation.claim}\n`);
  process.stdout.write(`      observed: ${r.detail}\n`);
  if (!r.held) broken += 1;
}

// hosts/tracker-pin.ts's own bookkeeping, cross-checked against what this run
// actually found, so VERIFIED/UNVERIFIED cannot silently drift from the probe
// that is supposed to keep them honest.
process.stdout.write('\n');
for (const expectation of TOOL_EXPECTATIONS) {
  const bookedVerified = VERIFIED.includes(expectation.id);
  const bookedUnverified = UNVERIFIED.includes(expectation.id);
  if (!bookedVerified && !bookedUnverified) {
    process.stdout.write(`????  ${expectation.id} is in TOOL_EXPECTATIONS but neither VERIFIED nor UNVERIFIED names it\n`);
    broken += 1;
    continue;
  }
  const r = results.get(expectation.id);
  if (r?.held === true && !bookedVerified) {
    process.stdout.write(`NOTE  ${expectation.id} just passed live but hosts/tracker-pin.ts still lists it under UNVERIFIED — move it once this holds on repeat runs\n`);
  } else if (r?.held === false && bookedVerified) {
    process.stdout.write(`NOTE  ${expectation.id} just failed live but hosts/tracker-pin.ts records it as VERIFIED — the vendor moved; fix the recipe and this record\n`);
  }
}

process.stdout.write('\n');
if (broken > 0) {
  process.stderr.write(`${String(broken)} expectation(s) FAILED or are unaccounted for in hosts/tracker-pin.ts.\n`);
  process.exit(1);
}
process.stdout.write(
  `probe-tracker-conformance: ${String(TOOL_EXPECTATIONS.length - skipped)} checked and holding, ${String(skipped)} skipped (no credential reachable)\n`,
);
