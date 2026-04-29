/**
 * lib/embed/snapshot.mjs — snapshot engine.
 *
 * Reads data from registered providers according to embed config sources,
 * then produces a structured snapshot: health summary, open items, risks,
 * and recommendations. Snapshots are plain objects that can be serialized
 * to markdown, JSON, or dispatched to output targets.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_OPERATING_PROFILE } from './config.mjs';

export class SnapshotEngine {
  #registry = null;
  #config = null;
  #rootDir = null;

  /**
   * @param {ProviderRegistry} registry - Live provider registry
   * @param {object} config             - Normalized embed config
   */
  constructor(registry, config, { rootDir = process.cwd() } = {}) {
    this.#registry = registry;
    this.#config = { ...config, operatingProfile: config.operatingProfile ?? DEFAULT_OPERATING_PROFILE };
    this.#rootDir = rootDir;
  }

  /**
   * Produce a full snapshot by polling all configured sources.
   * Returns a snapshot object.
   */
  async generate() {
    const startedAt = new Date().toISOString();
    const sections = [];
    const errors = [];

    for (const source of this.#config.sources ?? []) {
      const provider = this.#registry.get(source.provider);
      if (!provider) {
        errors.push({ source: source.provider, error: 'Provider not registered' });
        continue;
      }

      const items = [];
      for (const ref of source.refs) {
        try {
          const result = await provider.read(ref, source);
          items.push(...result.slice(0, this.#config.snapshot.maxItems));
        } catch (err) {
          errors.push({ source: source.provider, ref, error: err.message });
        }
      }

      sections.push({ provider: source.provider, refs: source.refs, items });
    }

    const snapshot = {
      generatedAt: startedAt,
      completedAt: new Date().toISOString(),
      sections,
      errors,
      operatingProfile: this.#config.operatingProfile ?? null,
      operatingGaps: buildOperatingGaps(this.#config, { rootDir: this.#rootDir, errors }),
      summary: buildSummary(sections, errors),
    };

    return snapshot;
  }
}

/**
 * Render a snapshot as markdown for file output or messaging.
 */
export function renderMarkdown(snapshot) {
  const lines = [
    `# Construct Snapshot`,
    `> Generated: ${snapshot.generatedAt}`,
    '',
  ];

  if (snapshot.errors.length) {
    lines.push('## ⚠️ Errors', '');
    for (const e of snapshot.errors) {
      lines.push(`- **${e.source}**${e.ref ? `/${e.ref}` : ''}: ${e.error}`);
    }
    lines.push('');
  }

  lines.push('## Summary', '');
  const s = snapshot.summary;
  lines.push(`- Sources polled: **${s.sourceCount}**`);
  lines.push(`- Total items: **${s.totalItems}**`);
  lines.push(`- Errors: **${s.errorCount}**`);
  lines.push('');

  if (snapshot.operatingProfile) {
    const profile = snapshot.operatingProfile;
    lines.push('## Operating Profile', '');
    lines.push(`- Mode: **${profile.mode ?? 'embed'}**`);
    lines.push(`- Posture: **${profile.strategy?.defaultPosture ?? 'assistive'}**`);
    lines.push(`- Autonomy: **${profile.strategy?.autonomy ?? 'read-first'}**`);
    lines.push(`- Write policy: **${profile.strategy?.writePolicy ?? 'approval-required-for-high-risk'}**`);
    lines.push('');
  }

  if (snapshot.operatingGaps?.length) {
    lines.push('## Operating Gaps', '');
    for (const gap of snapshot.operatingGaps) {
      lines.push(`- **${gap.severity}** ${gap.summary}`);
    }
    lines.push('');
  }

  for (const section of snapshot.sections) {
    if (!section.items.length) continue;
    lines.push(`## ${section.provider} (${section.items.length} items)`, '');
    for (const item of section.items.slice(0, 10)) {
      lines.push(`- ${formatItem(item)}`);
    }
    if (section.items.length > 10) {
      lines.push(`- _…and ${section.items.length - 10} more_`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildSummary(sections, errors) {
  return {
    sourceCount: sections.length,
    totalItems: sections.reduce((n, s) => n + s.items.length, 0),
    errorCount: errors.length,
  };
}

function buildOperatingGaps(config, { rootDir, errors }) {
  const gaps = [];
  if (!(config.sources ?? []).length) {
    gaps.push({ severity: 'blocked', kind: 'missing-sources', summary: 'No watched sources are configured, so embed mode has no external bearings.' });
  }
  if (!(config.outputs ?? []).length) {
    gaps.push({ severity: 'attention', kind: 'missing-outputs', summary: 'No snapshot outputs are configured; findings may not reach operators.' });
  }
  for (const resource of config.operatingProfile?.focalResources ?? []) {
    if (!resource.path) continue;
    if (!existsSync(resolve(rootDir, resource.path))) {
      gaps.push({ severity: 'blocked', kind: 'missing-focal-resource', summary: `Focal resource is missing: ${resource.path}` });
    }
  }
  if (errors?.length) {
    gaps.push({ severity: 'attention', kind: 'source-errors', summary: `${errors.length} configured source read failed.` });
  }
  return gaps;
}

function formatItem(item) {
  if (item.type === 'commit') return `\`${item.hash?.slice(0, 7)}\` ${item.subject} — ${item.author}`;
  if (item.type === 'issue') return `[${item.key}] ${item.summary} (${item.status})`;
  if (item.type === 'message') return `<${item.user}> ${item.text?.slice(0, 80)}`;
  if (item.type === 'page') return `${item.title} (${item.spaceKey ?? ''})`;
  if (item.summary) return item.summary;
  if (item.title) return item.title;
  if (item.text) return item.text.slice(0, 80);
  return JSON.stringify(item).slice(0, 80);
}
