import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

// Repo-root docs/ is the canonical source. URLs are derived from file paths
// under docs/ — e.g. docs/start/install.mdx → /start/install.
export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
});
