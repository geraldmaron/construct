/**
 * tests/e2e/lib/embed-probes.mjs — Tier-7 "invocable by other applications"
 * probes.
 *
 * Construct's value proposition includes being callable from outside its own
 * CLI. Five surfaces carry the same five embedded contracts (capability
 * discovery, triage/plan recommendation, model resolution, execution
 * resolution, workflow invocation):
 *
 *   - CLI-JSON   — a host shell pipes `construct <verb> --json`
 *   - SDK        — a Node host imports @geraldmaron/construct
 *   - MCP        — an external MCP client calls Construct's MCP tools
 *   - HTTP+SSE   — a thin client drives the local orchestration runtime
 *   - npx        — a host shells out with no global install
 *
 * Every probe asserts the same envelope invariants so a host that pins the
 * contract major version sees a stable shape across surfaces: a `contractVersion`
 * is present and compatible, and the serialized response carries no plaintext
 * secret. CLI-JSON and SDK probes run without a server and are implemented here;
 * MCP and HTTP+SSE require a live server stood up by the scenario and expose a
 * documented call shape the runner drives during the scenario phase.
 *
 * Capture only — verdicts are assigned by the runner from probe output.
 */

import { spawnSync } from 'node:child_process';
import { CONTRACT_VERSION, isClientCompatible } from '../../../lib/embedded-contract/contract-version.mjs';

export const ENVELOPE_VERSION_FIELDS = ['contractVersion', 'constructVersion'];

// Structural secret scan re-asserted on the probe side. The contract layer
// redacts at the source; a host integrator wants proof in the payload it
// actually receives, so the probe re-scans the serialized envelope for the
// common secret shapes rather than trusting the producer.

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\b[A-Za-z0-9._-]+:[A-Za-z0-9]{16,}@/,
  /"(?:password|secret|token|api[_-]?key)"\s*:\s*"[^"]{8,}"/i,
];

export function assertNoSecrets(serialized) {
  const hits = SECRET_PATTERNS.filter((re) => re.test(serialized)).map((re) => re.source);
  return { ok: hits.length === 0, hits };
}

// An envelope is contract-valid when it declares a contractVersion the current
// contract accepts and leaks no secret. constructVersion is recorded when
// present but not required of every surface (CLI-JSON envelopes carry it; some
// SDK calls return the bare contract object).

export function assertEnvelope(obj) {
  const problems = [];
  const serialized = JSON.stringify(obj ?? null);

  const cv = obj?.contractVersion ?? obj?.contract_version ?? null;
  if (!cv) problems.push('missing contractVersion');
  else if (!isClientCompatible(cv)) problems.push(`incompatible contractVersion ${cv} vs ${CONTRACT_VERSION}`);

  const secrets = assertNoSecrets(serialized);
  if (!secrets.ok) problems.push(`secret-shaped content: ${secrets.hits.join(', ')}`);

  return { ok: problems.length === 0, problems, contractVersion: cv };
}

// CLI-JSON pipeline: the five contract verbs, each emitting a JSON envelope on
// stdout. The probe runs each, parses stdout as JSON, and asserts the envelope.
// Verbs that need scenario-specific inputs (workflow invoke) receive them via
// `inputsByVerb`.

export const CLI_JSON_VERBS = [
  { id: 'capability', argv: ['capability', 'describe', '--json'] },
  { id: 'intake', argv: ['intake', 'classify', '--json'] },
  { id: 'models', argv: ['models', 'resolve', '--json'] },
  { id: 'execution', argv: ['execution', 'resolve', '--json'] },
  { id: 'workflow', argv: ['workflow', 'invoke', '--json'] },
];

export function probeCliJson({ launcher, cwd, env, inputsByVerb = {}, timeoutMs = 30_000 }) {
  const results = [];
  for (const verb of CLI_JSON_VERBS) {
    const argv = [...verb.argv, ...(inputsByVerb[verb.id] || [])];
    const res = spawnSync(process.execPath, [launcher, ...argv], {
      cwd, env, encoding: 'utf8', timeout: timeoutMs, input: '',
    });
    let parsed = null;
    let parseError = null;
    try { parsed = JSON.parse(res.stdout || 'null'); } catch (e) { parseError = e.message; }
    results.push({
      verb: verb.id,
      argv,
      status: res.status,
      parseError,
      envelope: parsed ? assertEnvelope(parsed) : { ok: false, problems: [`unparseable stdout: ${parseError}`] },
    });
  }
  return { surface: 'cli-json', results };
}

// SDK surface: a host imports the package by name and calls the five exported
// functions. The host script is committed under fixtures/host-scripts and run
// with the scenario's resolved module path so no global install is involved.

export function probeSdk({ hostScript, cwd, env, timeoutMs = 30_000 }) {
  const res = spawnSync(process.execPath, [hostScript], {
    cwd, env, encoding: 'utf8', timeout: timeoutMs, input: '',
  });
  let parsed = null;
  let parseError = null;
  try { parsed = JSON.parse(res.stdout || 'null'); } catch (e) { parseError = e.message; }
  return {
    surface: 'sdk',
    status: res.status,
    stderr: res.stderr || '',
    parseError,
    report: parsed,
  };
}

// MCP and HTTP+SSE surfaces require a live server the scenario stands up. The
// probe contract is fixed here; the runner supplies the connection handle during
// the scenario phase and feeds responses back through assertEnvelope.

export function describeMcpProbe() {
  return {
    surface: 'mcp',
    tools: ['capability_describe', 'triage_recommend', 'model_resolve', 'construct_execution_resolve', 'workflow_invoke'],
    assertion: 'each tool response passes assertEnvelope and matches its CLI-JSON counterpart structurally',
  };
}

export function describeHttpSseProbe() {
  return {
    surface: 'http-sse',
    flow: ['POST /api/orchestration/runs', 'GET /api/orchestration/runs/:id/events (SSE)', 'POST /api/orchestration/runs/:id/cancel'],
    assertion: 'lifecycle events arrive in order; run envelope passes assertEnvelope; Authorization-header clients are CSRF-exempt; rate limit returns a typed error, not bare 429',
  };
}
