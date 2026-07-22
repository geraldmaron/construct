/**
 * lib/providers/document-export-providers.mjs — Provider-Card-mediated
 * identity, version resolution, and spawn wrapper for Pandoc and Typst
 * (construct-tsyfe.6.5).
 *
 * lib/document-export.mjs's exportMarkdown() drives every typeset export
 * format (pdf/docx/doc/deck/html/rtf/odt/epub/tex/txt) through a single
 * spawn of `config.engine`, which resolves to 'pandoc' for every entry in
 * lib/registry/manifests/format-engines.default.json. Typst is never
 * spawned directly by Construct — for the pdf format, pandoc invokes it
 * internally via `--pdf-engine=typst`, confirmed by reading exportMarkdown()
 * end to end; no `spawnSync('typst', ...)` call exists anywhere in the
 * export path. The single spawn call site gets a Provider Card identity
 * (registry/provider-cards.json's 'pandoc' and 'typst' binary cards) in
 * place of an ad hoc bare-string spawnSync. Typst gets the same queryable
 * identity shape despite never being spawned directly, since detect() still
 * checks its presence as a pdf-format `extraBinaries` entry.
 *
 * detect()/installHint() in lib/document-export.mjs keep their existing
 * behavior: missing-binary degradation for every export binary (pandoc,
 * typst, d2, mmdc, libreoffice, unzip) stays generic there, not duplicated
 * here. installHint() reads the pandoc/typst card via findProviderCard()
 * first, falling back to its original literal string if the card can't be
 * loaded, single-sourcing the install-hint text in
 * registry/provider-cards.json's fallback.description field rather than
 * only in code.
 */

import { spawnSync } from 'node:child_process';
import { findProviderCard } from './provider-card.mjs';

export const PANDOC_PROVIDER_ID = 'pandoc';
export const TYPST_PROVIDER_ID = 'typst';

function whichBin(name, env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  const first = (result.stdout || '').trim().split('\n')[0];
  return first || null;
}

/**
 * Query a document-export Provider Card for its resolved binary path,
 * version string, and install hint in `env` — independent of
 * lib/document-export.mjs's detect()/installHint(), but built from the same
 * primitives (`which`/`where` plus the card's `subprocess-version`
 * healthCheck command) so the two report identically for the same
 * environment (construct-tsyfe.6.5 acceptance criterion 1).
 */
export function resolveDocumentExportProvider(providerId, env = process.env) {
  const card = findProviderCard(providerId);
  const path = whichBin(providerId, env);
  let version = null;
  if (path && card?.healthCheck?.kind === 'subprocess-version') {
    const { command = providerId, args = ['--version'] } = card.healthCheck;
    const r = spawnSync(command, args, { encoding: 'utf8', env });
    version = r.status === 0 ? ((r.stdout || '').trim().split('\n')[0] || null) : null;
  }
  return {
    id: providerId,
    card,
    path,
    version,
    installHint: card?.fallback?.description ?? null,
  };
}

/**
 * Spawn `providerId`'s binary with `args`/`env`/`cwd`, resolving its
 * Provider Card first so the invocation is attributable to a named,
 * schema-validated identity rather than a bare string. Behavior is
 * unchanged from the direct spawnSync call this replaces in
 * lib/document-export.mjs: same command, same args, same options; a
 * missing card does not block the spawn (detect() already gated presence
 * before this point — no new failure mode is introduced here).
 */
export function spawnDocumentExportProvider(providerId, args, { env = process.env, cwd, spawnFn = spawnSync } = {}) {
  const card = findProviderCard(providerId);
  return { result: spawnFn(providerId, args, { encoding: 'utf8', env, cwd }), card };
}
