/**
 * apps/chat/web/components/routing-block.tsx — inline specialist routing visualization.
 *
 * Collapsed by default; expanded shows intent, specialist chip chain, dispatch reasons,
 * contract edges, risk flags, and gate status.
 */

'use client';

import { useState } from 'react';
import type { RouteOverlay } from '../types';
import { formatRouteCollapsed } from '../lib/format';

type RoutingBlockProps = {
  overlay: RouteOverlay | null;
  visible: boolean;
};

const RISK_LABEL: Record<string, string> = {
  architecture: 'arch',
  security: 'security',
  dataIntegrity: 'data',
  ui: 'ui',
  docs: 'docs',
  ai: 'ai',
};

export function RoutingBlock({ overlay, visible }: RoutingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!visible || !overlay) return null;

  const chain = overlay.specialists ?? [];
  const risks = Object.entries(overlay.riskFlags ?? {})
    .filter(([, v]) => v)
    .map(([k]) => RISK_LABEL[k] ?? k);
  const strip = formatRouteCollapsed(overlay);

  if (!strip && !chain.length && !overlay.intent) return null;

  const reasons = overlay.dispatchReasons ?? {};
  const contracts = overlay.contractChain ?? [];
  const hasDetail =
    chain.length > 0 ||
    Object.keys(reasons).length > 0 ||
    contracts.length > 0 ||
    risks.length > 0 ||
    overlay.externalResearch?.required ||
    overlay.framingChallenge?.required;

  return (
    <div className="cx-routing-block" data-expanded={expanded}>
      <button
        type="button"
        className="cx-routing-summary"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasDetail}
      >
        <span className="cx-routing-label">Routing</span>
        {strip ? (
          <span className="cx-routing-strip">{strip}</span>
        ) : (
          <span className="cx-routing-strip cx-routing-direct">direct response</span>
        )}
        {risks.length > 0 && (
          <span className="cx-routing-risk-badge">⚠ {risks[0]}</span>
        )}
        {hasDetail && (
          <span className="cx-routing-chevron" aria-hidden>{expanded ? '▴' : '▾'}</span>
        )}
      </button>

      {expanded && hasDetail && (
        <div className="cx-routing-detail">
          {(overlay.intent || overlay.workCategory || overlay.track) && (
            <div className="cx-routing-meta-row">
              {overlay.intent && <span className="cx-routing-meta-chip">{overlay.intent}</span>}
              {overlay.workCategory && <span className="cx-routing-meta-chip">{overlay.workCategory}</span>}
              {overlay.track && <span className="cx-routing-meta-chip cx-routing-track">{overlay.track}</span>}
            </div>
          )}

          {chain.length > 0 && (
            <div className="cx-routing-chain">
              {chain.map((id, i) => (
                <span key={id} className="cx-routing-chain-item">
                  {i > 0 && <span className="cx-routing-arrow" aria-hidden>→</span>}
                  <span
                    className="cx-routing-specialist-chip"
                    title={reasons[id] ?? undefined}
                  >
                    {id.replace(/^cx-/, '')}
                  </span>
                </span>
              ))}
            </div>
          )}

          {Object.entries(reasons).length > 0 && (
            <div className="cx-routing-reasons">
              {Object.entries(reasons).map(([spec, reason]) => (
                <div key={spec} className="cx-routing-reason-row">
                  <span className="cx-routing-reason-spec">{spec.replace(/^cx-/, '')}</span>
                  <span className="cx-routing-reason-text">{reason}</span>
                </div>
              ))}
            </div>
          )}

          {contracts.length > 0 && (
            <div className="cx-routing-contracts">
              {contracts.map((edge) => (
                <div key={edge.id ?? `${edge.producer}-${edge.consumer}`} className="cx-routing-contract-row">
                  <span className="cx-routing-contract-producer">{edge.producer.replace(/^cx-/, '')}</span>
                  <span className="cx-routing-arrow" aria-hidden>→</span>
                  <span className="cx-routing-contract-consumer">{edge.consumer.replace(/^cx-/, '')}</span>
                  {edge.stage && <span className="cx-routing-contract-stage">({edge.stage})</span>}
                </div>
              ))}
            </div>
          )}

          {risks.length > 0 && (
            <div className="cx-routing-risk-row">
              {risks.map((r) => (
                <span key={r} className="cx-routing-risk-pill">⚠ {r}</span>
              ))}
            </div>
          )}

          {overlay.externalResearch?.required && (
            <div className="cx-routing-gate">
              research required
              {overlay.externalResearch.shape ? ` · ${overlay.externalResearch.shape}` : ''}
            </div>
          )}
          {overlay.framingChallenge?.required && (
            <div className="cx-routing-gate">framing challenge required</div>
          )}
          {overlay.docAuthoring?.docType && (
            <div className="cx-routing-gate">
              {overlay.docAuthoring.docType} doc → {overlay.docAuthoring.owner ?? 'owner TBD'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
