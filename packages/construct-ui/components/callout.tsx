/**
 * Editorial callout — bordered card with a gradient-rule along the left edge.
 * Optional `label` renders as the uppercase mono header above the body.
 */

import { ReactNode } from 'react';

type CalloutProps = {
  label?: string;
  children: ReactNode;
};

export function Callout({ label, children }: CalloutProps) {
  return (
    <div className="callout">
      {label && <span className="clt-label">{label}</span>}
      <div>{children}</div>
    </div>
  );
}
