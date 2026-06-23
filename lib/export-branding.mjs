/**
 * lib/export-branding.mjs — one honest branding contract for distribution exports.
 */

import { BRAND_CAPABLE_FORMATS, PLAIN_OUTPUT_FORMATS } from './artifact-manifest.mjs';

export const EXPORT_BRANDING_CAPABILITIES = Object.freeze({
  pdf: { capable: true, mechanism: 'typst-template', asset: 'construct-pdf.typ' },
  html: { capable: true, mechanism: 'pandoc-template', asset: 'construct-web.html' },
  deck: { capable: true, mechanism: 'pandoc-template', asset: 'construct-deck.html' },
  pptx: { capable: true, mechanism: 'native-pptx', asset: 'pptxgenjs' },
  docx: { capable: true, mechanism: 'reference-doc', asset: 'construct-reference.docx' },
  doc: { capable: true, mechanism: 'docx-reference-via-libreoffice', asset: 'construct-reference.docx' },
  rtf: { capable: true, mechanism: 'pandoc-writer', asset: null },
  odt: { capable: true, mechanism: 'pandoc-writer', asset: null },
  epub: { capable: true, mechanism: 'pandoc-writer', asset: null },
  tex: { capable: true, mechanism: 'pandoc-writer', asset: null },
  txt: { capable: false, mechanism: 'plain-source', asset: null },
  md: { capable: false, mechanism: 'plain-source', asset: null },
  mdx: { capable: false, mechanism: 'plain-source', asset: null },
});

export function resolveExportBranding(format, requested = 'construct') {
  const capability = EXPORT_BRANDING_CAPABILITIES[format];
  if (!capability) return { requested, applied: 'none', capable: false, reason: 'unsupported format' };
  if (!BRAND_CAPABLE_FORMATS.includes(format) || PLAIN_OUTPUT_FORMATS.includes(format)) {
    return { requested, applied: 'none', capable: false, reason: 'format has no styling surface' };
  }
  if (requested === 'plain') return { requested, applied: 'plain', capable: true, mechanism: capability.mechanism, reason: 'explicit opt-out' };
  return { requested: 'construct', applied: 'construct', capable: true, mechanism: capability.mechanism, asset: capability.asset, reason: 'default policy' };
}

