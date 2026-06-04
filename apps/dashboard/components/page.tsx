/**
 * Page primitive — eyebrow + title + lede + meta-strip in the editorial
 * shape. Wraps any dashboard route body. Use <Section> from @cx/ui for
 * collapsible sub-areas; use <Card> + <CardGrid> below for KPI-style tiles.
 */

import { ReactNode } from 'react';

type PageProps = {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
};

export function Page({ eyebrow, title, lede, meta, children }: PageProps) {
  return (
    <div className="page">
      <div className="eyebrow">
        <span className="dot" />
        <span>{eyebrow}</span>
      </div>
      <h1 className="page-title">{title}</h1>
      {lede && <p className="page-lede">{lede}</p>}
      {meta && <div className="meta-strip">{meta}</div>}
      <div className="body">{children}</div>
    </div>
  );
}

/* Card grid for KPI tiles, mirroring hero-stats from the editorial theme. */

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="hero-stats" style={{ marginTop: 0, marginBottom: 24 }}>{children}</div>;
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="hero-stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{sub}</span>}
    </div>
  );
}

/* Status pill — green/amber/red dot + label. */

type Status = 'ok' | 'warn' | 'err' | 'idle';

const STATUS_COLOR: Record<Status, string> = {
  ok: 'var(--hue-b)',
  warn: 'var(--hue-c)',
  err: '#ef4444',
  idle: 'var(--muted)',
};

export function StatusPill({ status, label }: { status: Status; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--mono)',
      fontSize: 10.5,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--ink-soft)',
      padding: '3px 9px',
      borderRadius: 999,
      border: '1px solid var(--hairline-strong)',
    }}>
      <span aria-hidden style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: STATUS_COLOR[status],
      }} />
      {label}
    </span>
  );
}

/* Simple data table that matches the editorial style. */

export function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <table>
      <thead>
        <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={columns.length} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No data</td></tr>
        )}
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => <td key={j}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* Empty / loading / error states. */

export function EmptyState({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <div className="callout">
      <span className="clt-label">{label}</span>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div role="status" aria-live="polite" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
      Loading…
    </div>
  );
}
