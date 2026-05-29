/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  // The Construct CLI HTTP server (lib/server/index.mjs) hosts this app at /,
  // so no basePath. Trailing slash matches the docs site for consistency.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
