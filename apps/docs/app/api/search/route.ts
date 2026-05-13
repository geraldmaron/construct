import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Static-export friendly: pre-render the search index at build time.
export const revalidate = false;
export const dynamic = 'force-static';

export const { staticGET: GET } = createFromSource(source);
