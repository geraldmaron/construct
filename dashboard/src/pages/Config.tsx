/**
 * Config.tsx — construct.config.json editor.
 *
 * Single page with form sections (General, Models, Resources, Costs).
 * Diff preview before save; audit-log written server-side on each
 * write. Falls back to defaults when no construct.config.json exists
 * yet — first save creates the file at the project root.
 */
import { useEffect, useState } from 'react';
import { fetchProjectConfig, writeProjectConfig } from '../lib/api';
import SmallScreenNotice from '../components/SmallScreenNotice';

type ConfigPayload = {
  version: number;
  alias?: string;
  deployment?: { mode?: string; mcpBroker?: string; projectName?: string | null; tenantId?: string | null };
  autoEmbed?: boolean;
  telemetry?: { enabled?: boolean };
  roleSelection?: { primary?: string | null; secondary?: string | null; perConversationOverride?: boolean };
  resources?: { disk?: { totalCxMaxMb?: number; tracesMaxDays?: number; backupsMaxDays?: number } };
  costs?: {
    billingMode?: 'metered' | 'subscription' | 'mixed';
    enforce?: boolean;
    budgets?: { default?: { dailyUsd?: number }; total?: { dailyUsd?: number } };
  };
};

const DEPLOYMENT_MODES = ['solo', 'team', 'enterprise'];
const BROKER_VALUES = ['auto', 'on', 'off'];

export default function Config() {
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [original, setOriginal] = useState<ConfigPayload | null>(null);
  const [source, setSource] = useState<string>('default');
  const [path, setPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectConfig()
      .then((data: any) => {
        setConfig(data.config);
        setOriginal(JSON.parse(JSON.stringify(data.config)));
        setSource(data.source);
        setPath(data.path);
        setErrors(data.errors || []);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  if (loadError) {
    return (
      <section className="card max-w-2xl">
        <h1 className="text-lg font-semibold mb-2">Config unavailable</h1>
        <p className="text-text-muted text-sm">{loadError}</p>
      </section>
    );
  }
  if (!config) return <p className="text-text-dim text-sm">Loading config…</p>;

  const dirty = JSON.stringify(config) !== JSON.stringify(original);

  async function save() {
    if (!config) return;
    setSaving(true);
    setSavedMsg(null);
    setErrors([]);
    try {
      const result = await writeProjectConfig(config);
      setSavedMsg(`Saved to ${result.path}`);
      setOriginal(JSON.parse(JSON.stringify(config)));
    } catch (err: any) {
      setErrors([err.message || String(err)]);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (!original) return;
    setConfig(JSON.parse(JSON.stringify(original)));
    setSavedMsg(null);
    setErrors([]);
  }

  return (
    <div className="max-w-4xl space-y-8">
      <SmallScreenNotice />
      <header>
        <p className="text-text-dim text-xs uppercase tracking-wider mb-1">Page</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Configuration</h1>
        <p className="text-text-muted text-sm mt-2">
          Edits write to <code className="px-1 py-0.5 bg-bg-muted rounded">construct.config.json</code> at the project root. Secrets stay in <code className="px-1 py-0.5 bg-bg-muted rounded">.env</code>.
        </p>
        <p className="text-text-dim text-xs mt-2">
          Source: <span className="font-mono">{source}</span>
          {path && <> · {path}</>}
        </p>
      </header>

      {errors.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--status-down)' }}>
          <h3 className="font-medium mb-2">Save failed</h3>
          <ul className="text-sm text-text-muted list-disc list-inside">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {savedMsg && (
        <div className="card" style={{ borderColor: 'var(--status-healthy)' }}>
          <p className="text-sm">{savedMsg}</p>
        </div>
      )}

      <section className="card space-y-4" aria-labelledby="general-heading">
        <h2 id="general-heading" className="text-sm uppercase tracking-wider text-text-dim">General</h2>
        <p className="text-xs text-text-muted">
          Alias is edited in the sidebar wordmark — click <strong>{config.alias ?? 'Construct'}</strong> in the top-left to rename.
        </p>
        <Field label="Deployment mode" help="Routes the intake queue, worker pool, and telemetry backend.">
          <select
            value={config.deployment?.mode ?? 'solo'}
            onChange={(e) => setConfig((c) => ({ ...c!, deployment: { ...c?.deployment, mode: e.target.value } }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          >
            {DEPLOYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="MCP broker" help="auto = team/enterprise on, solo off. on/off override.">
          <select
            value={config.deployment?.mcpBroker ?? 'auto'}
            onChange={(e) => setConfig((c) => ({ ...c!, deployment: { ...c?.deployment, mcpBroker: e.target.value } }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          >
            {BROKER_VALUES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Auto-start embed daemon" help="Session-start auto-launches the embed daemon when off.">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(config.autoEmbed)}
              onChange={(e) => setConfig((c) => ({ ...c!, autoEmbed: e.target.checked }))}
            />
            <span className="text-sm">{config.autoEmbed ? 'on' : 'off'}</span>
          </label>
        </Field>
        <Field label="Telemetry (Remote ingest)" help="When off, R&D-loop traces stay in .cx/traces/ only.">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.telemetry?.enabled !== false}
              onChange={(e) => setConfig((c) => ({ ...c!, telemetry: { ...c?.telemetry, enabled: e.target.checked } }))}
            />
            <span className="text-sm">{config.telemetry?.enabled !== false ? 'on' : 'off'}</span>
          </label>
        </Field>
      </section>

      <section className="card space-y-4" aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="text-sm uppercase tracking-wider text-text-dim">Team Configuration</h2>
        <p className="text-xs text-text-muted">
          Set your default primary and secondary personas. The primary sets the analysis lens; the secondary provides complementary perspective.
          Override per-conversation with <code className="px-1 py-0.5 bg-bg-muted rounded">@construct --primary=cx-pm --secondary=cx-arch</code>.
        </p>
        <Field label="Primary persona" help="Default orientation for all work. Leave null for automatic routing.">
          <select
            value={config.roleSelection?.primary ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c!, roleSelection: { ...c?.roleSelection, primary: e.target.value || null } }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          >
            <option value="">Automatic (context-based)</option>
            <option value="cx-product-manager">cx-product-manager</option>
            <option value="cx-architect">cx-architect</option>
            <option value="cx-engineer">cx-engineer</option>
            <option value="cx-debugger">cx-debugger</option>
            <option value="cx-qa">cx-qa</option>
            <option value="cx-sre">cx-sre</option>
            <option value="cx-platform-engineer">cx-platform-engineer</option>
            <option value="cx-designer">cx-designer</option>
            <option value="cx-ux-researcher">cx-ux-researcher</option>
            <option value="cx-accessibility">cx-accessibility</option>
            <option value="cx-researcher">cx-researcher</option>
            <option value="cx-data-analyst">cx-data-analyst</option>
            <option value="cx-ai-engineer">cx-ai-engineer</option>
            <option value="cx-evaluator">cx-evaluator</option>
            <option value="cx-trace-reviewer">cx-trace-reviewer</option>
            <option value="cx-security">cx-security</option>
            <option value="cx-legal-compliance">cx-legal-compliance</option>
            <option value="cx-reviewer">cx-reviewer</option>
            <option value="cx-devil-advocate">cx-devil-advocate</option>
            <option value="cx-release-manager">cx-release-manager</option>
            <option value="cx-docs-keeper">cx-docs-keeper</option>
            <option value="cx-business-strategist">cx-business-strategist</option>
            <option value="cx-operations">cx-operations</option>
            <option value="cx-orchestrator">cx-orchestrator</option>
            <option value="cx-rd-lead">cx-rd-lead</option>
          </select>
        </Field>
        <Field label="Secondary persona" help="Complementary perspective. Leave null for automatic routing.">
          <select
            value={config.roleSelection?.secondary ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c!, roleSelection: { ...c?.roleSelection, secondary: e.target.value || null } }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          >
            <option value="">Automatic (context-based)</option>
            <option value="cx-product-manager">cx-product-manager</option>
            <option value="cx-architect">cx-architect</option>
            <option value="cx-engineer">cx-engineer</option>
            <option value="cx-debugger">cx-debugger</option>
            <option value="cx-qa">cx-qa</option>
            <option value="cx-sre">cx-sre</option>
            <option value="cx-platform-engineer">cx-platform-engineer</option>
            <option value="cx-designer">cx-designer</option>
            <option value="cx-ux-researcher">cx-ux-researcher</option>
            <option value="cx-accessibility">cx-accessibility</option>
            <option value="cx-researcher">cx-researcher</option>
            <option value="cx-data-analyst">cx-data-analyst</option>
            <option value="cx-ai-engineer">cx-ai-engineer</option>
            <option value="cx-evaluator">cx-evaluator</option>
            <option value="cx-trace-reviewer">cx-trace-reviewer</option>
            <option value="cx-security">cx-security</option>
            <option value="cx-legal-compliance">cx-legal-compliance</option>
            <option value="cx-reviewer">cx-reviewer</option>
            <option value="cx-devil-advocate">cx-devil-advocate</option>
            <option value="cx-release-manager">cx-release-manager</option>
            <option value="cx-docs-keeper">cx-docs-keeper</option>
            <option value="cx-business-strategist">cx-business-strategist</option>
            <option value="cx-operations">cx-operations</option>
            <option value="cx-orchestrator">cx-orchestrator</option>
            <option value="cx-rd-lead">cx-rd-lead</option>
          </select>
        </Field>
        <Field label="Per-conversation override" help="Allow CLI overrides with --primary and --secondary flags.">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.roleSelection?.perConversationOverride !== false}
              onChange={(e) => setConfig((c) => ({ ...c!, roleSelection: { ...c?.roleSelection, perConversationOverride: e.target.checked } }))}
            />
            <span className="text-sm">{config.roleSelection?.perConversationOverride !== false ? 'enabled' : 'disabled'}</span>
          </label>
        </Field>
      </section>

      <section className="card space-y-2" aria-labelledby="models-heading">
        <h2 id="models-heading" className="text-sm uppercase tracking-wider text-text-dim">Models</h2>
        <p className="text-xs text-text-muted">
          Model tiers are configured on the <a href="#/models" className="underline hover:no-underline">Models page</a>.
          That page is the single source of truth — selections persist to <code className="px-1 bg-bg-muted rounded">agents/registry.json</code> and
          stay there. Env vars <code className="px-1 bg-bg-muted rounded">CX_MODEL_REASONING|STANDARD|FAST</code> still
          override at runtime for CI and ops; they are not editable from the dashboard.
        </p>
      </section>

      <section className="card space-y-4" aria-labelledby="resources-heading">
        <h2 id="resources-heading" className="text-sm uppercase tracking-wider text-text-dim">Resource limits</h2>
        <Field label=".cx/ total cap (MB)" help="Hard cap on the .cx/ tree. Defaults to 2GB.">
          <input
            type="number" min="100" step="100"
            value={config.resources?.disk?.totalCxMaxMb ?? 2000}
            onChange={(e) => setConfig((c) => ({
              ...c!, resources: { ...c?.resources, disk: { ...c?.resources?.disk, totalCxMaxMb: Number(e.target.value) } },
            }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          />
        </Field>
        <Field label="Trace retention (days)" help="JSONL traces in .cx/traces/ rotate past this age.">
          <input
            type="number" min="1"
            value={config.resources?.disk?.tracesMaxDays ?? 30}
            onChange={(e) => setConfig((c) => ({
              ...c!, resources: { ...c?.resources, disk: { ...c?.resources?.disk, tracesMaxDays: Number(e.target.value) } },
            }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          />
        </Field>
        <Field label="Backup retention (days)" help="Persona/skill/rules edit backups in .cx/backups/.">
          <input
            type="number" min="1"
            value={config.resources?.disk?.backupsMaxDays ?? 60}
            onChange={(e) => setConfig((c) => ({
              ...c!, resources: { ...c?.resources, disk: { ...c?.resources?.disk, backupsMaxDays: Number(e.target.value) } },
            }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          />
        </Field>
      </section>

      <section className="card space-y-4" aria-labelledby="costs-heading">
        <h2 id="costs-heading" className="text-sm uppercase tracking-wider text-text-dim">Cost ceilings</h2>
        <Field label="Billing mode" help="metered = pay-per-token API (numbers = real bill). subscription = Claude Pro / Max / Team / Enterprise flat-rate (numbers below become metered-equivalent only). mixed = some of both.">
          <select
            value={config.costs?.billingMode ?? 'metered'}
            onChange={(e) => setConfig((c) => ({
              ...c!,
              costs: { ...c?.costs, billingMode: e.target.value as 'metered' | 'subscription' | 'mixed' },
            }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          >
            <option value="metered">metered (API key, pay-per-token)</option>
            <option value="subscription">subscription (Claude Pro / Max / Team)</option>
            <option value="mixed">mixed (both)</option>
          </select>
        </Field>
        <Field label="Daily total cap (USD)" help="Hard-stop when enforce is on. Has no meaning under pure subscription billing — the cap applies only to metered API calls.">
          <input
            type="number" min="0" step="0.5"
            value={config.costs?.budgets?.total?.dailyUsd ?? 50}
            onChange={(e) => setConfig((c) => ({
              ...c!,
              costs: { ...c?.costs, budgets: { ...c?.costs?.budgets, total: { dailyUsd: Number(e.target.value) } } },
            }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          />
        </Field>
        <Field label="Per-persona default cap (USD)" help="Applies to any persona without a specific entry.">
          <input
            type="number" min="0" step="0.5"
            value={config.costs?.budgets?.default?.dailyUsd ?? 10}
            onChange={(e) => setConfig((c) => ({
              ...c!,
              costs: { ...c?.costs, budgets: { ...c?.costs?.budgets, default: { dailyUsd: Number(e.target.value) } } },
            }))}
            className="w-full px-3 py-2 border border-border rounded bg-surface"
          />
        </Field>
        <Field label="Enforce" help="When on, calls exceeding the cap return PolicyDenied. When off, advisory only.">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(config.costs?.enforce)}
              onChange={(e) => setConfig((c) => ({ ...c!, costs: { ...c?.costs, enforce: e.target.checked } }))}
            />
            <span className="text-sm">{config.costs?.enforce ? 'on' : 'off'}</span>
          </label>
        </Field>
      </section>

      {dirty && (
        <section className="card" aria-labelledby="diff-heading">
          <h3 id="diff-heading" className="text-sm uppercase tracking-wider text-text-dim mb-2">Pending changes</h3>
          <pre className="text-xs bg-bg-muted p-3 rounded overflow-auto max-h-64 font-mono">
{diffJson(original, config)}
          </pre>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={reset}
          className="btn disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Discard
        </button>
        {!dirty && <span className="text-xs text-text-dim">No changes pending.</span>}
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      {help && <p className="text-xs text-text-dim">{help}</p>}
      {children}
    </div>
  );
}

function diffJson(a: any, b: any): string {
  const lines: string[] = [];
  const aJson = JSON.stringify(a ?? {}, null, 2).split('\n');
  const bJson = JSON.stringify(b ?? {}, null, 2).split('\n');
  const max = Math.max(aJson.length, bJson.length);
  for (let i = 0; i < max; i++) {
    if (aJson[i] === bJson[i]) { lines.push(`  ${bJson[i] ?? ''}`); continue; }
    if (aJson[i] !== undefined) lines.push(`- ${aJson[i]}`);
    if (bJson[i] !== undefined) lines.push(`+ ${bJson[i]}`);
  }
  return lines.join('\n');
}
