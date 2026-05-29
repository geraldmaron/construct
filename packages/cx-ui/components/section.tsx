/**
 * Collapsible editorial section. Heading + section number + optional TL;DR
 * always visible; body expands on click via a CSS grid row-template animation
 * so the transition stays GPU-friendly. Mirrors the design's `Section`
 * primitive (docs-components.jsx).
 */

'use client';

import { ReactNode, useState } from 'react';
import { Chevron } from './icons';

type SectionProps = {
  num: string;
  title: ReactNode;
  tldr?: ReactNode;
  time?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function Section({ num, title, tldr, time, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={'section' + (open ? ' open' : '')}>
      <button
        className="section-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        type="button"
      >
        <span className="chev"><Chevron /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="section-num">{num}</span>
          <span className="section-title">{title}</span>
        </span>
        <span className="section-aside">{time && <span>{time}</span>}</span>
      </button>
      {tldr && (
        <div className="tldr-row">
          <div className="tldr"><b>TL;DR</b>{tldr}</div>
        </div>
      )}
      <div className="section-body-wrap">
        <div className="section-body">
          <div className="section-body-inner">
            <div className="body">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
