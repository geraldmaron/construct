/**
 * Interactive shell — topbar + sidebar + main grid + command palette + theme
 * state. The sidebar tree comes from the server (built from docs/), so the
 * client only owns visual preferences: theme, density, motion, calm mode,
 * hue palette. Preferences persist to localStorage under one key.
 */

'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CommandPalette, SearchIcon, GitHubIcon,
  SunGlyph, MoonGlyph, DensityCompact, DensityComfy,
} from '@construct/ui';
import { PALETTE } from './nav-data';
import type { SidebarSection } from '@/lib/docs-source';

type Theme = 'dark' | 'light';
type Density = 'comfortable' | 'compact';

type Prefs = {
  theme: Theme;
  density: Density;
  reduceMotion: boolean;
  calmMode: boolean;
  palette: [string, string, string];
};

const STORAGE_KEY = 'construct-docs-prefs';
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

export function AppShellClient({ sidebar, children }: { sidebar: SidebarSection[]; children: ReactNode }) {
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

  return (
    <div className={'shell' + (prefs.calmMode ? ' calm' : '')}>
      <header className="topbar">
        <Link href="/" className="brand">
          <div className="mark" />
          <div className="name">Construct<em>docs</em></div>
        </Link>
        <div className="search-wrap">
          <label className="search" onClick={() => setPaletteOpen(true)}>
            <SearchIcon />
            <input
              readOnly
              placeholder="Search docs, commands, agents…"
              onFocus={() => setPaletteOpen(true)}
            />
            <span className="kbd">⌘K</span>
          </label>
        </div>
        <div className="top-actions">
          <button className="icon-btn" title="Toggle theme" onClick={toggleTheme} type="button">
            {prefs.theme === 'dark' ? <SunGlyph /> : <MoonGlyph />}
          </button>
          <button className="icon-btn" title="Toggle density" onClick={toggleDensity} type="button">
            {prefs.density === 'compact' ? <DensityComfy /> : <DensityCompact />}
          </button>
          <a className="icon-btn outlined" href="https://github.com/geraldmaron/construct" target="_blank" rel="noreferrer">
            <GitHubIcon /> <span style={{ fontSize: 11 }}>repo</span>
          </a>
        </div>
        <div className="progress" />
      </header>

      <div className="body-grid">
        <aside className="sidebar">
          {sidebar.map((group) => (
            <div className="side-group" key={group.label}>
              <div className="side-label">{group.label}</div>
              {group.items.map((it, idx) => {
                const active = isActive(it.href);
                const num = (idx + 1).toString().padStart(2, '0');
                const className = 'side-link' + (active ? ' active' : '');
                return (
                  <Link key={it.id} href={it.href} className={className}>
                    <span className="num">{num}</span>
                    <span>{it.title}</span>
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="side-foot">
            Built for the <strong>neurodivergent reader</strong>: headings always visible, body
            collapsed, one section at a time. Toggle density in the header.
          </div>
        </aside>

        <main className="main" ref={mainRef} onScroll={onScroll}>
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        items={PALETTE}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(href) => { window.location.href = href; }}
      />
    </div>
  );
}
