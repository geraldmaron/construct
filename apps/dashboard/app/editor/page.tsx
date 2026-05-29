/** Editor — read+write any override via /api/overrides/<category>/<name>. */
'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import {
  fetchOverrideList, fetchOverrideContent, fetchOverrideBackups,
  writeOverrideContent, restoreOverrideBackup,
} from '@/lib/api';

const CATEGORIES = ['agents', 'contracts', 'role-manifests'] as const;

type Category = typeof CATEGORIES[number];

type OverrideContent = { category?: string; name?: string; source?: string; content?: string; path?: string };
type OverrideBackups = { backups?: { filename: string; mtimeMs: number; size: number }[] };

export default function EditorPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <EditorInner />
    </Suspense>
  );
}

function EditorInner() {
  const params = useSearchParams();
  const router = useRouter();
  const category = (params.get('category') as Category) || 'agents';
  const name = params.get('name') || '';

  const list = useApi(() => fetchOverrideList(category), undefined);
  const content = useApi<OverrideContent>(() => (name ? fetchOverrideContent(category, name) : Promise.resolve({} as OverrideContent)));
  const backups = useApi<OverrideBackups>(() => (name ? fetchOverrideBackups(category, name) : Promise.resolve({ backups: [] } as OverrideBackups)));

  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (content.data?.content != null) setBody(content.data.content); }, [content.data]);

  const save = async () => {
    if (!name) return;
    setSaving(true);
    setMsg(null);
    try {
      await writeOverrideContent(category, name, body);
      setMsg('saved');
      backups.reload();
      content.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const restore = async (filename: string) => {
    if (!name) return;
    if (!confirm(`Restore ${filename}? Current content will be backed up first.`)) return;
    try {
      await restoreOverrideBackup(category, name, filename);
      content.reload();
      backups.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Page
      eyebrow="knowledge · editor"
      title="Override editor"
      lede="Edit specialist prompts, contracts, or role manifests. Every save auto-creates a timestamped backup; restore from history is one click."
      meta={
        <>
          <select
            value={category}
            onChange={(e) => router.push(`/editor?category=${e.target.value}&name=${name}`)}
            style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--hairline)', padding: '3px 8px', borderRadius: 6, fontSize: 11.5 }}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {msg && <span className="pill">{msg}</span>}
        </>
      }
    >
      <Section num="01" title="Items" defaultOpen={!name}>
        {list.loading && !list.data && <Spinner />}
        {list.error && <EmptyState label="Failed to load" hint={list.error} />}
        {list.data && (
          <DataTable
            columns={['Name', 'Status', '']}
            rows={((list.data as { items?: { name: string; hasOverride?: boolean }[] }).items ?? []).map((it) => [
              <code key="n">{it.name}</code>,
              it.hasOverride ? 'overridden' : 'default',
              <button key="o" className="btn" onClick={() => router.push(`/editor?category=${category}&name=${encodeURIComponent(it.name)}`)} type="button">open</button>,
            ])}
          />
        )}
      </Section>

      {name && (
        <Section num="02" title={`Editing ${name}`} defaultOpen tldr={content.data?.path}>
          {content.loading && !content.data && <Spinner />}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={28}
            style={{
              width: '100%',
              background: 'var(--code-bg)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              padding: 12,
              fontFamily: 'var(--mono)',
              fontSize: 12.5,
              lineHeight: 1.6,
              resize: 'vertical',
            }}
          />
          <button className="btn primary" disabled={saving} onClick={save} style={{ marginTop: 12 }} type="button">
            {saving ? 'Saving…' : 'Save override'}
          </button>
        </Section>
      )}

      {name && (
        <Section num="03" title="Backups" tldr="Every save auto-creates a timestamped backup.">
          {backups.data?.backups && backups.data.backups.length > 0 ? (
            <DataTable
              columns={['Filename', 'When', 'Size', '']}
              rows={backups.data.backups.map((b) => [
                <code key="f" style={{ fontSize: 11 }}>{b.filename}</code>,
                new Date(b.mtimeMs).toLocaleString(),
                `${(b.size / 1024).toFixed(1)} KB`,
                <button key="r" className="btn" onClick={() => restore(b.filename)} type="button">restore</button>,
              ])}
            />
          ) : (
            <Callout label="No backups yet"><p>The first save here will create one.</p></Callout>
          )}
        </Section>
      )}
    </Page>
  );
}
