/**
 * tests/helpers/ollama-record-proxy.mjs — Recording reverse-proxy for Ollama's OpenAI-compatible API.
 *
 * Sits between an OpenCode session and the real Ollama server: every request is
 * forwarded verbatim to the upstream `/v1` endpoint and the response streamed
 * back unchanged, while the outbound payload is measured and appended to a JSONL
 * log. This is the measurement instrument for the local-model A/B test — it
 * captures what actually reaches the model (tool count, system-prompt token
 * estimate, body bytes, which sampler params survived the OpenAI-compatible
 * boundary) so the "vanilla vs Construct" payload difference is quantified rather
 * than assumed.
 *
 * The OpenAI-compatible boundary silently drops Ollama-specific params (num_ctx,
 * repeat_penalty); recording the raw inbound body is how we prove that.
 */
import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const TOKENS_PER_CHAR = 0.25;

function estimateTokens(text) {
  return Math.ceil((text || "").length * TOKENS_PER_CHAR);
}

// The OpenAI chat schema carries the model-facing payload in `messages` and
// `tools`; everything else on the body is a sampler or routing knob. We measure
// the parts that consume the context window plus which sampler keys arrived, so
// the log shows both the crush (messages+tools) and the dropped-param story.

function measurePayload(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { parseError: true, bodyBytes: Buffer.byteLength(body) };
  }

  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const systemText = messages
    .filter((m) => m && m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
  const allText = messages
    .map((m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "")))
    .join("\n");
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const toolNames = tools
    .map((t) => t?.function?.name || t?.name)
    .filter(Boolean);

  const samplerKeys = [
    "temperature",
    "top_p",
    "top_k",
    "frequency_penalty",
    "presence_penalty",
    "repeat_penalty",
    "num_ctx",
    "stop",
    "max_tokens",
  ].filter((k) => k in parsed);

  return {
    model: parsed.model,
    bodyBytes: Buffer.byteLength(body),
    messageCount: messages.length,
    systemPromptChars: systemText.length,
    systemPromptTokensEst: estimateTokens(systemText),
    allMessagesTokensEst: estimateTokens(allText),
    toolCount: tools.length,
    toolSchemaTokensEst: estimateTokens(JSON.stringify(tools)),
    totalInputTokensEst: estimateTokens(allText) + estimateTokens(JSON.stringify(tools)),
    toolNames,
    samplerKeysPresent: samplerKeys,
    stream: Boolean(parsed.stream),
  };
}

/**
 * Start the recording proxy.
 * @param {object} options
 * @param {number} options.port - Port to listen on.
 * @param {string} options.upstream - Upstream Ollama base (e.g. http://127.0.0.1:11434).
 * @param {string} options.logPath - JSONL file to append per-request measurements.
 * @param {string} [options.label] - Arm label stamped on every record.
 * @returns {Promise<{ url, close, records }>}
 */
export function startRecordProxy({ port, upstream = "http://127.0.0.1:11434", logPath, rawPath, label = "" }) {
  const records = [];
  let rawMaxBytes = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      if (req.method === "POST" && req.url.includes("/chat/completions")) {
        const measured = { label, url: req.url, ...measurePayload(body) };
        records.push(measured);
        if (logPath) {
          try { appendFileSync(logPath, JSON.stringify(measured) + "\n"); } catch { /* advisory */ }
        }
        // Persist the single largest body so a real OpenCode request can be
        // replayed verbatim via curl when bisecting the collapse trigger.
        if (rawPath && Buffer.byteLength(body) > rawMaxBytes) {
          rawMaxBytes = Buffer.byteLength(body);
          try { writeFileSync(rawPath, body); } catch { /* advisory */ }
        }
      }

      try {
        const upstreamRes = await fetch(`${upstream}${req.url}`, {
          method: req.method,
          headers: { "content-type": "application/json" },
          body: req.method === "POST" ? body : undefined,
        });
        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        const buf = Buffer.from(await upstreamRes.arrayBuffer());
        res.end(buf);
      } catch (err) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `proxy upstream failed: ${err.message}` }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(r)),
        records,
      });
    });
  });
}

// Standalone mode: `node ollama-record-proxy.mjs --port=11436 --log=/tmp/rec.jsonl`
// forwards to local Ollama and prints a one-line summary per chat request.

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, dflt) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split("=")[1] : dflt;
  };
  const port = Number(arg("port", "11436"));
  const logPath = arg("log", "");
  const rawPath = arg("raw", "");
  const label = arg("label", "standalone");
  const upstream = arg("upstream", "http://127.0.0.1:11434");
  const proxy = await startRecordProxy({ port, upstream, logPath, rawPath, label });
  console.log(`Recording proxy: ${proxy.url} → ${upstream}${logPath ? ` (log: ${logPath})` : ""}`);
  setInterval(() => {
    const last = proxy.records[proxy.records.length - 1];
    if (last && !last._printed) {
      last._printed = true;
      console.log(`[${last.label}] model=${last.model} tools=${last.toolCount} sysTok≈${last.systemPromptTokensEst} totalTok≈${last.totalInputTokensEst} samplers=[${last.samplerKeysPresent.join(",")}]`);
    }
  }, 250).unref?.();
}
