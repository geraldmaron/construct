/**
 * MDX component shims used by docs/ MDX files.
 *
 * The repo-root docs/ tree was authored against Fumadocs primitives
 * (FlowPipeline, RequestFlow, SyncGrid, AgentGrid, DeployModes, Cards/Card,
 * Steps/Step). We render those same MDX files inside the editorial shell;
 * each shim below produces an editorial-language equivalent using the same
 * tokens as the rest of the chrome (hairlines, mono eyebrows, hue accents).
 *
 * Every shim is server-renderable — no client state — so MDX pages stay
 * statically generated.
 */

import { ReactNode } from 'react';
import Link from 'next/link';

const ACCENT_VARS = {
  hueA: 'var(--hue-a)',
  hueB: 'var(--hue-b)',
  hueC: 'var(--hue-c)',
};

/* ─── FlowPipeline ──────────────────────────────────────────── */

export interface PipelineStep {
  label: string;
  sub?: string;
  badge?: string;
  via?: string;
  highlight?: boolean;
}

export function FlowPipeline({ steps, vertical = false }: { steps: PipelineStep[]; vertical?: boolean }) {
  return (
    <div className={'flow-pipeline' + (vertical ? ' vertical' : '')}>
      {steps.map((step, i) => (
        <span key={i} className="flow-row">
          {i > 0 && (
            <span className="flow-arrow">
              {step.via && <span className="flow-via">{step.via}</span>}
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.4">
                <line x1="1" y1="5" x2="11" y2="5" />
                <polyline points="8 2 12 5 8 8" />
              </svg>
            </span>
          )}
          <span className={'flow-node' + (step.highlight ? ' highlight' : '')}>
            {step.badge && <span className="flow-badge">{step.badge}</span>}
            <span className="flow-label">{step.label}</span>
            {step.sub && <span className="flow-sub">{step.sub}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ─── RequestFlow ───────────────────────────────────────────── */

export interface FlowNode {
  label: string;
  sub?: string;
  decision?: boolean;
  exitLabel?: string;
  highlight?: boolean;
}

export function RequestFlow({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="request-flow">
      {nodes.map((n, i) => (
        <div key={i} className="rf-row">
          <div
            className={
              'rf-node'
              + (n.decision ? ' decision' : '')
              + (n.highlight ? ' highlight' : '')
            }
          >
            {n.decision && <div className="rf-tag">gate / check</div>}
            <div className="rf-label">{n.label}</div>
            {n.sub && <div className="rf-sub">{n.sub}</div>}
          </div>
          {i < nodes.length - 1 && (
            <div className="rf-arrow">
              {n.exitLabel && <span className="rf-exit">{n.exitLabel}</span>}
              <svg width="10" height="22" viewBox="0 0 10 22" fill="none" stroke="currentColor" strokeWidth="1.4">
                <line x1="5" y1="1" x2="5" y2="17" />
                <polyline points="2 14 5 18 8 14" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── SyncGrid ──────────────────────────────────────────────── */

export interface SyncTarget {
  name: string;
  path: string;
  type: 'full' | 'prompt' | 'mcp';
}

const SYNC_BADGE: Record<SyncTarget['type'], { label: string; hue: string }> = {
  full: { label: 'full adapter', hue: ACCENT_VARS.hueB },
  prompt: { label: 'prompt profiles', hue: ACCENT_VARS.hueA },
  mcp: { label: 'mcp only', hue: ACCENT_VARS.hueC },
};

export function SyncGrid({ targets }: { targets: SyncTarget[] }) {
  return (
    <div className="sync-grid">
      {targets.map((t, i) => {
        const b = SYNC_BADGE[t.type];
        return (
          <div key={i} className="sync-cell">
            <div className="sync-head">
              <span className="sync-name">{t.name}</span>
              <span className="sync-badge" style={{ color: b.hue, borderColor: b.hue }}>{b.label}</span>
            </div>
            <div className="sync-path">{t.path}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── AgentGrid ─────────────────────────────────────────────── */

export interface AgentCard {
  name: string;
  tag: string;
}

export interface AgentGroup {
  label: string;
  accent: 'emerald' | 'sky' | 'violet' | 'amber' | 'rose';
  agents: AgentCard[];
}

const AGENT_ACCENTS: Record<AgentGroup['accent'], string> = {
  emerald: ACCENT_VARS.hueB,
  sky: ACCENT_VARS.hueB,
  violet: ACCENT_VARS.hueA,
  amber: ACCENT_VARS.hueC,
  rose: ACCENT_VARS.hueC,
};

export function AgentGrid({ groups }: { groups: AgentGroup[] }) {
  return (
    <div className="agent-groups">
      {groups.map((g, i) => (
        <div key={i} className="agent-group" style={{ borderLeftColor: AGENT_ACCENTS[g.accent] }}>
          <div className="agent-group-label" style={{ color: AGENT_ACCENTS[g.accent] }}>{g.label}</div>
          <div className="agent-cells">
            {g.agents.map((a, j) => (
              <div key={j} className="agent-cell">
                <div className="agent-name">{a.name}</div>
                <div className="agent-tag">{a.tag}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── DeployModes ───────────────────────────────────────────── */

export interface DeployMode {
  name: string;
  tag: string;
  description: string;
  rows: { label: string; value: string }[];
}

export function DeployModes({ modes }: { modes: DeployMode[] }) {
  return (
    <div className="deploy-modes">
      {modes.map((m, i) => (
        <div key={i} className="deploy-mode">
          <div className="dm-head">
            <span className="dm-name">{m.name}</span>
            <span className="dm-tag">{m.tag}</span>
          </div>
          <p className="dm-desc">{m.description}</p>
          <dl className="dm-rows">
            {m.rows.map((r, j) => (
              <div key={j} className="dm-row">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/* ─── Cards / Card ──────────────────────────────────────────── */

export function Cards({ children }: { children: ReactNode }) {
  return <div className="md-cards">{children}</div>;
}

export function Card({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  const inner = (
    <>
      <div className="md-card-title">{title}</div>
      <div className="md-card-body">{children}</div>
    </>
  );
  if (href) {
    const external = /^https?:\/\//.test(href);
    if (external) {
      return <a className="md-card" href={href} target="_blank" rel="noreferrer">{inner}</a>;
    }
    return <Link className="md-card" href={href}>{inner}</Link>;
  }
  return <div className="md-card">{inner}</div>;
}

/* ─── Steps / Step ──────────────────────────────────────────── */

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="md-steps">{children}</ol>;
}

export function Step({ children }: { children: ReactNode }) {
  return <li className="md-step">{children}</li>;
}

/* ─── Callout ───────────────────────────────────────────────── */

export function Callout({ title, type, children }: { title?: string; type?: string; children: ReactNode }) {
  return (
    <div className={'callout' + (type ? ` callout-${type}` : '')}>
      {title && <span className="clt-label">{title}</span>}
      <div>{children}</div>
    </div>
  );
}
