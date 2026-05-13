import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

// MDX/MD source lives in the repo-root docs/ directory, NOT inside apps/docs.
// This is the single-source-of-truth principle: docs/ stays canonical; the
// Next.js app reads from it directly with no double-write.

export const docs = defineDocs({
  dir: '../../docs',
});

export default defineConfig({});
