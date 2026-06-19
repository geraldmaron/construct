/**
 * Interactive dashboard shell — topbar + sidebar + main + ⌘K palette.
 * Owns runtime visual preferences (theme/density/motion/calm/palette) and
 * persists them to localStorage under `construct-dashboard-prefs`.
 */

'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  CommandPalette, SearchIcon, GitHubIcon,
  SunGlyph, MoonGlyph, DensityCompact, DensityComfy,
} from '@cx/ui';
import { NAV, PALETTE, type NavGroup } from './nav-data';

type Theme = 'dark' | 'light';
type Density = 'comfortable' | 'compact';

type Prefs = {
  theme: Theme;
  density: Density;
  reduceMotion: boolean;
  calmMode: boolean;
  palette: [string, string, string];
};

const STORAGE_KEY = 'construct-dashboard-prefs';
const DEFAULTS: Prefs = {
  theme: 'dark',
  density: 'comfortable',
  reduceMotion: false,
  calmMode: false,
  palette: ['#8b5cf6', '#38bdf8', '#fb923c'],
};

function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function AppShellClient({ nav, children }: { nav: NavGroup[]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scroll, setScroll] = useState(0);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* quota */ }
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
    root.dataset.motion = prefs.reduceMotion ? 'reduce' : 'normal';
    root.style.setProperty('--hue-a', prefs.palette[0]);
    root.style.setProperty('--hue-b', prefs.palette[1]);
    root.style.setProperty('--hue-c', prefs.palette[2]);
  }, [prefs, hydrated]);

  useEffect(() => {
    document.documentElement.style.setProperty('--scroll', String(scroll));
  }, [scroll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (
        e.key === '/' &&
        !paletteOpen &&
        document.activeElement &&
        (document.activeElement as HTMLElement).tagName !== 'INPUT'
      ) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  const onScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setScroll(max > 0 ? el.scrollTop / max : 0);
  }, []);

  const toggleTheme = () => setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }));
  const toggleDensity = () => setPrefs((p) => ({ ...p, density: p.density === 'compact' ? 'comfortable' : 'compact' }));

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/' || pathname === '';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const isChatRoute = pathname === '/chat' || pathname === '/chat/';

  return (
    <div className={'shell' + (prefs.calmMode ? ' calm' : '') + (isChatRoute ? ' shell--chat' : '')} data-testid="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      {!isChatRoute ? (
      <header className="topbar">
        <Link href="/" className="brand">
          <div className="mark" />
          <div className="name">Construct<em>dashboard</em></div>
        </Link>
        <div className="search-wrap">
          <label className="search" onClick={() => setPaletteOpen(true)}>
            <SearchIcon />
            <input
              readOnly
              placeholder="Search dashboard…"
              aria-label="Search dashboard (Command-K)"
              onFocus={() => setPaletteOpen(true)}
            />
            <span className="kbd">⌘K</span>
          </label>
        </div>
        <div className="top-actions">
          <button
            className="icon-btn"
            type="button"
            onClick={toggleTheme}
            aria-label={prefs.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={prefs.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {prefs.theme === 'dark' ? <SunGlyph /> : <MoonGlyph />}
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={toggleDensity}
            aria-label={prefs.density === 'compact' ? 'Switch to comfortable density' : 'Switch to compact density'}
            title={prefs.density === 'compact' ? 'Switch to comfortable density' : 'Switch to compact density'}
          >
            {prefs.density === 'compact' ? <DensityComfy /> : <DensityCompact />}
          </button>
          <a
            className="icon-btn outlined"
            href="https://github.com/geraldmaron/construct"
            target="_blank"
            rel="noreferrer"
            aria-label="Construct repository on GitHub (opens in a new tab)"
          >
            <GitHubIcon /> <span style={{ fontSize: 11 }}>repo</span>
          </a>
        </div>
        <div className="progress" />
      </header>
      ) : null}

      <div className="body-grid">
        {!isChatRoute ? (
        <nav className="sidebar" aria-label="Dashboard sections">
          {nav.map((group) => (
            <div className="side-group" key={group.label}>
              <div className="side-label">{group.label}</div>
              {group.items.map((it, idx) => {
                const active = isActive(it.href);
                const num = (idx + 1).toString().padStart(2, '0');
                return (
                  <Link
                    key={it.id}
                    href={it.href}
                    className={'side-link' + (active ? ' active' : '')}
                  >
                    <span className="num">{num}</span>
                    <span>{it.title}</span>
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="side-foot">
            Local dashboard for Construct. Theme + density preferences persist.
          </div>
        </nav>
        ) : null}

        <main className={'main' + (isChatRoute ? ' main--chat' : '')} id="main" tabIndex={-1} ref={mainRef} onScroll={onScroll}>
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        items={PALETTE}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(href) => router.push(href)}
      />
    </div>
  );
}
