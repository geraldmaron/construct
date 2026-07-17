/**
 * lib/mcp/dispatch-envelope.mjs — CallTool request envelope: identity, rate
 * limiting, the destructive gate, tracing, timeout, and audit logging around
 * every tool dispatch.
 *
 * Extracted from lib/mcp/server.mjs (construct-rf26.10) so the server module
 * stays a thin wiring layer; behavior is unchanged — same envelope order,
 * same error shapes. createToolCallHandler takes the pieces server.mjs owns
 * (ROOT_DIR, DEPLOYMENT_MODE, the tool-name dispatcher) and returns the async
 * function registered against CallToolRequestSchema. The handler references
 * neither the MCP Server instance nor any module-scoped catalog state — every
 * dependency it needs is passed in or imported here.
 */
import { withGenAiSpan, GenAiAttrs, extractTraceContext } from '../telemetry/otel-tracer.mjs';
import { TOOL_SAFETY } from './tool-safety.mjs';
import { checkDestructiveGate } from './destructive-gate.mjs';
import { ToolRateLimiter, ToolRateLimited } from './tool-rate-limit.mjs';
import { appendAuditRecord } from '../audit-trail.mjs';
import { Broker, isBrokered } from './broker.mjs';
import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { resolveIdentity, identityToRecord, IdentityError, identityRole } from '../identity.mjs';
import { isGatewayName } from './tool-recovery.mjs';
import { validateToolInput, validateToolOutput } from './tool-schema-validate.mjs';

// Solo mode never instantiates lib/mcp/broker.mjs's Broker (role/policy-based,
// wired only for team/enterprise), so the live dispatch path otherwise has no
// rate bound and no audit trail in the default deployment. windowMs 0 disables,
// mirroring the CONSTRUCT_MCP_TOOL_TIMEOUT_MS override convention below.

export function createToolCallHandler({ ROOT_DIR, DEPLOYMENT_MODE, dispatchToolByName, toolDefsByName = new Map() }) {
  const toolRateLimiter = new ToolRateLimiter({
    windowMs: (() => {
      const raw = Number(process.env.CONSTRUCT_MCP_TOOL_RATE_WINDOW_MS);
      return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
    })(),
  });

  // Broker singleton keyed by rootDir. A single instance shared across every
  // tool call accumulates rate-limit state correctly.
  const _brokerByRootDir = new Map();
  function getBroker(rootDir) {
    if (!_brokerByRootDir.has(rootDir)) {
      const persistPath = ApprovalQueue.resolvePersistPath(rootDir, DEPLOYMENT_MODE);
      const approvalQueue = new ApprovalQueue({ persistPath });
      _brokerByRootDir.set(rootDir, new Broker({ rootDir, approvalQueue }));
    }
    return _brokerByRootDir.get(rootDir);
  }

  return async function handleToolCall(request) {
    const { name, arguments: args = {} } = request.params;
    const callStart = Date.now();

    let identity;
    try {
      identity = resolveIdentity(request.params || {}, { env: process.env, cwd: ROOT_DIR });
    } catch (err) {
      if (err instanceof IdentityError) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] };
      }
      throw err;
    }

    // Extract W3C traceparent from params._meta (SEP-414 propagation). Tracing
    // must never break dispatch — a malformed _meta should not fail the call.
    let parentCtx = {};
    try { parentCtx = await extractTraceContext(request.params?._meta || {}); } catch { /* tracing optional */ }

    // The `call` gateway's own class would conflate every long-tail tool's budget
    // into one bucket; rate-limit and audit-log the real underlying tool instead.

    const innerTool = name === 'call' && typeof args?.tool === 'string' && !isGatewayName(args.tool) ? args.tool : null;
    const auditedTool = innerTool ?? name;
    const safetyClass = TOOL_SAFETY[auditedTool]?.class ?? 'read';

    let toolResult;

    // Rate limiting is the outermost pre-dispatch check: even calls the
    // destructive gate would refuse must consume their class budget, so a flood
    // of unauthorized destructive calls is throttled instead of probing freely.
    let rateLimitError = null;
    try {
      toolRateLimiter.check(auditedTool, safetyClass);
    } catch (err) {
      if (err instanceof ToolRateLimited) rateLimitError = err;
      else throw err;
    }

    // Destructive tool gate: any tool classified as destructive must pass the
    // out-of-band approval token check before dispatch. For the `call` gateway
    // the inner tool's classification determines the check; the resolution token
    // lives in the inner args object, not the gateway envelope.
    const gateArgs = name === 'call' ? (args?.args || {}) : args;
    const gateResult = checkDestructiveGate(auditedTool, gateArgs);

    // Every catalog tool's declared inputSchema is enforced here, ahead of both
    // the destructive gate and the handler — a malformed call from either the
    // direct CallTool path or the `call` gateway (already unwrapped to the real
    // tool + its own args above) is rejected with a typed error before it can
    // reach handler logic or the authorization check.
    const toolDef = toolDefsByName.get(auditedTool);
    const inputValidation = toolDef ? validateToolInput(toolDef, gateArgs) : { valid: true, errors: [] };

    if (rateLimitError) {
      toolResult = { error: rateLimitError.message };
    } else if (!inputValidation.valid) {
      toolResult = {
        error: {
          code: 'INVALID_INPUT',
          message: `Invalid input for tool '${auditedTool}': ${inputValidation.errors.join('; ')}`,
          details: { tool: auditedTool, errors: inputValidation.errors },
        },
      };
    } else if (gateResult.gated && !gateResult.allowed) {
      toolResult = { error: gateResult.reason };
    } else {

    // Bound every tool call. A tool that stalls (a stuck external extractor, a slow
    // model load, a wedged subprocess) must surface a clean timeout error to the
    // client rather than block the request until the client gives up and reports an
    // opaque failure. Override with CONSTRUCT_MCP_TOOL_TIMEOUT_MS (0 disables).
    const TOOL_TIMEOUT_MS = (() => {
      const raw = Number(process.env.CONSTRUCT_MCP_TOOL_TIMEOUT_MS);
      return Number.isFinite(raw) && raw >= 0 ? raw : 120_000;
    })();

    // A GenAI span per dispatch records the real underlying tool, its safety
    // class, and the serialized result size (a token proxy) for every call, so
    // per-tool calls/latency/errors are measured. Tracing never fails the call:
    // on any dispatch error the inner catch resolves to an { error } object, so
    // the span closes OK and the client still gets a structured error payload.

    toolResult = await withGenAiSpan(
        `execute_tool ${auditedTool}`,
        { [GenAiAttrs.TOOL_NAME]: auditedTool, 'construct.tool.safety_class': safetyClass, [GenAiAttrs.MCP_METHOD]: 'tools/call' },
        async (span) => {
          const dispatch = (async () => {
            let result;
            try {
              if (isBrokered(process.env, { cwd: ROOT_DIR })) {
                const broker = getBroker(ROOT_DIR);
                const brokered = await broker.invoke({
                  role: identityRole(identity) || 'member',
                  tool: auditedTool,
                  action: auditedTool,
                  toolArgs: args,
                  requestedBy: identityToRecord(identity),
                  execute: () => dispatchToolByName(name, args),
                });
                if (brokered && brokered.status === 'awaiting_approval') {
                  result = brokered;
                } else {
                  result = brokered.result;
                }
              } else {
                result = await dispatchToolByName(name, args);
              }
            } catch (err) {
              result = { error: err.message ?? String(err) };
            }
            return result;
          })();

          let out;
          if (!TOOL_TIMEOUT_MS) {
            out = await dispatch;
          } else {
            let timer;
            const timeout = new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`tool ${name} timed out after ${Math.round(TOOL_TIMEOUT_MS / 1000)}s`)),
                TOOL_TIMEOUT_MS,
              );
            });
            try {
              out = await Promise.race([dispatch, timeout]);
            } catch (err) {
              out = { error: err.message ?? String(err) };
            } finally {
              clearTimeout(timer);
            }
          }

          // A result already carrying an `error` (a thrown/timeout/dispatch
          // failure) or a broker awaiting_approval envelope is infrastructure
          // shape, not the tool's own success payload, so it is exempt from the
          // handler's outputSchema — only a genuine success return is held to
          // that contract, so a handler bug (wrong type, dropped field) is
          // caught without also flagging a well-formed error/pending envelope.
          const looksLikeInfraShape = Boolean(out && typeof out === 'object' && ('error' in out || out.status === 'awaiting_approval'));
          if (toolDef && !looksLikeInfraShape) {
            const outputValidation = validateToolOutput(toolDef, out);
            if (!outputValidation.valid) {
              console.error(`[construct-mcp] tool '${auditedTool}' returned output that fails its declared outputSchema: ${outputValidation.errors.join('; ')}`);
              out = {
                error: {
                  code: 'INTERNAL',
                  message: `Tool '${auditedTool}' returned output that does not match its declared schema.`,
                  details: { tool: auditedTool, errors: outputValidation.errors },
                },
              };
            }
          }

          const isError = Boolean(out && typeof out === 'object' && 'error' in out);
          span.setAttribute('construct.tool.result_bytes', JSON.stringify(out ?? null).length);
          span.setAttribute('construct.tool.ok', !isError);
          return out;
        },
        parentCtx,
      );
    }

    // Value-free: tool name and safety class only, never call args or result
    // content. Logging must never break dispatch, matching the tracing guard above.

    try {
      appendAuditRecord({
        ts: new Date().toISOString(),
        agent: 'mcp-server',
        tool: auditedTool,
        target: safetyClass,
        ok: !(toolResult && typeof toolResult === 'object' && 'error' in toolResult),
        duration_ms: Date.now() - callStart,
      });
    } catch { /* audit trail unavailable must not fail the call */ }

    // Every tool now declares an outputSchema (see withSafetyEnvelope); the MCP SDK
    // client validates that declaration against the response and rejects a tool
    // call whose result omits structuredContent. toolResult is always a JSON object
    // across every dispatch branch, so it satisfies each tool's schema directly.

    return {
      content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
      structuredContent: toolResult,
    };
  };
}
