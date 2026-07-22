import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx,md,mdx}',
    './components/**/*.{ts,tsx}',
    './content/**/*.{ts,tsx,md,mdx}',
    '../../packages/construct-ui/**/*.{ts,tsx,css}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Newsreader', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
};

export default config;
