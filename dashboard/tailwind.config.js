/** @type {import('tailwindcss').Config} */
/*
 * tailwind.config.js — Construct design system v2 (aurora).
 *
 * CSS vars in src/index.css are the source of truth; this file maps
 * a small set of semantic Tailwind utilities (bg-bg, text-text-muted,
 * border-border) onto them so components don't hard-code hex values.
 */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:          'var(--bg)',
        'bg-muted':  'var(--bg-muted)',
        surface:     'var(--surface)',
        border:      'var(--border)',
        text:        'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-dim':  'var(--text-dim)',
        ink: {
          50:  'var(--ink-50)',
          100: 'var(--ink-100)',
          200: 'var(--ink-200)',
          300: 'var(--ink-300)',
          400: 'var(--ink-400)',
          500: 'var(--ink-500)',
          600: 'var(--ink-600)',
          700: 'var(--ink-700)',
          800: 'var(--ink-800)',
          900: 'var(--ink-900)',
        },
        aurora: {
          mint:   'var(--aurora-mint)',
          cyan:   'var(--aurora-cyan)',
          violet: 'var(--aurora-violet)',
          pink:   'var(--aurora-pink)',
        },
        status: {
          healthy:  'var(--status-healthy)',
          degraded: 'var(--status-degraded)',
          down:     'var(--status-down)',
        },
      },
      backgroundImage: {
        aurora: 'var(--aurora-gradient)',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
