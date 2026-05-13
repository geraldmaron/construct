import type { Config } from 'tailwindcss';
import { createPreset } from 'fumadocs-ui/tailwind-plugin';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './content/**/*.{md,mdx}',
    '../../docs/**/*.{md,mdx}',
    './node_modules/fumadocs-ui/dist/**/*.js',
    './mdx-components.{ts,tsx}',
  ],
  presets: [createPreset()],
};

export default config;
