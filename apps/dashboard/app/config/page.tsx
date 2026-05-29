/** Config — view/edit ~/.construct/config.env + embed.yaml via /api/config. */
'use client';

import { useState, useEffect } from 'react';
import { Section, Callout, CodeBlock } from '@cx/ui';
import { Page, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchConfig, apiPost } from '@/lib/api';

type ConfigPayload = {
  env?: string;
  embed?: string;
  roles?: { primary?: string; secondary?: string };
};

export default function ConfigPage() {
  const { data, error, loading, reload } = useApi<ConfigPayload>(fetchConfig);
  const [env, setEnv] = useState('');
  const [embed, setEmbed] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data?.env != null) setEnv(data.env);
    if (data?.embed != null) setEmbed(data.embed);
  }, [data]);

  const save = async (type: 'env' | 'embed') => {
    setSaving(type);
    setMsg(null);
    try {
      await apiPost('/config', { type, content: type === 'env' ? env : embed });
      setMsg(`${type} saved`);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <Page
      eyebrow="system · config"
      title="Configuration"
      lede="Two managed files. config.env carries env-var defaults (model keys, ports, deployment mode). embed.yaml configures the embed daemon."
      meta={
        <>
          <span className="pill">primary role: {data?.roles?.primary ?? '—'}</span>
          <span className="pill">secondary: {data?.roles?.secondary ?? '—'}</span>
          {msg && <span className="pill" style={{ borderColor: 'var(--hue-b)' }}>{msg}</span>}
        </>
      }
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && (
        <>
          <Section num="01" title="~/.construct/config.env" defaultOpen tldr="Environment defaults. Keys overridden by shell env are not shown.">
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              rows={Math.min(20, (env.split('\n').length || 1) + 2)}
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
            <button className="btn primary" disabled={saving === 'env'} onClick={() => save('env')} style={{ marginTop: 12 }} type="button">
              {saving === 'env' ? 'Saving…' : 'Save config.env'}
            </button>
          </Section>

          <Section num="02" title="embed.yaml" tldr="Embed daemon configuration. Defines what to watch, where to ingest, and how to chunk.">
            <textarea
              value={embed}
              onChange={(e) => setEmbed(e.target.value)}
              rows={Math.min(20, (embed.split('\n').length || 1) + 2)}
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
            <button className="btn primary" disabled={saving === 'embed'} onClick={() => save('embed')} style={{ marginTop: 12 }} type="button">
              {saving === 'embed' ? 'Saving…' : 'Save embed.yaml'}
            </button>
          </Section>

          <Callout label="Heads up">
            <p>Saving here writes the file directly on disk. Restart <code>construct dev</code> for changes that affect service startup.</p>
          </Callout>
        </>
      )}
    </Page>
  );
}
