import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  basePath: process.env.DOCS_BASE_PATH || '',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withMDX(config);
