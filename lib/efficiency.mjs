/**
 * lib/efficiency.mjs — session read-efficiency reporting.
 *
 * Reads ~/.cx/session-efficiency.json, summarizes repeated/large reads, and
 * formats actionable recommendations for the construct efficiency command.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HIGH_BYTES_THRESHOLD = 750_000;
const HIGH_REPEATED_RATIO = 0.4;
const HIGH_LARGE_READ_COUNT = 3;

export function readEfficiencyLog(homeDir) {
  const filePath = join(homeDir, '.cx', 'session-efficiency.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function topRepeatedFiles(files = {}) {
  return Object.entries(files)
    .map(([filePath, value]) => ({
      path: filePath,
      count: Number(value?.count || 0),
      size: Number(value?.size || 0),
      lastReadAt: value?.lastReadAt || null,
    }))
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count || b.size - a.size || a.path.localeCompare(b.path))
    .slice(0, 10);
}

export function summarizeEfficiencyData(stats) {
  if (!stats) {
    return {
      status: 'unavailable',
      summary: 'No read-efficiency data recorded yet',
      recommendation: 'Continue. Efficiency tracking will appear after file reads.',
      readCount: 0,
      uniqueFileCount: 0,
      repeatedReadCount: 0,
      largeReadCount: 0,
      totalBytesRead: 0,
      repeatedReadRatio: 0,
      topRepeatedFiles: [],
      lastUpdatedAt: null,
    };
  }

  const readCount = Number(stats.readCount || 0);
  const uniqueFileCount = Number(stats.uniqueFileCount || 0);
  const repeatedReadCount = Number(stats.repeatedReadCount || 0);
  const largeReadCount = Number(stats.largeReadCount || 0);
  const totalBytesRead = Number(stats.totalBytesRead || 0);
  const repeatedReadRatio = readCount > 0 ? Number((repeatedReadCount / readCount).toFixed(3)) : 0;
  const repeatedFiles = topRepeatedFiles(stats.files);

  let status = 'healthy';
  let recommendation = 'Continue. Read pattern is compact enough for the current session.';
  if (totalBytesRead >= HIGH_BYTES_THRESHOLD) {
    status = 'degraded';
    recommendation = 'Run construct distill with a focused query, then compact context before more broad exploration.';
  } else if (repeatedReadRatio >= HIGH_REPEATED_RATIO || repeatedReadCount >= 5) {
    status = 'degraded';
    recommendation = 'Use rg to narrow the next file set, or run construct distill instead of re-reading the same files.';
  } else if (largeReadCount >= HIGH_LARGE_READ_COUNT) {
    status = 'configured';
    recommendation = 'Prefer targeted reads under 400 lines before another large read.';
  }

  const summary = [
    `${readCount} reads`,
    `${uniqueFileCount} files`,
    repeatedReadCount ? `${repeatedReadCount} repeated` : null,
    largeReadCount ? `${largeReadCount} large` : null,
    totalBytesRead ? `${Math.round(totalBytesRead / 1024)} KB` : null,
  ].filter(Boolean).join(' · ');

  return {
    status,
    summary,
    recommendation,
    readCount,
    uniqueFileCount,
    repeatedReadCount,
    largeReadCount,
    totalBytesRead,
    repeatedReadRatio,
    topRepeatedFiles: repeatedFiles,
    lastUpdatedAt: stats.lastUpdatedAt || null,
  };
}

export function buildCompactEfficiencyDigest(stats) {
  const data = summarizeEfficiencyData(stats);
  const repeated = data.topRepeatedFiles.slice(0, 3).map((file) => `${file.count}x ${file.path}`).join(' · ');

  return {
    ...data,
    repeated,
    compact: data.status === 'unavailable'
      ? data.summary
      : repeated
        ? `${data.summary} · ${data.recommendation} · Hot spots: ${repeated}`
        : `${data.summary} · ${data.recommendation}`,
  };
}

export function formatEfficiencyReport(data, colors = {}) {
  const C = { bold: '', dim: '', reset: '', green: '', yellow: '', red: '', ...colors };
  const statusColor = data.status === 'healthy' ? C.green : data.status === 'configured' ? C.yellow : data.status === 'degraded' ? C.red : '';
  const lines = [];
  lines.push(`${C.bold}Construct Efficiency Report${C.reset}`);
  lines.push('═══════════════════════════');
  lines.push('');
  lines.push(`Status:          ${statusColor}${data.status}${C.reset}`);
  lines.push(`Reads:           ${data.readCount.toLocaleString()} (${data.uniqueFileCount.toLocaleString()} unique files)`);
  lines.push(`Repeated reads:  ${data.repeatedReadCount.toLocaleString()} (${(data.repeatedReadRatio * 100).toFixed(1)}%)`);
  lines.push(`Large reads:     ${data.largeReadCount.toLocaleString()}`);
  lines.push(`Bytes read:      ${Math.round(data.totalBytesRead / 1024).toLocaleString()} KB`);
  if (data.lastUpdatedAt) lines.push(`${C.dim}Last updated: ${data.lastUpdatedAt}${C.reset}`);
  lines.push('');
  lines.push(`Recommendation:  ${data.recommendation}`);

  if (data.topRepeatedFiles.length > 0) {
    lines.push('');
    lines.push('Top Repeated Files:');
    for (const file of data.topRepeatedFiles) {
      lines.push(`  ${String(file.count).padStart(3)}x  ${file.path}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
