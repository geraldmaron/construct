/**
 * lib/embed/snapshot.mjs — snapshot engine.
 *
 * Reads data from registered providers according to embed config sources,
 * then produces a structured snapshot: health summary, open items, risks,
 * and recommendations. Snapshots are plain objects that can be serialized
 * to markdown, JSON, or dispatched to output targets.
 */

export class SnapshotEngine {
  #registry = null;
  #config = null;

  /**
   * @param {ProviderRegistry} registry - Live provider registry
   * @param {object} config             - Normalized embed config
   */
  constructor(registry, config) {
    this.#registry = registry;
    this.#config = config;
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
          const result = await provider.read(ref);
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
