/**
 * Home / overview — system health KPIs + recent approvals + service state.
 * Calls /api/status, /api/approvals, /api/mode, /api/embed/status for an
 * at-a-glance picture; deep-links into the dedicated pages for detail.
 */

'use client';

import Link from 'next/link';
import { Section, Callout } from '@cx/ui';
import { Page, CardGrid, StatCard, StatusPill, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import {
  fetchStatus, fetchApprovals, fetchMode, fetchEmbedStatus, fetchAuthStatus,
} from '@/lib/api';

type StatusPayload = {
  ok?: boolean;
  services?: Record<string, { status: string; url?: string }>;
  credentials?: Record<string, { status: string }>;
  skills?: { name: string }[];
  commands?: { name: string }[];
  [k: string]: unknown;
};

type ModePayload = { mode?: string; instanceId?: string; embedStatus?: string };
type EmbedPayload = { running?: boolean; lastTickAt?: number; backend?: string };
type ApprovalsPayload = { items?: { id: string; kind?: string; summary?: string; ts?: number }[] };

export default function HomePage() {
  const status = useApi<StatusPayload>(fetchStatus, 15000);
  const mode = useApi<ModePayload>(fetchMode, 30000);
  const embed = useApi<EmbedPayload>(fetchEmbedStatus, 15000);
  const approvals = useApi<ApprovalsPayload>(fetchApprovals, 10000);
  const auth = useApi(fetchAuthStatus);

  const services = status.data?.services ?? {};
  const credentials = status.data?.credentials ?? {};
  const approvalsList = approvals.data?.items ?? [];

  const skillCount = status.data?.skills?.length ?? 0;
  const commandCount = status.data?.commands?.length ?? 0;
  const serviceOk = Object.values(services).filter((s) => s.status === 'ok' || s.status === 'running').length;
  const serviceTotal = Object.keys(services).length;

  return (
    <Page
      eyebrow="overview · construct dashboard"
      title="System state"
      lede="The runtime in one place. Approvals, services, model providers, knowledge corpus, and intake — each section deep-links to its dedicated surface."
      meta={
        <>
          <span className="pill">mode: {mode.data?.mode ?? '…'}</span>
          <span>instance: {mode.data?.instanceId ?? '…'}</span>
          <span className="sep">·</span>
          <span>embed: {embed.data?.running ? 'running' : 'stopped'}</span>
          {auth.data && (
            <>
              <span className="sep">·</span>
              <span>auth: {(auth.data as { configured?: boolean }).configured ? 'enabled' : 'open'}</span>
            </>
          )}
        </>
      }
    >
      <CardGrid>
        <StatCard
          label="Services"
          value={status.loading ? '…' : `${serviceOk}/${serviceTotal}`}
          sub="running"
        />
        <StatCard
          label="Approvals"
          value={approvals.loading ? '…' : approvalsList.length}
          sub="pending"
        />
        <StatCard
          label="Skills"
          value={skillCount}
          sub="registered"
        />
        <StatCard
          label="Commands"
          value={commandCount}
          sub="slash"
        />
      </CardGrid>

      <Section
        num="01"
        title="Pending approvals"
        time={approvalsList.length === 0 ? 'empty' : `${approvalsList.length} item${approvalsList.length === 1 ? '' : 's'}`}
        tldr="Items waiting on a human gate. High-risk mutations (work item creation, merge, doc publish, config changes) land here."
        defaultOpen
      >
        {approvals.error && <EmptyState label="Failed to load" hint={approvals.error} />}
        {approvals.loading && !approvals.data && <Spinner />}
        {approvals.data && approvalsList.length === 0 && (
          <EmptyState label="All clear" hint="No approvals pending. Drop into /approvals when one arrives." />
        )}
        {approvalsList.length > 0 && (
          <>
            <DataTable
              columns={['When', 'Kind', 'Summary']}
              rows={approvalsList.slice(0, 5).map((a) => [
                a.ts ? new Date(a.ts).toLocaleString() : '—',
                a.kind ?? '—',
                a.summary ?? `id: ${a.id}`,
              ])}
            />
            <p style={{ marginTop: 12 }}>
              <Link href="/approvals" className="link">Open full approval queue →</Link>
            </p>
          </>
        )}
      </Section>

      <Section
        num="02"
        title="Services"
        time={`${serviceOk}/${serviceTotal} running`}
        tldr="Local processes that back the runtime: Postgres, memory bridge, OpenCode bridge, dashboard, embed daemon."
      >
        {status.error && <EmptyState label="Failed to load /api/status" hint={status.error} />}
        {status.loading && !status.data && <Spinner />}
        {Object.keys(services).length > 0 && (
          <DataTable
            columns={['Service', 'Status', 'URL']}
            rows={Object.entries(services).map(([name, info]) => [
              <code key="n">{name}</code>,
              <StatusPill key="s"
                status={info.status === 'ok' || info.status === 'running' ? 'ok' : info.status === 'degraded' ? 'warn' : 'err'}
                label={info.status}
              />,
              info.url ? <a key="u" href={info.url} target="_blank" rel="noreferrer" className="link">{info.url}</a> : '—',
            ])}
          />
        )}
        <p style={{ marginTop: 12 }}>
          <Link href="/resources" className="link">Open services dashboard →</Link>
        </p>
      </Section>

      <Section
        num="03"
        title="Credentials"
        time={Object.keys(credentials).length + ' tracked'}
        tldr="Provider API keys, billing posture, and 1Password references. Set them in /providers."
      >
        {Object.keys(credentials).length > 0 && (
          <DataTable
            columns={['Provider', 'Status']}
            rows={Object.entries(credentials).map(([name, info]) => [
              <code key="n">{name}</code>,
              <StatusPill key="s"
                status={info.status === 'set' || info.status === 'full' ? 'ok' : info.status === 'partial' ? 'warn' : info.status === 'unhealthy' ? 'err' : 'idle'}
                label={info.status}
              />,
            ])}
          />
        )}
        <p style={{ marginTop: 12 }}>
          <Link href="/providers" className="link">Manage providers →</Link>
        </p>
      </Section>

      <Section
        num="04"
        title="Quick links"
        tldr="Deep links into every dashboard surface."
      >
        <Callout label="Where to next">
          <p>
            <Link className="link" href="/doctor">Doctor</Link>,{' '}
            <Link className="link" href="/knowledge">Knowledge</Link>,{' '}
            <Link className="link" href="/intake">Intake</Link>,{' '}
            <Link className="link" href="/workflow">Workflow</Link>,{' '}
            <Link className="link" href="/agents">Specialists</Link>,{' '}
            <Link className="link" href="/models">Models</Link>,{' '}
            <Link className="link" href="/audit">Audit</Link>.
          </p>
        </Callout>
      </Section>
    </Page>
  );
}
