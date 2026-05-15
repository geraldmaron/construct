/**
 * Editor.tsx — shared override editor for personas / skills / rules.
 *
 * Single page wired by the parent (Personas.tsx / Skills.tsx). Lists
 * primitives in a left rail, renders the active item on the right with
 * a markdown textarea, edit / save / discard / restore-from-backup
 * controls. Save goes through the override resolver — original is
 * preserved, prior content snapshots to .cx/backups/<category>/, edit
 * lands at .cx/<category>/<name>.<ext>. Restore is a one-click revert.
 */
import { useEffect, useState } from 'react';
import {
  fetchOverrideList,
  fetchOverrideContent,
  fetchOverrideBackups,
  writeOverrideContent,
  restoreOverrideBackup,
} from '../lib/api';

type Item = { name: string; hasOverride: boolean; source: string; custom?: boolean };
type Backup = { filename: string; mtimeMs: number; size: number };

export function OverrideEditor({ category, title, intro }: { category: string; title: string; intro: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [source, setSource] = useState<string>('original');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchOverrideList(category)
      .then((r: any) => setItems(r.items))
      .catch((e: any) => setError(e.message));
  }, [category]);

  useEffect(() => {
    if (!active) return;
    setError(null);
    setSavedMsg(null);
    fetchOverrideContent(category, active)
      .then((r: any) => {
        setContent(r.content);
        setOriginal(r.content);
        setSource(r.source);
      })
      .catch((e: any) => setError(e.message));
    fetchOverrideBackups(category, active)
      .then((r: any) => setBackups(r.backups))
      .catch(() => setBackups([]));
  }, [active, category]);

  const dirty = content !== original;
  const filtered = items.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()));

  async function save() {
    if (!active) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const r = await writeOverrideContent(category, active, content);
      setSavedMsg(`Saved (${r.wrote} bytes${r.backupPath ? ', backup created' : ''})`);
      setOriginal(content);
      const refreshed = await fetchOverrideList(category);
      setItems(refreshed.items);
      const refreshedBackups = await fetchOverrideBackups(category, active);
      setBackups(refreshedBackups.backups);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function restore(filename: string) {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      await restoreOverrideBackup(category, active, filename);
      const r = await fetchOverrideContent(category, active);
      setContent(r.content);
      setOriginal(r.content);
      setSavedMsg(`Restored from ${filename}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <p className="text-text-dim text-xs uppercase tracking-wider mb-1">Page</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-text-muted text-sm mt-2">{intro}</p>
      </header>

      {error && (
        <div className="card" style={{ borderColor: 'var(--status-down)' }}>
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <aside className="space-y-3">
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded bg-surface text-sm"
          />
          <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
            {filtered.map((it) => (
              <li key={it.name}>
                <button
                  type="button"
                  onClick={() => setActive(it.name)}
                  className={[
                    'w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between gap-2',
                    active === it.name
                      ? 'bg-bg-muted border-l-2 border-aurora-cyan'
                      : 'hover:bg-bg-muted',
                  ].join(' ')}
                >
                  <span className="font-mono text-xs truncate">{it.name}</span>
                  {it.hasOverride && (
                    <span className="pip pip-healthy text-[10px]">edited</span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="text-xs text-text-dim px-3 py-2">No items match.</li>
            )}
          </ul>
        </aside>

        <section className="space-y-4">
          {!active && (
            <div className="card">
              <p className="text-sm text-text-muted">
                Select an item on the left to view or edit.
              </p>
            </div>
          )}
          {active && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold font-mono">{active}</h2>
                  <p className="text-xs text-text-dim mt-0.5">
                    source: <span className="font-mono">{source}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={save}
                    className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={() => setContent(original)}
                    className="btn disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Discard
                  </button>
                </div>
              </div>

              {savedMsg && (
                <div className="card text-sm" style={{ borderColor: 'var(--status-healthy)' }}>
                  {savedMsg}
                </div>
              )}

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-[55vh] p-3 border border-border rounded bg-surface font-mono text-xs leading-relaxed"
                spellCheck={false}
              />

              {backups.length > 0 && (
                <section className="card">
                  <h3 className="text-sm uppercase tracking-wider text-text-dim mb-3">
                    Backups ({backups.length})
                  </h3>
                  <ul className="space-y-2">
                    {backups.map((b) => (
                      <li key={b.filename} className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1 font-mono truncate">{b.filename}</div>
                        <div className="text-text-dim whitespace-nowrap">
                          {b.size}B · {new Date(b.mtimeMs).toLocaleString()}
                        </div>
                        <button
                          type="button"
                          onClick={() => restore(b.filename)}
                          className="btn text-xs"
                          disabled={saving}
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function PersonasPage() {
  return <OverrideEditor
    category="personas"
    title="Personas"
    intro="Edit Construct personas. Originals live in personas/; edits land at .cx/personas/, with prior content snapshotted to .cx/backups/personas/."
  />;
}

export function AgentsEditorPage() {
  return <OverrideEditor
    category="agents"
    title="Agent prompts"
    intro="Edit specialist agent prompts (cx-architect, cx-engineer, cx-product-manager, …). Originals in agents/prompts/; overrides at .cx/agents/, backups at .cx/backups/agents/."
  />;
}

export function SkillsEditorPage() {
  return <OverrideEditor
    category="skills"
    title="Skills"
    intro="Edit skill guidance. Originals live in skills/; edits land at .cx/skills/, with prior content snapshotted to .cx/backups/skills/. Custom skills go in .cx/skills/custom/."
  />;
}

export function RulesEditorPage() {
  return <OverrideEditor
    category="rules"
    title="Rules"
    intro="Edit shared rules. Originals live in rules/; edits land at .cx/rules/, with prior content snapshotted to .cx/backups/rules/."
  />;
}
