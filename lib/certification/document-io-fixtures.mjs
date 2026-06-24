/**
 * lib/certification/document-io-fixtures.mjs — intake fixture catalog for document I/O tests.
 *
 * Maps docs/guides/reference/document-io.md supported intake categories to committed
 * files under tests/fixtures/document-io/<category>/.
 */

import fs from 'node:fs';
import path from 'node:path';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export const DOCUMENT_IO_CATEGORIES = Object.freeze([
  {
    id: 'plain-text',
    label: 'Plain text / code',
    extensions: ['.md', '.txt', '.json', '.yaml', '.csv', '.html', '.xml'],
    files: ['sample.md', 'sample.txt', 'sample.json', 'sample.yaml', 'sample.csv', 'sample.html', 'sample.xml'],
  },
  {
    id: 'transcripts',
    label: 'Transcripts',
    extensions: ['.vtt', '.srt', '.lrc'],
    files: ['sample.vtt', 'sample.srt', 'sample.lrc'],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    extensions: ['.ics'],
    files: ['sample.ics'],
  },
  {
    id: 'email',
    label: 'Email',
    extensions: ['.eml', '.msg'],
    files: ['sample.eml', 'sample.msg'],
  },
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    files: ['sample.pdf'],
  },
  {
    id: 'word',
    label: 'Word',
    extensions: ['.docx', '.doc'],
    files: ['sample.docx', 'sample.doc'],
  },
  {
    id: 'excel',
    label: 'Excel',
    extensions: ['.xlsx', '.xls', '.ods'],
    files: ['sample.xlsx', 'sample.xls', 'sample.ods'],
  },
  {
    id: 'powerpoint',
    label: 'PowerPoint',
    extensions: ['.pptx', '.ppt'],
    files: ['sample.pptx', 'sample.ppt'],
  },
  {
    id: 'rich-text',
    label: 'Rich text',
    extensions: ['.rtf'],
    files: ['sample.rtf'],
  },
  {
    id: 'apple-iwork',
    label: 'Apple iWork',
    extensions: ['.pages', '.numbers', '.key'],
    files: ['sample.pages', 'sample.numbers', 'sample.key'],
  },
  {
    id: 'audio-video',
    label: 'Audio/video',
    extensions: ['.mp3', '.wav', '.mp4', '.mov'],
    files: ['sample.mp3', 'sample.wav', 'sample.mp4', 'sample.mov'],
  },
  {
    id: 'unsupported',
    label: 'Unsupported (negative)',
    extensions: ['.xyz'],
    files: ['sample.xyz'],
    negative: true,
  },
]);

export function documentIoFixtureRoot(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'fixtures', 'document-io');
}

export function documentIoFixturePath(categoryId, fileName, { rootDir } = {}) {
  return path.join(documentIoFixtureRoot(rootDir), categoryId, fileName);
}

export function validateDocumentIoFixtures({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const errors = [];
  for (const category of DOCUMENT_IO_CATEGORIES) {
    for (const file of category.files) {
      const abs = documentIoFixturePath(category.id, file, { rootDir: root });
      if (!fs.existsSync(abs)) errors.push(`missing fixture: tests/fixtures/document-io/${category.id}/${file}`);
    }
  }
  return {
    categoryCount: DOCUMENT_IO_CATEGORIES.length,
    errors,
    pass: errors.length === 0,
  };
}

export function writeDocumentIoFixtures({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const base = documentIoFixtureRoot(root);

  const samples = {
    'plain-text/sample.md': '# Fixture\n\nDocument I/O plain-text sample.\n',
    'plain-text/sample.txt': 'Document I/O plain-text fixture.\n',
    'plain-text/sample.json': '{"fixture": "document-io", "category": "plain-text"}\n',
    'plain-text/sample.yaml': 'fixture: document-io\ncategory: plain-text\n',
    'plain-text/sample.csv': 'name,value\nfixture,1\n',
    'plain-text/sample.html': '<!doctype html><html><body><p>Document I/O fixture</p></body></html>\n',
    'plain-text/sample.xml': '<?xml version="1.0"?><fixture category="plain-text">document-io</fixture>\n',
    'transcripts/sample.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nDocument I/O transcript fixture.\n',
    'transcripts/sample.srt': '1\n00:00:00,000 --> 00:00:02,000\nDocument I/O transcript fixture.\n',
    'transcripts/sample.lrc': '[00:00.00]Document I/O transcript fixture.\n',
    'calendar/sample.ics': [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:fixture-document-io@construct',
      'DTSTART:20260622T120000Z',
      'SUMMARY:Document I/O calendar fixture',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\n'),
    'email/sample.eml': [
      'From: fixture@construct.test',
      'To: intake@construct.test',
      'Subject: Document I/O email fixture',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Email body for document-io fixture.',
      '',
    ].join('\n'),
    'email/sample.msg': 'MSG fixture stub — binary Outlook format not generated in tests.\n',
    'pdf/sample.pdf': '%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
    'word/sample.doc': 'DOC fixture stub for docling-only legacy format.\n',
    'rich-text/sample.rtf': '{\\rtf1\\ansi Document I/O RTF fixture.}\n',
    'apple-iwork/sample.pages': 'iWork pages fixture stub for docling path.\n',
    'apple-iwork/sample.numbers': 'iWork numbers fixture stub for docling path.\n',
    'apple-iwork/sample.key': 'iWork key fixture stub for docling path.\n',
    'audio-video/sample.mp3': 'ID3fixture',
    'audio-video/sample.wav': 'RIFF....WAVEfmt ',
    'audio-video/sample.mp4': '....ftypmp42',
    'audio-video/sample.mov': '....ftypqt  ',
    'unsupported/sample.xyz': 'unsupported extension negative fixture\n',
  };

  const minimalZip = (content) => {
    const crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
    const crc32 = (buf) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const name = Buffer.from('word/document.xml', 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(0, 42);
    name.copy(central, 46);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([local, central, end]);
  };

  const officeXml = '<?xml version="1.0"?><fixture>document-io</fixture>';
  samples['word/sample.docx'] = minimalZip(officeXml);
  samples['excel/sample.xlsx'] = minimalZip(officeXml);
  samples['excel/sample.xls'] = 'XLS fixture stub for docling path.\n';
  samples['excel/sample.ods'] = minimalZip(officeXml);
  samples['powerpoint/sample.pptx'] = minimalZip(officeXml);
  samples['powerpoint/sample.ppt'] = 'PPT fixture stub for docling path.\n';

  const written = [];
  for (const [rel, content] of Object.entries(samples)) {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written.push(`tests/fixtures/document-io/${rel}`);
  }
  return { written };
}
