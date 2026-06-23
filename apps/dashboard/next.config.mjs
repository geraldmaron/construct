import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A deterministic buildId is the only thing that makes the static export
// reproducible: Next defaults to a random buildId per build, which is the sole
// source of churn in the committed `lib/server/static/` tree (every chunk is
// already content-hashed and stable). Derive it from the root package version
// so it is stable within a release and still cache-busts across upgrades.

const rootPkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'),
);
const buildId = `construct-${rootPkg.version}`;

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
  // The Construct CLI HTTP server (lib/server/index.mjs) hosts this app at /,
  // so no basePath. Trailing slash matches the docs site for consistency.
  trailingSlash: true,
  images: { unoptimized: true },
  generateBuildId: () => buildId,
};

export default config;
