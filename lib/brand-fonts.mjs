/**
 * lib/brand-fonts.mjs — bundled Plus Jakarta Sans / JetBrains Mono paths and PPTX font embedding.
 *
 * PDF/Typst reads TTF from templates/distribution/fonts/. HTML/deck templates load
 * the same families from Google Fonts. PPTX uses pptx-embed-fonts when available so
 * PowerPoint renders the bundled faces without a local install. Plus Jakarta Sans
 * ships as discrete weight cuts; JetBrains Mono as discrete cuts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BRAND_TOKENS } from './brand-tokens.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BRAND_SANS_FAMILY = BRAND_TOKENS.typography.fontSans;
export const BRAND_MONO_FAMILY = BRAND_TOKENS.typography.fontMono;

export const BUNDLED_SANS_FILES = Object.freeze([
  'PlusJakartaSans-Regular.ttf',
  'PlusJakartaSans-Medium.ttf',
  'PlusJakartaSans-SemiBold.ttf',
  'PlusJakartaSans-Bold.ttf',
]);

export const BUNDLED_MONO_FILES = Object.freeze([
  'JetBrainsMono-Regular.ttf',
  'JetBrainsMono-Medium.ttf',
  'JetBrainsMono-SemiBold.ttf',
]);

export function distributionFontsDir(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'templates', 'distribution', 'fonts');
}

export function bundledSansFontPaths(repoRoot = REPO_ROOT) {
  const dir = distributionFontsDir(repoRoot);
  return BUNDLED_SANS_FILES.map((file) => path.join(dir, file)).filter((p) => fs.existsSync(p));
}

export function bundledMonoFontPaths(repoRoot = REPO_ROOT) {
  const dir = distributionFontsDir(repoRoot);
  return BUNDLED_MONO_FILES.map((file) => path.join(dir, file)).filter((p) => fs.existsSync(p));
}

export function createPptxGenerator() {
  const PptxGenJS = require('pptxgenjs');
  try {
    const { withPPTXEmbedFonts } = require('pptx-embed-fonts/pptxgenjs');
    return { PptxClass: withPPTXEmbedFonts(PptxGenJS), embedFonts: true };
  } catch {
    return { PptxClass: PptxGenJS, embedFonts: false };
  }
}

async function embedFamilyInPptx(pptx, family, paths) {
  let count = 0;
  for (const fontPath of paths) {
    const buf = fs.readFileSync(fontPath);
    await pptx.addFont({
      fontFace: family,
      fontFile: buf,
      fontType: 'ttf',
    });
    count += 1;
  }
  return count;
}

export async function embedBundledSansInPptx(pptx, repoRoot = REPO_ROOT) {
  if (typeof pptx?.addFont !== 'function') return { embedded: false, count: 0 };
  const count = await embedFamilyInPptx(pptx, BRAND_SANS_FAMILY, bundledSansFontPaths(repoRoot));
  return { embedded: count > 0, count };
}

export async function embedBundledMonoInPptx(pptx, repoRoot = REPO_ROOT) {
  if (typeof pptx?.addFont !== 'function') return { embedded: false, count: 0 };
  const count = await embedFamilyInPptx(pptx, BRAND_MONO_FAMILY, bundledMonoFontPaths(repoRoot));
  return { embedded: count > 0, count };
}

export async function embedBundledFontsInPptx(pptx, repoRoot = REPO_ROOT) {
  const sans = await embedBundledSansInPptx(pptx, repoRoot);
  const mono = await embedBundledMonoInPptx(pptx, repoRoot);
  return {
    embedded: sans.embedded || mono.embedded,
    sansCount: sans.count,
    monoCount: mono.count,
  };
}

export function googleFontsSansHref() {
  return 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
}

export function pdfUsesBundledBrandSans(pdfPath) {
  try {
    const text = fs.readFileSync(pdfPath).toString('latin1');
    return /PlusJakartaSans|Plus Jakarta Sans|JetBrainsMono|JetBrains Mono/.test(text);
  } catch {
    return false;
  }
}
