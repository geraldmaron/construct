/**
 * Track the current theme as set on the <html data-theme> attribute by
 * AppShell. Used by client components that need to react to theme changes
 * (e.g. Mermaid, which has to re-render with a matching palette).
 */

'use client';

import { useEffect, useState } from 'react';

export type DocsTheme = 'dark' | 'light';

export function useTheme(): DocsTheme {
  const [theme, setTheme] = useState<DocsTheme>('dark');

  useEffect(() => {
    const read = (): DocsTheme =>
      (document.documentElement.dataset.theme as DocsTheme) || 'dark';
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
