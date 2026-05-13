import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

// Repo-root docs/ is the canonical source. The whole site IS docs (the marketing
// landing lives in (home), the docs catch-all in (docs)), so docs URLs are rooted
// at /. Generated URLs follow the file path under docs/ — e.g. docs/start/install.mdx
// becomes /start/install.
export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
});
