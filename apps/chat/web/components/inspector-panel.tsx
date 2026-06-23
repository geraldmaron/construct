/**
 * apps/chat/web/components/inspector-panel.tsx — slide-in inspector drawer.
 *
 * Two tabs:
 *   Session — model, context, usage totals, layer toggles, oracle.
 *   Turn    — full routing overlay for the focused turn (reuses RouteSections).
 */

'use client';

import { useEffect } from 'react';
import type { ChatTurn, RouteOverlay, SessionMeta } from '../types';
import { LAYER_KEYS, type LayerKey } from '../types';
import { RouteSections } from './route-sections';
import { formatTokens } from '../lib/format';

type InspectorTab = 'session' | 'turn';

type InspectorPanelProps = {
  isOpen: boolean;
  activeTab: InspectorTab;
  onClose: () => void;
  onTabChange: (tab: InspectorTab) => void;
  sessionMeta: SessionMeta;
  turns: ChatTurn[];
  layers: Record<string, boolean>;
  overlay: RouteOverlay | null;
  streaming: boolean;
  onToggleLayer?: (key: LayerKey) => void;
  onOpenModelPicker?: () => void;
  onOpenSettingsPicker?: () => void;
};

function deriveTelemetry(turns: ChatTurn[]) {
  let tools = 0;
  let sources = 0;
  const specialists = new Map<string, number>();
  for (const turn of turns) {
    if (turn.system) continue;
    tools += turn.tools?.length ?? 0;
    sources += turn.sources?.length ?? 0;
    for (const id of turn.overlay?.specialists ?? []) {
      const name = id.replace(/^cx-/, '');
      specialists.set(name, (specialists.get(name) ?? 0) + 1);
    }
  }
  const ranked = [...specialists.entries()].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 1;
  return { tools, sources, specialists: ranked, specialistMax: max };
}

function modelLabel(sessionMeta: SessionMeta) {
  if (sessionMeta.demoLabel) {
    return `demo · ${sessionMeta.demoLabel}`;
  }
  if (sessionMeta.modelMode === 'free-router') {
    return `free-router → ${sessionMeta.model ?? '?'}`;
  }
  return sessionMeta.model ?? '(none)';
}

function contextMeter(ctx: SessionMeta['ctx']) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  return { pct: Math.round(ratio * 100), label: `${ctx.used}/${ctx.size}` };
}

export function InspectorPanel({
  isOpen,
  activeTab,
  onClose,
  onTabChange,
  sessionMeta,
  turns: sessionTurns,
  layers,
  overlay,
  streaming,
  onToggleLayer,
  onOpenModelPicker,
  onOpenSettingsPicker,
}: InspectorPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const meter = contextMeter(sessionMeta.ctx);
  const t = sessionMeta.usage?.tokens ?? {};
  const cost = sessionMeta.usage?.cost;
  const turns = sessionMeta.usage?.turns ?? 0;
  const tel = deriveTelemetry(sessionTurns);
  const totalTokens = t.total ?? ((t.input ?? 0) + (t.output ?? 0));

  const ledger: Array<[string, string]> = [];
  if (t.input) ledger.push(['in', formatTokens(t.input)]);
  if (t.output) ledger.push(['out', formatTokens(t.output)]);
  if (t.cacheRead) ledger.push(['cache↓', formatTokens(t.cacheRead)]);
  if (t.cacheWrite) ledger.push(['cache↑', formatTokens(t.cacheWrite)]);
  if (t.reasoning) ledger.push(['thinking', formatTokens(t.reasoning)]);
  if (t.total) ledger.push(['total', formatTokens(t.total)]);
  if (cost?.amount && cost.amount > 0) {
    ledger.push(['cost', `~$${cost.amount.toFixed(cost.amount < 0.01 ? 4 : cost.amount < 1 ? 3 : 2)}`]);
  }

  return (
    <>
      <div
        className="cx-inspector-backdrop"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="cx-inspector"
        aria-label="Session inspector"
        role="complementary"
      >
        <div className="cx-inspector-head">
          <div className="cx-inspector-tabs" role="tablist">
            <button
              role="tab"
              type="button"
              className={`cx-inspector-tab${activeTab === 'session' ? ' cx-inspector-tab-active' : ''}`}
              aria-selected={activeTab === 'session'}
              onClick={() => onTabChange('session')}
            >
              Session
            </button>
            <button
              role="tab"
              type="button"
              className={`cx-inspector-tab${activeTab === 'turn' ? ' cx-inspector-tab-active' : ''}`}
              aria-selected={activeTab === 'turn'}
              onClick={() => onTabChange('turn')}
              disabled={!overlay}
            >
              Turn
            </button>
          </div>
          <div className="cx-inspector-head-right">
            <span
              className={`cx-cockpit-status-pill ${streaming ? 'cx-cockpit-status-pill-working' : 'cx-cockpit-status-pill-idle'}`}
            >
              {streaming ? 'working' : 'ready'}
            </span>
            <button
              type="button"
              className="cx-inspector-close"
              onClick={onClose}
              aria-label="Close inspector"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="cx-inspector-body">
          {activeTab === 'session' && (
            <div role="tabpanel" aria-label="Session details">
              <section className="cx-cockpit-dock-section">
                <h3 className="cx-cockpit-dock-heading">Model</h3>
                <p className="cx-cockpit-dock-body" style={{ fontSize: '12px', marginBottom: '8px' }}>
                  {modelLabel(sessionMeta)}
                </p>
                <div className="cx-cockpit-rail-actions">
                  <button type="button" className="cx-cockpit-rail-btn" onClick={onOpenModelPicker}>
                    change model
                  </button>
                  <button type="button" className="cx-cockpit-rail-btn" onClick={onOpenSettingsPicker}>
                    settings
                  </button>
                </div>
              </section>

              <section className="cx-cockpit-dock-section">
                <h3 className="cx-cockpit-dock-heading">Session telemetry</h3>
                <div className="cx-tel-total">
                  <span className="cx-tel-total-value">{(totalTokens || 0).toLocaleString()}</span>
                  <span className="cx-tel-total-unit">tokens</span>
                </div>
                <p className="cx-tel-split">
                  {`${formatTokens(t.input)} input · ${formatTokens(t.output)} output`}
                </p>
                {meter ? (
                  <>
                    <div className="cx-tel-meter" aria-hidden>
                      <span className="cx-tel-meter-fill" style={{ width: `${meter.pct}%` }} />
                    </div>
                    <div className="cx-tel-meter-foot">
                      <span>{`${meter.pct}% of context`}</span>
                      <span>{meter.label}</span>
                    </div>
                  </>
                ) : (
                  <p className="cx-cockpit-muted" style={{ fontSize: '10.5px' }}>context not reported yet</p>
                )}

                <div className="cx-tel-trio">
                  <div className="cx-tel-stat">
                    <div className="cx-tel-stat-value">{turns}</div>
                    <div className="cx-tel-stat-label">TURNS</div>
                  </div>
                  <div className="cx-tel-stat">
                    <div className="cx-tel-stat-value">{tel.tools}</div>
                    <div className="cx-tel-stat-label">TOOLS</div>
                  </div>
                  <div className="cx-tel-stat">
                    <div className="cx-tel-stat-value">{tel.sources}</div>
                    <div className="cx-tel-stat-label">SOURCES</div>
                  </div>
                </div>
              </section>

              {tel.specialists.length > 0 && (
                <section className="cx-cockpit-dock-section">
                  <h3 className="cx-cockpit-dock-heading">Specialists engaged</h3>
                  <div className="cx-tel-spec-list">
                    {tel.specialists.map(([name, count]) => (
                      <div key={name} className="cx-tel-spec-row">
                        <span className="cx-tel-spec-name">{name}</span>
                        <span className="cx-tel-spec-bar" aria-hidden>
                          <span
                            className="cx-tel-spec-fill"
                            style={{ width: `${Math.round((count / tel.specialistMax) * 100)}%` }}
                          />
                        </span>
                        <span className="cx-tel-spec-count">{count}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {ledger.length > 0 && (
                <section className="cx-cockpit-dock-section">
                  <h3 className="cx-cockpit-dock-heading">Token ledger</h3>
                  {ledger.map(([k, v]) => (
                    <div key={k} className="cx-cockpit-ledger-row">
                      <span>{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </section>
              )}

              {sessionMeta.oracle?.visible && (
                <section className="cx-cockpit-dock-section">
                  <h3 className="cx-cockpit-dock-heading">Oracle</h3>
                  <p className="cx-cockpit-warn" style={{ fontSize: '12px', margin: '0 0 6px' }}>
                    {sessionMeta.oracle.summary}
                  </p>
                  {sessionMeta.oracle.topGaps.slice(0, 3).map((g) => (
                    <p key={g.id} className="cx-cockpit-muted" style={{ fontSize: '11px', margin: '0 0 2px' }}>
                      {`${g.id}: ${g.detail}`}
                    </p>
                  ))}
                  <p className="cx-cockpit-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                    /oracle for full detail
                  </p>
                </section>
              )}

              <section className="cx-cockpit-dock-section">
                <h3 className="cx-cockpit-dock-heading">Layers</h3>
                <div className="cx-cockpit-layer-row">
                  {LAYER_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="cx-cockpit-layer-chip"
                      aria-pressed={layers?.[k] !== false}
                      onClick={() => onToggleLayer?.(k)}
                    >
                      {`${k}=${layers?.[k] !== false ? 'on' : 'off'}`}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'turn' && (
            <div role="tabpanel" aria-label="Turn routing details">
              {overlay ? (
                <RouteSections overlay={overlay} />
              ) : (
                <p className="cx-cockpit-muted" style={{ fontSize: '12px', padding: '12px 0' }}>
                  No turn selected. Click ⋯ on a message to see its routing detail.
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
