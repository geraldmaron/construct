#!/usr/bin/env node
/**
 * scripts/build-extraction-ladder-fixtures.mjs — write the smallest valid
 * sample files the extraction-ladder probe run needs, one per filetype under
 * test: fixtures/extraction-ladder/samples/probe.{pdf,docx,xlsx,pptx,png,svg}.
 *
 * These are deterministic, hand-built minimal packages, not copies pulled
 * from some other document — a PDF with one page and one text run, an OOXML
 * zip with only the parts each format requires to open, a 1x1 PNG, a 1x1 SVG.
 * Deterministic so a re-run produces byte-identical output and a diff in this
 * script is the only way the fixtures change.
 *
 * Run once; the output is committed. scripts/probe-extraction-ladder.mjs
 * reads these same files to record what the ladder actually does with them.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'fixtures', 'extraction-ladder', 'samples');

// ---- minimal PDF -----------------------------------------------------

function buildPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    (() => {
      const stream = 'BT /F1 18 Tf 10 40 Td (probe) Tj ET';
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    })(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ---- minimal store-only ZIP (no compression, no external deps) ------

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function dosDateTime() {
  // Fixed timestamp so the archive is byte-identical on every rebuild.
  return { time: 0, date: 0x21 };
}

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, dataBuf);

    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4); // version made by
    centralEntry.writeUInt16LE(20, 6); // version needed
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(time, 12);
    centralEntry.writeUInt16LE(date, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(dataBuf.length, 20);
    centralEntry.writeUInt32LE(dataBuf.length, 24);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt16LE(0, 30); // extra
    centralEntry.writeUInt16LE(0, 32); // comment
    centralEntry.writeUInt16LE(0, 34); // disk number
    centralEntry.writeUInt16LE(0, 36); // internal attrs
    centralEntry.writeUInt32LE(0, 38); // external attrs
    centralEntry.writeUInt32LE(offset, 42);

    central.push(centralEntry, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function buildDocx() {
  return buildZip([
    {
      name: '[Content_Types].xml',
      content:
        XML_HEADER +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      content:
        XML_HEADER +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>probe</w:t></w:r></w:p></w:body></w:document>',
    },
  ]);
}

function buildXlsx() {
  return buildZip([
    {
      name: '[Content_Types].xml',
      content:
        XML_HEADER +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      content:
        XML_HEADER +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        XML_HEADER +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>probe</t></is></c></row></sheetData></worksheet>',
    },
  ]);
}

function buildPptx() {
  return buildZip([
    {
      name: '[Content_Types].xml',
      content:
        XML_HEADER +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'ppt/presentation.xml',
      content:
        XML_HEADER +
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      content:
        XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'ppt/slides/slide1.xml',
      content:
        XML_HEADER +
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr/></p:spTree></p:cSld></p:sld>',
    },
  ]);
}

// Smallest valid PNG: 1x1, single transparent pixel, no ancillary chunks.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function buildSvg() {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>\n',
    'utf8',
  );
}

const SAMPLES = {
  'probe.pdf': buildPdf(),
  'probe.docx': buildDocx(),
  'probe.xlsx': buildXlsx(),
  'probe.pptx': buildPptx(),
  'probe.png': Buffer.from(PNG_BASE64, 'base64'),
  'probe.svg': buildSvg(),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, buf] of Object.entries(SAMPLES)) {
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}
