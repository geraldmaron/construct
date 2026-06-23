/**
 * lib/chat/continuation-source.mjs — the one resolveSource every surface shares to
 * rehydrate a continuation packet's reconstructible layers (construct-6zga.1.10).
 *
 * A continuation packet stores required state verbatim but references reconstructible
 * layers (static instructions, role guidance, learned patterns) by source id, so
 * rehydration must re-derive them rather than read stored content. One shared
 * resolver across terminal, web, export, and resume guarantees every surface
 * reconstructs identical context (AC3). Static-instructions and role-guidance
 * families re-derive through the same composer a live turn runs
 * (lib/chat/system-prompt.mjs); learned-patterns re-derive from the observation
 * store, prefetched once because rehydration runs synchronously.
 */

import { buildSystemPrompt } from './system-prompt.mjs';

function observationText(record) {
  return [record?.summary, record?.content].filter(Boolean).join(' — ').trim();
}

export function createContinuationResolver({
  systemText = null,
  overlay = null,
  capabilityTier = 'full',
  cwd = process.cwd(),
  learnedPatterns = null,
} = {}) {
  const composedSystem = typeof systemText === 'string' ? systemText : buildSystemPrompt({ overlay, capabilityTier });
  const cache = new Map([['prompt:system', composedSystem]]);
  if (typeof learnedPatterns === 'string') cache.set('learned-patterns', learnedPatterns);

  function resolveSource(sourceId) {
    if (sourceId == null) return null;
    if (cache.has(sourceId)) return cache.get(sourceId);
    if (sourceId.startsWith('prompt:') || sourceId.startsWith('role:')) return composedSystem;
    if (sourceId === 'learned-patterns' || sourceId.startsWith('observation:')) return cache.get('learned-patterns') ?? null;
    return null;
  }

  // Learned patterns live in the observation store and load asynchronously; a
  // surface that wants them prefetches once, after which the synchronous
  // resolveSource serves them from cache. A store miss leaves the layer null —
  // rehydration reports it unresolved rather than inventing content.

  async function loadLearnedPatterns(query, { limit = 5 } = {}) {
    try {
      const { searchObservations } = await import('../observation-store.mjs');
      const results = await searchObservations(cwd, query, { limit });
      const text = (results || []).map(observationText).filter(Boolean).map((line) => `- ${line}`).join('\n');
      cache.set('learned-patterns', text);
      return text;
    } catch {
      return cache.get('learned-patterns') ?? null;
    }
  }

  return { resolveSource, loadLearnedPatterns, get systemText() { return composedSystem; } };
}
