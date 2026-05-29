/**
 * useApi — typed fetch hook for dashboard pages. Calls a thunk that wraps an
 * apiGet/apiPost from lib/api.ts; surfaces { data, error, loading, reload }.
 *
 * For pages that need live updates, useApi accepts an optional intervalMs
 * for polling. For SSE-driven pages, use the dedicated useSse hook instead.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

export function useApi<T>(fn: () => Promise<T>, intervalMs?: number): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (intervalMs && intervalMs > 0) {
      const id = setInterval(load, intervalMs);
      return () => clearInterval(id);
    }
  }, [load, intervalMs]);

  return { data, error, loading, reload: load };
}
