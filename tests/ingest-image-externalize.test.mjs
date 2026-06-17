/**
 * tests/ingest-image-externalize.test.mjs — embedded-image externalization.
 *
 * docling embeds figures as base64 data: URIs in its markdown (with image
 * generation enabled in the sidecar). externalizeEmbeddedImages must write each
 * to an assets/ directory beside the output markdown and rewrite the reference to
 * a relative path — so ingest produces real image files and ![]() links instead
 * of the bare placeholder docling emits by default.
 */
import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { externalizeEmbeddedImages } from "../lib/document-ingest.mjs";

// 1x1 transparent PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("externalizes a base64 data URI into assets/ and rewrites the reference", () => {
  const dir = mkdtempSync(join(tmpdir(), "img-ext-"));
  try {
    const mdPath = join(dir, "report.docx.md");
    const md = `# Report\n\nIntro.\n\n![diagram](data:image/png;base64,${PNG_B64})\n\nEnd.\n`;
    const { markdown, assets } = externalizeEmbeddedImages(md, { mdPath });

    assert.equal(assets.length, 1, "one image written");
    assert.ok(existsSync(assets[0]), "image file exists on disk");
    assert.ok(readFileSync(assets[0]).length > 0, "image file has bytes");
    assert.match(markdown, /!\[diagram\]\(assets\/report\.docx\/image-1\.png\)/, "ref rewritten to relative asset path");
    assert.doesNotMatch(markdown, /data:image/, "no base64 left inline");

    const assetsDir = join(dir, "assets", "report.docx");
    assert.deepEqual(readdirSync(assetsDir), ["image-1.png"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multiple images get distinct files; jpeg maps to .jpg", () => {
  const dir = mkdtempSync(join(tmpdir(), "img-ext-"));
  try {
    const mdPath = join(dir, "doc.pdf.md");
    const md = `![a](data:image/png;base64,${PNG_B64})\n![b](data:image/jpeg;base64,${PNG_B64})\n`;
    const { markdown, assets } = externalizeEmbeddedImages(md, { mdPath });
    assert.equal(assets.length, 2);
    assert.match(markdown, /image-1\.png/);
    assert.match(markdown, /image-2\.jpg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("markdown without embedded images is returned unchanged, no assets dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "img-ext-"));
  try {
    const mdPath = join(dir, "plain.md");
    const md = "# Plain\n\nNo images here.\n";
    const { markdown, assets } = externalizeEmbeddedImages(md, { mdPath });
    assert.equal(markdown, md);
    assert.equal(assets.length, 0);
    assert.equal(existsSync(join(dir, "assets")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
