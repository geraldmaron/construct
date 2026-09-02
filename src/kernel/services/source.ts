/**
 * kernel/services/source.ts — source façade.
 */

import type { StateStore } from '../state-v1/open.ts';
import { addSource, getSource, listSources, type Source } from '../state-v1/sources.ts';

export interface SourceService {
  add(input: Parameters<typeof addSource>[1]): Source;
  get(id: string): Source | null;
  list(): Source[];
}

export function createSourceService(store: StateStore): SourceService {
  return {
    add: (input) => addSource(store, input),
    get: (id) => getSource(store, id),
    list: () => listSources(store),
  };
}
