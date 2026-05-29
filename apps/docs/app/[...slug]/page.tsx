/**
 * Catch-all docs route. Maps every `docs/<...>/<name>.mdx` (and .md) under
 * the repo root to a corresponding URL and renders the file through
 * next-mdx-remote/rsc with the editorial shell + MDX shims for the
 * Fumadocs-era components those files were authored against.
 */

import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import {
  FlowPipeline, RequestFlow, SyncGrid, AgentGrid, DeployModes, Cards, Card, Steps, Step, Callout,
} from '@cx/ui';
import { listDocs, getDocBySlug } from '@/lib/docs-source';

const mdxComponents = {
  FlowPipeline,
  RequestFlow,
  SyncGrid,
  AgentGrid,
  DeployModes,
  Cards,
  Card,
  Steps,
  Step,
  Callout,
};

export const dynamicParams = false;

export function generateStaticParams() {
  return listDocs()
    .filter((d) => d.slug.length > 0)
    .map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) return { title: 'Not found' };
  return { title: doc.title, description: doc.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) notFound();

  const total = doc.body.split(/\s+/).length;
  const readMin = Math.max(1, Math.round(total / 220));

  return (
    <article className="page mdx-page">
      <div className="eyebrow">
        <span className="dot" />
        <span>section · {slug[0] ?? 'docs'}</span>
      </div>
      <h1 className="page-title">{doc.title}</h1>
      {doc.description && <p className="page-lede">{doc.description}</p>}
      <div className="meta-strip">
        <span className="pill">{readMin} min read</span>
        <span className="sep">·</span>
        <span>{slug.join(' / ')}</span>
      </div>
      <div className="body">
        <MDXRemote
          source={doc.body}
          components={mdxComponents}
          options={{
            mdxOptions: { remarkPlugins: [remarkGfm] },
            parseFrontmatter: false,
          }}
        />
      </div>
    </article>
  );
}
