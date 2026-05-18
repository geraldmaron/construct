import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { fetchMode, fetchAlias } from './lib/api';
import './App.css';
import Resources from './pages/Resources';
import Workflow from './pages/Workflow';
import Approvals from './pages/Approvals';
import Snapshots from './pages/Snapshots';
import Agents from './pages/Agents';
import Skills from './pages/Skills';
import { PersonasPage, AgentsEditorPage, SkillsEditorPage, RulesEditorPage } from './pages/Editor';
import Audit from './pages/Audit';
import Performance from './pages/Performance';
import { CommandPalette } from './components/CommandPalette';
import Commands from './pages/Commands';
import Hooks from './pages/Hooks';
import MCP from './pages/MCP';
import Plugins from './pages/Plugins';
import Providers from './pages/Providers';
import Models from './pages/Models';
import Beads from './pages/Beads';
import Artifacts from './pages/Artifacts';
import Knowledge from './pages/Knowledge';
import Intake from './pages/Intake';
import Infrastructure from './pages/Infrastructure';
import Config from './pages/Config';
import Doctor from './pages/Doctor';

/*
 * App.tsx — sidebar + router shell.
 *
 * Aurora design system from index.css. Sidebar wordmark uses the
 * `.text-aurora` gradient. Active nav item picks up a soft aurora
 * tint via the .card primitive border, never a saturated indigo
 * block — keeps the cognitive load low and the layout predictable
 * across sessions.
 */

function App() {
  const [mode, setMode] = useState('init');
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [alias, setAlias] = useState<string>('Construct');
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(() => {
    const stored = (typeof window !== 'undefined' ? localStorage.getItem('cx-theme') : null);
    return (stored === 'light' || stored === 'dark' || stored === 'auto') ? stored : 'auto';
  });
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try { localStorage.setItem('cx-theme', theme); } catch { /* private mode */ }
  }, [theme]);

  useEffect(() => {
    Promise.all([
      fetchMode()
        .then((data) => {
          setMode(data.mode);
          setInstanceId(data.instanceId || null);
        })
        .catch(() => { setMode('init'); setInstanceId(null); }),
      fetchAlias()
        .then((data) => { if (data?.value) setAlias(data.value); })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="text-aurora text-sm tracking-wide">Loading…</div>
      </div>
    );
  }

  // Operational + core surfaces visible in every mode; embed/live unlocks
  // the registry surfaces (agents, skills, hooks, …).
  // Sidebar grouped by purpose so the same kind of page lives near
  // related pages. Order: where you start (Overview) → who's working
  // (Authoring) → what's running (Operations) → what powers it (Models
  // & integrations) → settings + audit trail (System).
  const groups: Array<{ heading: string; items: Array<{ path: string; label: string; element: React.ReactNode }> }> = [
    {
      heading: 'Overview',
      items: [
        { path: '/', label: 'Mission Control', element: <Resources /> },
        { path: '/beads', label: 'Beads', element: <Beads /> },
        { path: '/workflow', label: 'Workflow', element: <Workflow /> },
        { path: '/approvals', label: 'Approvals', element: <Approvals /> },
      ],
    },
    {
      heading: 'Authoring',
      items: [
        { path: '/personas', label: 'Personas', element: <PersonasPage /> },
        { path: '/agents-edit', label: 'Agent prompts', element: <AgentsEditorPage /> },
        { path: '/skills', label: 'Skills', element: <SkillsEditorPage /> },
        { path: '/rules', label: 'Rules', element: <RulesEditorPage /> },
      ],
    },
    {
      heading: 'Operations',
      items: [
        { path: '/doctor', label: 'Doctor', element: <Doctor /> },
        { path: '/performance', label: 'Performance', element: <Performance /> },
        { path: '/snapshots', label: 'Snapshots', element: <Snapshots /> },
        { path: '/intake', label: 'Intake', element: <Intake /> },
      ],
    },
    {
      heading: 'Models & integrations',
      items: [
        { path: '/providers', label: 'Providers', element: <Providers /> },
        { path: '/models', label: 'Models', element: <Models /> },
        { path: '/mcp', label: 'MCP servers', element: <MCP /> },
      ],
    },
    {
      heading: 'System',
      items: [
        { path: '/config', label: 'Configuration', element: <Config /> },
        { path: '/audit', label: 'Audit log', element: <Audit /> },
      ],
    },
  ];
  const baseItems = groups.flatMap((g) => g.items);

  const extraItems =
    mode === 'embed' || mode === 'live'
      ? [
          { path: '/agents', label: 'Agents', element: <Agents /> },
          { path: '/skills-browse', label: 'Skills (browse)', element: <Skills /> },
          { path: '/commands', label: 'Commands', element: <Commands /> },
          { path: '/hooks', label: 'Hooks', element: <Hooks /> },
          { path: '/plugins', label: 'Plugins', element: <Plugins /> },
          { path: '/artifacts', label: 'Artifacts', element: <Artifacts /> },
          { path: '/knowledge', label: 'Knowledge', element: <Knowledge /> },
          { path: '/infrastructure', label: 'Infrastructure', element: <Infrastructure /> },
        ]
      : [];

  const navItems = [...baseItems, ...extraItems];

  const closeNav = () => setNavOpen(false);

  const sidebar = (
    <>
      <SidebarWordmark alias={alias} setAlias={setAlias} mode={mode} />
      {instanceId && (
        <div className="px-5 py-2 text-xs text-text-dim border-b border-border truncate">
          {instanceId}
        </div>
      )}
      <nav className="flex-1 mt-3 px-3 space-y-3 overflow-y-auto" aria-label="Primary navigation">
        {groups.map((group) => (
          <div key={group.heading}>
            <p className="px-3 mt-2 mb-1 text-[10px] uppercase tracking-wider text-text-dim font-medium">
              {group.heading}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ path, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === '/'}
                  onClick={closeNav}
                  className={({ isActive }) =>
                    [
                      'block px-3 py-1.5 rounded-md text-sm transition-colors',
                      isActive
                        ? 'bg-bg-muted text-text border-l-2 border-aurora-cyan font-medium'
                        : 'text-text-muted hover:text-text hover:bg-bg-muted',
                    ].join(' ')
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="hairline-aurora" aria-hidden="true" />
      <div className="px-5 py-3 text-xs text-text-dim space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'auto')}
            aria-label="Theme"
            className="bg-bg-muted border border-border rounded px-2 py-1 text-xs"
          >
            <option value="auto">auto</option>
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </div>
        <div className="hidden lg:block">
          <span className="text-text-dim">Press </span>
          <kbd className="px-1.5 py-0.5 bg-bg-muted rounded font-mono text-[10px]">⌘K</kbd>
          <span className="text-text-dim"> to jump</span>
        </div>
        <a
          href="https://construct.dev/docs"
          target="_blank"
          rel="noreferrer"
          className="block hover:text-text"
        >
          Documentation ↗
        </a>
      </div>
    </>
  );

  return (
    <HashRouter>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:bg-surface focus:border focus:border-border focus:rounded-md focus:z-50"
      >
        Skip to main content
      </a>

      <div className="flex flex-col lg:flex-row min-h-screen bg-bg text-text">
        {/* Mobile/tablet header strip with hamburger; hidden on lg+. */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="px-2 py-1 rounded border border-border text-sm"
          >
            ☰
          </button>
          <span className="text-aurora text-lg truncate ml-3">{alias}</span>
          {mode !== 'init' && (
            <span className="ml-auto pip pip-healthy" aria-label={`mode: ${mode}`}>{mode}</span>
          )}
        </header>

        {/* Sidebar — inline on lg+, fixed drawer below lg. */}
        <aside
          aria-label="Primary"
          className={[
            'border-r border-border flex flex-col bg-surface',
            'lg:w-64 lg:relative lg:translate-x-0',
            // Below lg: full-height fixed drawer that slides in
            'fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-150 ease-out',
            navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          ].join(' ')}
        >
          {sidebar}
        </aside>

        {/* Backdrop only when drawer is open below lg. */}
        {navOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeNav}
            className="lg:hidden fixed inset-0 z-30 bg-black/40"
          />
        )}

        <main id="main" className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Routes>
            {navItems.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
          </Routes>
        </main>
      </div>
      <CommandPalette items={navItems.map((i) => ({ path: i.path, label: i.label }))} />
    </HashRouter>
  );
}

function SidebarWordmark({
  alias,
  setAlias,
  mode,
}: {
  alias: string;
  setAlias: (v: string) => void;
  mode: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(alias); }, [alias]);

  async function save() {
    if (!draft.trim()) { setError('alias cannot be empty'); return; }
    setSaving(true);
    setError(null);
    try {
      const current = await fetch('/api/project-config').then((r) => r.json());
      const next = { ...(current.config || {}), alias: draft.trim() };
      const r = await fetch('/api/project-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'save failed');
      setAlias(draft.trim());
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex h-16 items-center px-5 border-b border-border">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xl text-aurora truncate text-left"
          aria-label={`Edit alias (current: ${alias})`}
          title="Click to rename"
        >
          {alias}
        </button>
        {mode !== 'init' && (
          <span className="ml-3 pip pip-healthy" aria-label={`mode: ${mode}`}>
            {mode}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-b border-border space-y-2">
      <label className="block text-[10px] uppercase tracking-wider text-text-dim">Alias</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className="w-full px-2 py-1.5 bg-bg border border-border rounded text-sm"
      />
      {error && <p className="text-xs" style={{ color: 'var(--status-down)' }}>{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || draft === alias}
          className="btn btn-primary text-xs flex-1 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setDraft(alias); }}
          className="btn text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default App;
