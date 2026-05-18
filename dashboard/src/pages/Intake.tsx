/**
 * dashboard/src/pages/Intake.tsx — define what the inbox watcher scans.
 *
 * The user picks parent directories to monitor and how deep to descend.
 * Depth is rendered as a slider with labelled stops so the meaning of
 * each value is obvious — 0 = only this dir, 1 = +immediate subdirs,
 * 4 = the default catch-all, 16 = effectively unlimited (capped).
 *
 * Backed by `.cx/intake-config.json` via GET/POST `/api/intake/config`.
 * Reads `CX_INBOX_DIRS` from process env on the server side so anything
 * a user already set via env shows up here as a read-only addition.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchIntakeConfig, writeIntakeConfig } from '../lib/api';
import SmallScreenNotice from '../components/SmallScreenNotice';
import DirectoryPicker from '../components/DirectoryPicker';

type Guidance = { value: number; label: string; detail: string };

type IntakeConfigData = {
  config: {
    parentDirs: string[];
    maxDepth: number;
    includeProjectInbox: boolean;
    includeDocsIntake: boolean;
  };
  rootDir: string;
  guidance: Guidance[];
  hardMaxDepth: number;
  defaults: { projectInbox: string; docsIntake: string };
};

export default function Intake() {
  const [data, setData] = useState<IntakeConfigData | null>(null);
  const [parentDirs, setParentDirs] = useState<string[]>([]);
  const [maxDepth, setMaxDepth] = useState<number>(4);
  const [includeProjectInbox, setIncludeProjectInbox] = useState(true);
  const [includeDocsIntake, setIncludeDocsIntake] = useState(true);
  const [newDir, setNewDir] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    fetchIntakeConfig()
      .then((d: IntakeConfigData) => {
        setData(d);
        setParentDirs(d.config.parentDirs ?? []);
        setMaxDepth(d.config.maxDepth ?? 4);
        setIncludeProjectInbox(d.config.includeProjectInbox !== false);
        setIncludeDocsIntake(d.config.includeDocsIntake !== false);
      })
      .catch((e) => setError(e.message || 'Failed to load intake config'));
  }, []);

  const depthDescription = useMemo<Guidance>(() => {
    const list = data?.guidance ?? [];
    return (
      list.find((g) => g.value === maxDepth) || {
        value: maxDepth,
        label: `Custom depth (${maxDepth})`,
        detail: `Walks up to ${maxDepth} levels of subdirectories below each parent.`,
      }
    );
  }, [data, maxDepth]);

  const addDir = () => {
    const trimmed = newDir.trim();
    if (!trimmed) return;
    if (parentDirs.includes(trimmed)) {
      setNewDir('');
      return;
    }
    setParentDirs([...parentDirs, trimmed]);
    setNewDir('');
  };

  const removeDir = (idx: number) => {
    setParentDirs(parentDirs.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await writeIntakeConfig({
        parentDirs,
        maxDepth,
        includeProjectInbox,
        includeDocsIntake,
      });
      setSavedAt(new Date().toISOString());
      if (res?.config) {
        setParentDirs(res.config.parentDirs ?? []);
        setMaxDepth(res.config.maxDepth ?? maxDepth);
      }
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-2">Intake</h1>
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <p className="text-sm text-text-dim">Loading intake configuration…</p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <SmallScreenNotice />
      <h1 className="text-xl font-bold mb-1">Intake</h1>
      <p className="text-sm text-text-muted mb-4">
        Pick the directories the inbox watcher monitors and how deep it
        descends. Files are ingested into <code className="px-1 bg-bg-muted rounded">.cx/knowledge/</code> and
        queued for triage at <code className="px-1 bg-bg-muted rounded">.cx/intake/pending/</code>.
      </p>
      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
      )}
      {savedAt && !error && (
        <div className="mb-3 px-3 py-2 rounded bg-green-50 border border-green-200 text-green-800 text-xs">
          Saved at {new Date(savedAt).toLocaleTimeString()}. The embed daemon picks this up on its next poll cycle.
        </div>
      )}

      <section className="card mb-4">
        <h2 className="text-xs uppercase tracking-wider text-text-dim mb-2">Built-in drop zones</h2>
        <p className="text-xs text-text-muted mb-3">
          Always-on locations relative to the project root. Disable a zone if
          you don't want construct to look there.
        </p>
        <label className="flex items-start gap-2 mb-2 text-sm">
          <input
            type="checkbox"
            checked={includeProjectInbox}
            onChange={(e) => setIncludeProjectInbox(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <code className="px-1 bg-bg-muted rounded">{data.defaults.projectInbox}</code>
            <span className="text-text-dim"> — drop folder created on demand. Recommended.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDocsIntake}
            onChange={(e) => setIncludeDocsIntake(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <code className="px-1 bg-bg-muted rounded">{data.defaults.docsIntake}</code>
            <span className="text-text-dim"> — picked up when the dir exists (created by <code>construct docs init</code>).</span>
          </span>
        </label>
      </section>

      <section className="card mb-4">
        <h2 className="text-xs uppercase tracking-wider text-text-dim mb-2">Parent directories</h2>
        <p className="text-xs text-text-muted mb-3">
          Absolute paths or relative to <code className="px-1 bg-bg-muted rounded">{data.rootDir}</code>.
          The watcher scans these in addition to the built-in zones above.
        </p>
        {parentDirs.length === 0 && (
          <p className="text-xs text-text-dim italic mb-3">No extra directories configured.</p>
        )}
        <ul className="mb-3 space-y-1">
          {parentDirs.map((dir, i) => (
            <li key={`${dir}-${i}`} className="flex items-center justify-between bg-bg-muted rounded px-2 py-1 text-sm">
              <code className="font-mono text-xs truncate">{dir}</code>
              <button
                onClick={() => removeDir(i)}
                className="text-xs text-red-700 hover:text-red-900 ml-2"
                aria-label={`Remove ${dir}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDir()}
            placeholder="/Users/you/Documents/intake  or  ../shared-notes"
            className="flex-1 min-w-[200px] px-2 py-1 text-sm border border-border rounded bg-bg"
          />
          <button onClick={() => setPickerOpen(true)} className="btn text-xs" aria-label="Browse for directory">
            Browse…
          </button>
          <button onClick={addDir} disabled={!newDir.trim()} className="btn btn-primary text-xs disabled:opacity-50">
            Add directory
          </button>
        </div>
        <p className="text-[11px] text-text-dim mt-2">
          Type a path manually (relative or absolute), or click <strong>Browse…</strong> to pick one from your filesystem.
          Browsing is gated to your home directory and the project root.
        </p>
      </section>

      {pickerOpen && (
        <DirectoryPicker
          initialPath={newDir.trim() || null}
          onClose={() => setPickerOpen(false)}
          onPick={(absPath) => {
            if (!parentDirs.includes(absPath)) {
              setParentDirs([...parentDirs, absPath]);
            }
            setPickerOpen(false);
          }}
        />
      )}

      <section className="card mb-4">
        <h2 className="text-xs uppercase tracking-wider text-text-dim mb-2">Subdirectory depth</h2>
        <p className="text-xs text-text-muted mb-3">
          How many levels of nested subdirectories the watcher walks below each
          parent. Higher values are slower on large trees.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <input
            type="range"
            min={0}
            max={data.hardMaxDepth}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            className="flex-1"
            aria-label="Maximum subdirectory depth"
          />
          <span className="font-mono text-sm w-8 text-right">{maxDepth}</span>
        </div>
        <div className="bg-bg-muted rounded px-3 py-2 text-xs">
          <p className="font-semibold">{depthDescription.label}</p>
          <p className="text-text-muted">{depthDescription.detail}</p>
        </div>
        <details className="mt-2">
          <summary className="text-xs text-text-dim cursor-pointer hover:text-text">
            Depth guide
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {data.guidance.map((g) => (
              <li key={g.value}>
                <span className="font-mono mr-2">{g.value}</span>
                <span className="font-semibold">{g.label}</span> — <span className="text-text-muted">{g.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <div className="flex gap-2 items-center">
        <button onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save intake configuration'}
        </button>
        <p className="text-xs text-text-dim">
          Backed by <code className="px-1 bg-bg-muted rounded">.cx/intake-config.json</code>.
        </p>
      </div>
    </div>
  );
}
