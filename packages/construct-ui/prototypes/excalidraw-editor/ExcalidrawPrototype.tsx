/**
 * Excalidraw feasibility prototype (construct-tsyfe.4.6). PROTOTYPE ONLY — not
 * exported from @construct/ui and not wired to any production route. Lazy-imports
 * @excalidraw/excalidraw on demand so the initial bundle stays free of the editor.
 */

'use client';

import { useEffect, useState, type ComponentType } from 'react';

type ExcalidrawProps = {
  initialData?: unknown;
};

type ExcalidrawPrototypeProps = {
  enabled: boolean;
  ariaLabel?: string;
};

export function ExcalidrawPrototype({ enabled, ariaLabel = 'Editable drawing prototype' }: ExcalidrawPrototypeProps) {
  const [Editor, setEditor] = useState<ComponentType<ExcalidrawProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEditor(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@excalidraw/excalidraw');
        if (!cancelled) setEditor(() => mod.Excalidraw as ComponentType<ExcalidrawProps>);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Excalidraw load failed');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="excalidraw-prototype" data-state="idle">
        Editor not loaded (call with enabled=true to lazy-load Excalidraw).
      </div>
    );
  }

  if (error) {
    return (
      <div className="excalidraw-prototype" data-state="error" role="alert">
        {error}
      </div>
    );
  }

  if (!Editor) {
    return (
      <div className="excalidraw-prototype" data-state="loading" aria-busy="true">
        Loading Excalidraw…
      </div>
    );
  }

  return (
    <div
      className="excalidraw-prototype"
      data-state="ready"
      role="region"
      aria-label={ariaLabel}
      style={{ minHeight: 480, width: '100%' }}
    >
      <Editor />
    </div>
  );
}
