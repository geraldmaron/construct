/**
 * 2-up numbered feature grid for editorial section bodies. Mirrors the
 * `.feature-row` / `.feature-cell` layout from the design's home page.
 */

import { ReactNode } from 'react';

export type FeatureCell = {
  num: string;
  title: ReactNode;
  body: ReactNode;
};

export function FeatureGrid({ cells }: { cells: FeatureCell[] }) {
  return (
    <div className="feature-row">
      {cells.map((c, i) => (
        <div className="feature-cell" key={i}>
          <div className="fc-num">{c.num}</div>
          <div className="fc-h">{c.title}</div>
          <div className="fc-b">{c.body}</div>
        </div>
      ))}
    </div>
  );
}
