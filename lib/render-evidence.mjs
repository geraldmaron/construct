/**
 * lib/render-evidence.mjs — Bridge from the render pipeline to the completion ledger.
 *
 * captureRenderEvidence renders an artifact to images under a stable .construct/render path and returns a
 * screenshot-captured evidence object. A successful render carries the image paths and a content
 * digest as proof and advances the ladder; a degraded render carries the typed degradation reason
 * so it is recorded for the trail but never lifts the state (highestState skips degraded entries).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { configPath } from './config-dir.mjs';
import { renderToImages } from './render-pipeline.mjs';
import { makeEvidence } from './artifact-completion.mjs';

export function renderEvidenceDir(rootDir, artifactName) {
  return configPath(rootDir ?? process.cwd(), 'render', artifactName);
}

// A digest over the rendered bytes lets a reader confirm the stored images are the ones the
// evidence claims; null when nothing was produced.

function digestImages(images) {
  if (!images.length) return null;
  const hash = crypto.createHash('sha256');
  for (const image of images) hash.update(fs.readFileSync(image));
  return `sha256:${hash.digest('hex')}`;
}

export function captureRenderEvidence({ format, inputPath, outDir, rootDir, actor = 'construct-render', env } = {}) {
  const artifactName = path.basename(inputPath ?? `artifact.${format}`);
  const dir = outDir ?? renderEvidenceDir(rootDir, artifactName);
  const result = renderToImages({ format, inputPath, outDir: dir, env });

  if (!result.ok) {
    return {
      result,
      evidence: makeEvidence('screenshot-captured', {
        actor,
        artifact: inputPath ?? null,
        degradation: result.degradation,
        proof: { format, message: result.message },
      }),
    };
  }

  return {
    result,
    evidence: makeEvidence('screenshot-captured', {
      actor,
      artifact: inputPath,
      digest: digestImages(result.images),
      proof: { format, images: result.images, count: result.images.length, dir },
    }),
  };
}
