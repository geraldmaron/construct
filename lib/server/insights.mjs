/**
 * lib/server/insights.mjs — dashboard insights aggregator.
 *
 * Pulls real data from the running stack (telemetry traces, cost ledger,
 * intake queue, beads) into a single payload the Mission Control panel
 * renders. Every section degrades to a typed state when its backing
 * source is unreachable — the dashboard never shows a bare error or
 * a hung "loading…" surface.
 *
 * State shape per section: `{ state: 'ok' | 'unreachable' | 'misconfigured' | 'empty', ... }`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCostLog, summarizeCostData } from '../cost.mjs';

const TELEMETRY_TIMEOUT_MS = 3500;

function telemetryAuthHeader(env) {
  const key = env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const secret = env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  if (!key || !secret) return null;
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

function telemetryBaseUrl(env) {
  return (env.CONSTRUCT_TELEMETRY_URL ?? '').replace(/\/$/, '');
}

async function fetchTelemetrySummary(env, { limit = 100 } = {}) {
  const auth = telemetryAuthHeader(env);
  const baseUrl = telemetryBaseUrl(env);

  // Try Telemetry API first
  if (auth) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/public/traces?limit=${limit}`, {
        headers: { Authorization: auth }, signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) {
        return { state: 'misconfigured', message: `Telemetry credentials rejected (HTTP ${res.status}). Run construct init.` };
      }
      if (!res.ok) return { state: 'unreachable', message: `Telemetry HTTP ${res.status}` };
      const json = await res.json();
      const traces = Array.isArray(json.data) ? json.data : [];
      let totalCost = 0; let observations = 0; const byModel = new Map(); let withError = 0; let withInput = 0; let withOutput = 0;
      for (const trace of traces) {
        totalCost += Number(trace?.totalCost) || 0;
        observations += Number(trace?.observationCount) || 0;
        if (trace?.input != null) withInput += 1;
        if (trace?.output != null) withOutput += 1;
        const tags = Array.isArray(trace?.tags) ? trace.tags : [];
        if (tags.some((t) => /error|failed|fail/i.test(t))) withError += 1;
        const model = trace?.metadata?.model || trace?.metadata?.lastModel || trace?.metadata?.costModel ||
          trace?.output?.model || trace?.output?.costModel || trace?.input?.metadata?.model ||
          (Array.isArray(trace?.observations) ? trace.observations.find((o) => o?.model)?.model : null) || null;
        if (!model) continue;
        const prior = byModel.get(model) || { traces: 0, cost: 0 };
        prior.traces += 1; prior.cost += Number(trace?.totalCost) || 0;
        byModel.set(model, prior);
      }
      return {
        state: traces.length === 0 ? 'empty' : 'ok',
        baseUrl, sampleSize: traces.length,
        totalCostUsd: Number(totalCost.toFixed(4)), observations, withInput, withOutput, withError,
        topModels: [...byModel.entries()].map(([model, v]) => ({ model, traces: v.traces, cost: Number(v.cost.toFixed(6)) }))
          .sort((a, b) => b.cost - a.cost || b.traces - a.traces).slice(0, 5),
      };
    } catch (err) {
      clearTimeout(timer);
      // Fall through to local traces
    }
  }

  // Fallback: read from local .cx/traces/ when Telemetry is unreachable or not configured.
  // The daemon always writes heartbeat, lifecycle, and probe events to local JSONL files.
  try {
    const traceDir = path.join(os.homedir(), '.cx', 'traces');
    if (!fs.existsSync(traceDir)) return { state: 'empty', message: 'No local traces. Start the daemon with `construct dev`.' };
    const files = fs.readdirSync(traceDir).filter(f => f.endsWith('.jsonl')).sort().reverse();
    if (!files.length) return { state: 'empty', message: 'No local trace files.' };

    const events = { total: 0, daemon: 0, probe: 0, lifecycle: 0, other: 0 };
    const byEventType = {};
    const byDay = {};

    for (const file of files.slice(0, 7)) {
      const content = fs.readFileSync(path.join(traceDir, file), 'utf8');
      for (const line of content.trim().split('\n').filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          events.total++;
          byEventType[e.eventType] = (byEventType[e.eventType] || 0) + 1;
          if (e.eventType?.startsWith('daemon.')) events.daemon++;
          else if (e.eventType?.startsWith('telemetry.') || e.eventType === 'lifecycle.completed') events.lifecycle++;
          else events.other++;
          const day = file.replace('.jsonl', '');
          byDay[day] = (byDay[day] || 0) + 1;
        } catch { /* skip malformed */ }
      }
    }

    const lfState = auth ? 'unreachable' : 'misconfigured';
    return {
      state: events.total > 0 ? 'ok' : 'empty',
      source: 'local-traces',
      baseUrl: null,
      sampleSize: events.total,
      eventBreakdown: byEventType,
      daemonEvents: events.daemon,
      lifecyleEvents: events.lifecycle,
      days: Object.keys(byDay).length,
      message: `Telemetry ${lfState}. Showing ${events.total} events from local trace files.`,
    };
  } catch (err) {
    return { state: 'unreachable', message: `Local traces unavailable: ${err.message}` };
  }
}

function resolveBillingMode(env) {
  // Precedence: CONSTRUCT_BILLING_MODE env > construct.config.json.costs.billingMode
  // > inference (ANTHROPIC_API_KEY set → metered, else subscription).
  // Returns {mode, source} so callers can distinguish declared from inferred.
  const envOverride = env?.CONSTRUCT_BILLING_MODE;
  if (envOverride === 'metered' || envOverride === 'subscription' || envOverride === 'mixed') {
    return { mode: envOverride, source: 'env' };
  }
  try {
    const cfgPath = path.join(process.cwd(), 'construct.config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const m = cfg?.costs?.billingMode;
      if (m === 'metered' || m === 'subscription' || m === 'mixed') {
        return { mode: m, source: 'config' };
      }
    }
  } catch { /* config is best-effort */ }
  const hasMeteredKey = typeof env?.ANTHROPIC_API_KEY === 'string'
    && env.ANTHROPIC_API_KEY.trim().length > 0
    && !env.ANTHROPIC_API_KEY.includes('__');
  return { mode: hasMeteredKey ? 'metered' : 'subscription', source: 'inferred' };
}

async function summarizeCostLedger(env, homeDir = os.homedir()) {
  try {
    const entries = readCostLog(homeDir);
    const { getTotalDailySpend, totalBudget, enforcementActive } = await import('../cost-ledger.mjs');
    const todayTotal = getTotalDailySpend();
    const cap = totalBudget();
    const billing = resolveBillingMode(env);
    const billingMode = billing.mode;
    // Per-provider billing-mode overrides live in construct.config.json.costs.providers.
    // summarizeCostData reads them to produce meteredActualUsd (excludes subscription
    // providers) alongside the legacy totalCostUsd (now also exposed as meteredEquivalentUsd).
    let costsConfig = {};
    try {
      const { loadProjectConfig } = await import('../config/project-config.mjs');
      costsConfig = loadProjectConfig(process.cwd(), env)?.config?.costs ?? {};
    } catch { /* config is best-effort */ }
    if (!entries.length) {
      return {
        state: 'empty',
        message: 'No cost entries yet. Run a chat session to populate the ledger.',
        billingMode,
        billingSource: billing.source,
        providerBilling: costsConfig.providers || {},
        budget: { todayUsd: todayTotal.costUsd, capUsd: cap, enforce: enforcementActive() },
      };
    }
    const last7 = summarizeCostData(entries, { days: 7, costsConfig });
    const last24h = summarizeCostData(entries, { days: 1, costsConfig });

    // Cache savings — order-of-magnitude estimate. Ledger has per-call cost
    // but no per-call input price, so the math uses a weighted-average input
    // price across the models seen in the window:
    // gross = cacheReadTokens * avgInputPrice * 0.9
    // premium = cacheCreationTokens * avgInputPrice * 0.25
    // The card surfaces the caveat explicitly to callers.
    let cacheSavings = null;
    try {
      const { resolveModelPricing } = await import('../telemetry/model-pricing-catalog.mjs');
      // Token-weighted avg input price across models in this window.
      // byAgent gives us per-agent input-token totals; we can resolve
      // each agent's model and weight its inputPrice by its share of
      // total billable input. If only one model is present, this
      // collapses to that model's price.
      let weightedInputPrice = 0;
      let weightedDenominator = 0;
      const modelsSeen = new Set();
      for (const a of last7.byAgent || []) {
        const model = a.model || 'claude-sonnet-4-6';
        modelsSeen.add(model);
        const p = resolveModelPricing(model);
        if (!p) continue;
        const tokens = (a.inputTokens || 0) + (a.cacheReadInputTokens || 0) + (a.cacheCreationInputTokens || 0);
        if (tokens === 0) continue;
        weightedInputPrice += p.inputPrice * tokens;
        weightedDenominator += tokens;
      }
      const avgInputPrice = weightedDenominator > 0
        ? weightedInputPrice / weightedDenominator
        : (resolveModelPricing('claude-sonnet-4-6')?.inputPrice ?? 3 / 1_000_000);
      const grossSaved = last7.cacheReadInputTokens * avgInputPrice * 0.9;
      const writePremium = last7.cacheCreationInputTokens * avgInputPrice * 0.25;
      const netSaved = grossSaved - writePremium;
      const wouldHaveCost = last7.totalCostUsd + netSaved;
      cacheSavings = {
        netSavedUsd: Number(netSaved.toFixed(4)),
        grossSavedUsd: Number(grossSaved.toFixed(4)),
        writePremiumUsd: Number(writePremium.toFixed(4)),
        wouldHaveCostUsd: Number(wouldHaveCost.toFixed(4)),
        savingsRatio: wouldHaveCost > 0 ? netSaved / wouldHaveCost : 0,
        modelsInWindow: [...modelsSeen],
        avgInputPriceUsdPerToken: Number(avgInputPrice.toFixed(10)),
        approximation: 'token-weighted avg input price; precise per-call price is not recoverable from the ledger',
      };
    } catch { /* savings is best-effort */ }

    // Token mix — total counts to render a stacked bar on the dashboard.
    const tokenMix = {
      input: last7.totalInputTokens,
      cacheRead: last7.cacheReadInputTokens,
      cacheCreation: last7.cacheCreationInputTokens,
      output: last7.totalOutputTokens,
      reasoning: last7.totalReasoningTokens || 0,
    };
    const tokenMixTotal = Object.values(tokenMix).reduce((s, v) => s + v, 0);

    // Today's actual metered spend — recomputed against per-provider modes so
    // a subscription provider (Claude Pro, e.g.) doesn't dump its
    // metered-equivalent into the headline number. Falls back to the legacy
    // todayTotal.costUsd when no day-bucketing of today's slice is available.
    const today = summarizeCostData(entries, { days: 1, costsConfig });
    const todayActualUsd = today.meteredActualUsd;
    const todayEquivUsd = todayTotal.costUsd;

    return {
      state: 'ok',
      billingMode,
      billingSource: billing.source,
      providerBilling: costsConfig.providers || {},
      budget: {
        todayUsd: todayEquivUsd,
        todayActualUsd,
        todayMeteredEquivalentUsd: todayEquivUsd,
        capUsd: cap,
        usageRatio: cap > 0 ? todayActualUsd / cap : 0,
        enforce: enforcementActive(),
        byPersona: todayTotal.byPersona,
      },
      cacheSavings,
      tokenMix: { ...tokenMix, total: tokenMixTotal },
      byProvider: last7.byProvider,
      windows: {
        last24h: {
          interactions: last24h.interactions,
          totalCostUsd: last24h.totalCostUsd,
          meteredActualUsd: last24h.meteredActualUsd,
          inputTokens: last24h.totalInputTokens,
          outputTokens: last24h.totalOutputTokens,
          cacheHitRate: last24h.cacheHitRate,
        },
        last7d: {
          interactions: last7.interactions,
          totalCostUsd: last7.totalCostUsd,
          meteredActualUsd: last7.meteredActualUsd,
          inputTokens: last7.totalInputTokens,
          outputTokens: last7.totalOutputTokens,
          cacheHitRate: last7.cacheHitRate,
          byAgent: last7.byAgent,
          byProvider: last7.byProvider,
        },
      },
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

function summarizeIntakeQueue(env, cwd = process.cwd()) {
  try {
    const pending = path.join(cwd, '.cx', 'intake', 'pending');
    const processed = path.join(cwd, '.cx', 'intake', 'processed');
    const skipped = path.join(cwd, '.cx', 'intake', 'skipped');
    const count = (dir) => {
      try {
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      } catch { return 0; }
    };
    const pendingCount = count(pending);
    const processedCount = count(processed);
    const skippedCount = count(skipped);
    // Count customer-linked items in pending queue
    let customerLinked = 0;
    try {
      const pendingFiles = fs.readdirSync(pending).filter((f) => f.endsWith('.json'));
      for (const f of pendingFiles) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(pending, f), 'utf8'));
          if (content.customers?.length > 0) customerLinked++;
        } catch { /* skip malformed */ }
      }
    } catch { /* skip */ }

    return {
      state: pendingCount === 0 && processedCount === 0 && skippedCount === 0 ? 'empty' : 'ok',
      pending: pendingCount,
      processed: processedCount,
      skipped: skippedCount,
      customerLinked,
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

function summarizeBeads(rootDir) {
  try {
    let bdCwd = rootDir;
    try {
      const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: rootDir, encoding: 'utf8' });
      if (r.status === 0) {
        const t = r.stdout.trim();
        const resolved = t.startsWith('/') ? t : path.join(rootDir, t);
        const cand = path.dirname(resolved);
        if (fs.existsSync(path.join(cand, '.beads'))) bdCwd = cand;
      }
    } catch { /* fall back */ }
    const r = spawnSync('bd', ['list', '--status', 'all', '--json'], {
      cwd: bdCwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 5000,
    });
    if (r.status !== 0) return { state: 'unreachable', message: r.stderr?.slice(0, 200) || 'bd list failed' };
    const issues = JSON.parse(r.stdout);
    const byStatus = {};
    const byPriority = {};
    for (const it of issues) {
      byStatus[it.status] = (byStatus[it.status] || 0) + 1;
      byPriority[`P${it.priority}`] = (byPriority[`P${it.priority}`] || 0) + 1;
    }
    return {
      state: issues.length === 0 ? 'empty' : 'ok',
      total: issues.length,
      byStatus,
      byPriority,
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

function summarizeModelProviders(env) {
  const entries = [
    { id: 'anthropic', displayName: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', altKey: null, docsUrl: 'https://docs.anthropic.com/api' },
    { id: 'openai', displayName: 'OpenAI', envKey: 'OPENAI_API_KEY', altKey: null, docsUrl: 'https://platform.openai.com/api-keys' },
    { id: 'openrouter', displayName: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', altKey: 'OPEN_ROUTER_API_KEY', docsUrl: 'https://openrouter.ai/keys' },
    { id: 'ollama', displayName: 'Ollama (local)', envKey: 'OLLAMA_BASE_URL', altKey: null, docsUrl: 'https://ollama.com' },
    { id: 'groq', displayName: 'Groq', envKey: 'GROQ_API_KEY', altKey: null, docsUrl: 'https://console.groq.com/keys' },
    { id: 'mistral', displayName: 'Mistral', envKey: 'MISTRAL_API_KEY', altKey: null, docsUrl: 'https://console.mistral.ai/api-keys' },
    { id: 'gemini', displayName: 'Google Gemini', envKey: 'GEMINI_API_KEY', altKey: null, docsUrl: 'https://aistudio.google.com/app/apikey' },
  ];
  return entries.map((e) => {
    // Check primary key, alt key, then multi-source resolution
    const raw = env[e.envKey] || (e.altKey ? env[e.altKey] : null);
    const configured = typeof raw === 'string' && raw.trim().length > 0 && !raw.includes('__');
    // If not found in env, try multi-source resolution (config.env, .env, shell rc, 1Password)
    const resolved = !configured ? resolveModelCredential(e.envKey, e.altKey) : null;
    const isConfigured = configured || Boolean(resolved);
    return {
      ...e,
      configured: isConfigured,
      state: isConfigured ? 'configured' : 'not-configured',
    };
  });
}

/**
 * Resolve a model provider credential from config.env, ~/.env, and shell rc files.
 */
function resolveModelCredential(primaryKey, altKey) {
  const homeDir = os.homedir();
  const keys = [primaryKey, altKey].filter(Boolean);

  // Special case: Ollama on default port (no OLLAMA_BASE_URL needed)
  if (primaryKey === 'OLLAMA_BASE_URL') {
    try {
      const r = spawnSync('curl', ['-s', '--connect-timeout', '1', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:11434/api/tags'], { encoding: 'utf8', timeout: 3000 });
      if (r.status === 0 && r.stdout?.trim() === '200') return 'http://localhost:11434';
    } catch { /* not available */ }
    // Also try the ollama binary
    try {
      const r = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 2000 });
      if (r.status === 0) return 'found-ollama-binary';
    } catch { /* not available */ }
  }

  const paths = [path.join(homeDir, '.construct', 'config.env'), path.join(homeDir, '.env')];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      for (const key of keys) {
        const m = content.match(new RegExp(`^${key}=["']?(.+?)["']?$`, 'm'));
        if (m && m[1]) return m[1].trim();
      }
    } catch { /* skip */ }
  }
  const shellFiles = [path.join(homeDir, '.zshrc'), path.join(homeDir, '.bashrc'), path.join(homeDir, '.bash_profile'), path.join(homeDir, '.profile')];
  for (const rc of shellFiles) {
    if (!fs.existsSync(rc)) continue;
    try {
      const content = fs.readFileSync(rc, 'utf8');
      for (const key of keys) {
        const directRe = new RegExp(`^\\s*export\\s+${key}=`, 'm');
        if (directRe.test(content)) return 'found-in-rc';
      }
    } catch { /* skip */ }
  }
  return null;
}

async function summarizeTelemetryCostTrend(env, { days = 7 } = {}) {
  // Fetches each trace + its totalCost and buckets by yyyy-mm-dd. The
  // public /traces endpoint includes totalCost when generations have
  // been priced; sparse trace cost is fine — the chart shows shape, not
  // an audit-grade ledger value.
  const auth = telemetryAuthHeader(env);
  if (!auth) return { state: 'misconfigured', message: 'CONSTRUCT_TELEMETRY_PUBLIC_KEY / SECRET_KEY not set.' };
  const baseUrl = telemetryBaseUrl(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // Telemetry caps `limit` at 100 — 500 returns 400. Use the cap and accept that
    // weeks with >100 traces will undercount the trailing days; the chart is for
    // shape, not audit. Re-try without `fromTimestamp` if the server version
    // rejects that param (same fallback shape as the latency probe).
    let res = await fetch(`${baseUrl}/api/public/traces?limit=100&fromTimestamp=${encodeURIComponent(since)}`, {
      headers: { Authorization: auth },
      signal: controller.signal,
    });
    if (res.status === 400 || res.status === 422) {
      res = await fetch(`${baseUrl}/api/public/traces?limit=100`, {
        headers: { Authorization: auth },
        signal: controller.signal,
      });
    }
    clearTimeout(timer);
    if (!res.ok) return { state: 'unreachable', message: `Telemetry HTTP ${res.status}` };
    const json = await res.json();
    const traces = Array.isArray(json.data) ? json.data : [];
    const buckets = new Map();
    for (let d = 0; d < days; d++) {
      const day = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      buckets.set(day, { day, costUsd: 0, traces: 0, errors: 0 });
    }
    let withCost = 0;
    for (const trace of traces) {
      const ts = trace?.timestamp || trace?.createdAt;
      if (!ts) continue;
      const day = String(ts).slice(0, 10);
      const bucket = buckets.get(day);
      if (!bucket) continue;
      bucket.traces += 1;
      const cost = Number(trace?.totalCost) || 0;
      if (cost > 0) { bucket.costUsd += cost; withCost += 1; }
      const tags = Array.isArray(trace?.tags) ? trace.tags : [];
      if (tags.some((t) => /error|fail/i.test(t))) bucket.errors += 1;
    }
    const series = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
    return { state: traces.length === 0 ? 'empty' : 'ok', days, sampleSize: traces.length, withCost, series };
  } catch (err) {
    clearTimeout(timer);
    return { state: 'unreachable', message: err?.message || 'fetch failed' };
  }
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

async function summarizeTelemetryLatency(env, { days = 7, limit = 50 } = {}) {
  const auth = telemetryAuthHeader(env);
  if (!auth) return { state: 'misconfigured', message: 'CONSTRUCT_TELEMETRY_PUBLIC_KEY / SECRET_KEY not set.' };
  const baseUrl = telemetryBaseUrl(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // Telemetry public API observations: `type=GENERATION` plus an
    // optional `fromStartTime` (some versions reject the param, so we
    // try with it first and fall back to a plain page if the server
    // returns 4xx with that param).
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    let res = await fetch(
      `${baseUrl}/api/public/observations?type=GENERATION&fromStartTime=${encodeURIComponent(since)}&limit=${limit}`,
      { headers: { Authorization: auth }, signal: controller.signal },
    );
    if (res.status === 400 || res.status === 422) {
      res = await fetch(
        `${baseUrl}/api/public/observations?type=GENERATION&limit=${limit}`,
        { headers: { Authorization: auth }, signal: controller.signal },
      );
    }
    clearTimeout(timer);
    if (!res.ok) return { state: 'unreachable', message: `Telemetry HTTP ${res.status}` };
    const json = await res.json();
    const observations = Array.isArray(json.data) ? json.data : [];
    if (observations.length === 0) {
      return { state: 'empty', message: 'No generation observations in the window.' };
    }
    const latencies = [];
    const ttfts = [];
    const tps = [];
    let withTtft = 0;
    let errorCount = 0;
    const byModel = new Map();
    for (const g of observations) {
      const start = g.startTime ? Date.parse(g.startTime) : null;
      const end = g.endTime ? Date.parse(g.endTime) : null;
      const ttft = g.completionStartTime ? Date.parse(g.completionStartTime) : null;
      const model = g.model || 'unknown';
      const level = (g.level || '').toLowerCase();
      const isError = level === 'error';
      if (isError) errorCount += 1;
      if (start && end && end > start) {
        const totalMs = end - start;
        latencies.push(totalMs);
        const outTokens = Number(g.completionTokens ?? g.usage?.output ?? 0);
        if (outTokens > 0 && ttft && end > ttft) {
          tps.push((outTokens / (end - ttft)) * 1000);
        }
        if (ttft && start && ttft > start) {
          ttfts.push(ttft - start);
          withTtft += 1;
        }
        const entry = byModel.get(model) || { traces: 0, totalMs: 0, errors: 0 };
        entry.traces += 1;
        entry.totalMs += totalMs;
        if (isError) entry.errors += 1;
        byModel.set(model, entry);
      }
    }
    const byAgent = new Map();
    for (const g of observations) {
      const agent = g.metadata?.agent || g.parentObservationId ? (g.metadata?.agent || null) : null;
      // Observation `name` often follows `llm.<agent>` from the opencode
      // plugin — extract the agent from there as a fallback when the
      // metadata field is empty.
      let resolvedAgent = agent;
      if (!resolvedAgent && typeof g.name === 'string' && g.name.startsWith('llm.')) {
        const tail = g.name.slice(4);
        if (tail && tail !== 'chat') resolvedAgent = tail;
      }
      if (!resolvedAgent) continue;
      const start = g.startTime ? Date.parse(g.startTime) : null;
      const end = g.endTime ? Date.parse(g.endTime) : null;
      if (!start || !end || end <= start) continue;
      const totalMs = end - start;
      const entry = byAgent.get(resolvedAgent) || { traces: 0, totalMs: 0, errors: 0 };
      entry.traces += 1;
      entry.totalMs += totalMs;
      if ((g.level || '').toLowerCase() === 'error') entry.errors += 1;
      byAgent.set(resolvedAgent, entry);
    }

    return {
      state: 'ok',
      sampleSize: observations.length,
      windowDays: days,
      latencyMs: {
        p50: quantile(latencies, 0.5),
        p95: quantile(latencies, 0.95),
        p99: quantile(latencies, 0.99),
      },
      ttftMs: ttfts.length ? { p50: quantile(ttfts, 0.5), p95: quantile(ttfts, 0.95), sampleSize: withTtft } : null,
      tokensPerSecond: tps.length ? { p50: quantile(tps, 0.5), p95: quantile(tps, 0.95) } : null,
      errorRate: observations.length > 0 ? errorCount / observations.length : 0,
      errorCount,
      perModel: [...byModel.entries()]
        .map(([model, v]) => ({ model, traces: v.traces, avgMs: Math.round(v.totalMs / v.traces), errors: v.errors }))
        .sort((a, b) => b.traces - a.traces)
        .slice(0, 8),
      perAgent: [...byAgent.entries()]
        .map(([agent, v]) => ({ agent, traces: v.traces, avgMs: Math.round(v.totalMs / v.traces), errors: v.errors }))
        .sort((a, b) => b.traces - a.traces)
        .slice(0, 12),
    };
  } catch (err) {
    clearTimeout(timer);
    return { state: 'unreachable', message: err?.message || 'fetch failed' };
  }
}

function summarizeRetrievalEval(homeDir = os.homedir()) {
  try {
    const cachePath = path.join(homeDir, '.cx', 'evals', 'retrieval-latest.json');
    if (!fs.existsSync(cachePath)) {
      return {
        state: 'empty',
        message: 'No retrieval eval yet. Run `construct evals retrieval` to populate.',
      };
    }
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const r = cached.report?.summary || cached.report || {};
    let history = [];
    try {
      const historyPath = path.join(homeDir, '.cx', 'evals', 'retrieval-history.jsonl');
      if (fs.existsSync(historyPath)) {
        const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean);
        history = lines.slice(-30).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      }
    } catch { /* history is best-effort */ }
    return {
      state: 'ok',
      ranAt: cached.ts,
      fixture: cached.fixture,
      recallAt5: r.recallAt5 ?? r.recall_at_5 ?? null,
      precisionAt5: r.precisionAt5 ?? r.precision_at_5 ?? null,
      mrr: r.mrr ?? null,
      p50LatencyMs: r.p50LatencyMs ?? r.p50_latency_ms ?? null,
      p95LatencyMs: r.p95LatencyMs ?? r.p95_latency_ms ?? null,
      emptyRate: r.emptyRate ?? r.empty_rate ?? null,
      fallbackRate: r.fallbackRate ?? r.fallback_rate ?? null,
      queryCount: cached.report?.perQuery?.length ?? null,
      history: history.map((h) => ({ ts: h.ts, recallAt5: h.recallAt5 ?? null, mrr: h.mrr ?? null })),
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

async function summarizeRecommendations() {
  try {
    const { recommendationStats } = await import('../embed/recommendation-store.mjs');
    const stats = recommendationStats();
    return {
      state: stats.total > 0 ? 'ok' : 'empty',
      total: stats.total,
      active: stats.active,
      dismissed: stats.dismissed,
      byPriority: stats.byPriority,
      byType: stats.byType,
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

async function summarizeIntegrations() {
  try {
    const { detectIntegrationConfig } = await import('../integrations/intake-integrations.mjs');
    const config = detectIntegrationConfig();
    return {
      state: 'ok',
      configured: Object.entries(config)
        .filter(([, v]) => v === true || typeof v === 'string')
        .map(([k]) => k)
        .filter(k => k !== 'githubRepo' && k !== 'jiraHost' && k !== 'confluenceSpace'),
      details: {
        github: config.githubMethod ? `${config.githubMethod}${config.githubRepo ? ` (${config.githubRepo})` : ''}` : 'not configured',
        jira: config.jira ? 'configured' : 'not configured',
        confluence: config.confluence ? 'configured' : 'not configured',
      },
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

function summarizeVectorStore(env) {
  try {
    const mode = env.CONSTRUCT_VECTOR_BACKEND || 'file';
    const indexPath = env.CONSTRUCT_VECTOR_INDEX_PATH || '.cx/vector-index.json';
    const resolved = path.isAbsolute(indexPath) ? indexPath : path.join(process.cwd(), indexPath);
    if (!fs.existsSync(resolved)) {
      return { state: 'empty', mode, message: 'No vector index yet. Run `construct ingest` to populate.' };
    }
    const stat = fs.statSync(resolved);
    let records = 0;
    let model = null;
    let updatedAt = null;
    try {
      const json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      records = Array.isArray(json.records) ? json.records.length : 0;
      model = json.model || null;
      updatedAt = json.updatedAt || null;
    } catch { /* malformed — fall through to size-only stats */ }
    return {
      state: 'ok',
      mode,
      bytes: stat.size,
      records,
      model,
      updatedAt,
      path: resolved,
    };
  } catch (err) {
    return { state: 'unreachable', message: err.message };
  }
}

export async function buildInsights({ env = process.env, cwd = process.cwd(), rootDir = process.cwd() } = {}) {
  const { measureUsage } = await import('../resources/budget.mjs');
  const { summarizeHandoffs } = await import('../handoffs/inventory.mjs');
  let resources;
  try {
    const u = measureUsage(cwd, env);
    resources = { state: 'ok', ...u };
  } catch (err) {
    resources = { state: 'unreachable', message: err.message };
  }
  let handoffs;
  try {
    handoffs = summarizeHandoffs(cwd, env);
  } catch (err) {
    handoffs = { state: 'unreachable', message: err.message };
  }
  const [telemetry, telemetryTrend, telemetryLatency, cost, intake, beads, recommendations, integrations] = await Promise.all([
    fetchTelemetrySummary(env),
    summarizeTelemetryCostTrend(env),
    summarizeTelemetryLatency(env),
    summarizeCostLedger(env),
    Promise.resolve(summarizeIntakeQueue(env, cwd)),
    Promise.resolve(summarizeBeads(rootDir)),
    summarizeRecommendations(),
    summarizeIntegrations(),
  ]);
  const providers = summarizeModelProviders(env);
  const vector = summarizeVectorStore(env);
  const retrievalEval = summarizeRetrievalEval();
  let sessionUsage;
  try {
    const { readSessionUsage } = await import('../status.mjs');
    sessionUsage = readSessionUsage(os.homedir());
  } catch { sessionUsage = null; }
  return {
    telemetry,
    telemetryTrend,
    telemetryLatency,
    cost,
    intake,
    recommendations,
    integrations,
    beads,
    resources,
    handoffs,
    providers,
    vector,
    retrievalEval,
    sessionUsage,
    generatedAt: new Date().toISOString(),
  };
}
