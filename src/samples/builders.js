// Tiny writers for ZIP, PNG, JPEG-with-metadata, TIFF/EXIF and PDF. Used to build the
// synthetic sample files (in the browser and in tests) without shipping binaries.

import { crc32, encodeUtf8, deflate } from '../lib/bytes.js';

const concat = (parts) => {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const le16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
const le32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const be32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const be16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255]);
const bytesOf = (x) => (typeof x === 'string' ? encodeUtf8(x) : x);

/** Build a store-only ZIP. @param {{name: string, data: string|Uint8Array}[]} files */
export function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = encodeUtf8(f.name);
    const data = bytesOf(f.data);
    const crc = crc32(data);
    const local = concat([le32(0x04034b50), le16(20), le16(0x800), le16(0), le16(0), le16(0x21), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0), name, data]);
    central.push(concat([le32(0x02014b50), le16(20), le16(20), le16(0x800), le16(0), le16(0), le16(0x21), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(central);
  const end = concat([le32(0x06054b50), le16(0), le16(0), le16(files.length), le16(files.length), le32(cd.length), le32(offset), le16(0)]);
  return concat([...locals, cd, end]);
}

function pngChunk(type, data) {
  const t = encodeUtf8(type);
  const body = concat([t, data]);
  return concat([be32(data.length), body, be32(crc32(body))]);
}

/** Encode RGBA pixels as a PNG (used for evidence previews and samples). */
export async function pngFromRGBA(rgba, width, height, text = {}) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = concat([be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0])]);
  const chunks = [pngChunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(text)) chunks.push(pngChunk('tEXt', concat([encodeUtf8(k), new Uint8Array([0]), encodeUtf8(v)])));
  chunks.push(pngChunk('IDAT', await deflate(raw)));
  chunks.push(pngChunk('IEND', new Uint8Array()));
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** RGBA → PNG data URL. */
export async function rgbaToDataUrl(rgba, width, height) {
  return `data:image/png;base64,${toBase64(await pngFromRGBA(rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer), width, height))}`;
}

/** Procedural RGBA image (soft radial gradient + waves) for samples. */
export function proceduralRGBA(width, height, seed = 1) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const dx = x / width - 0.45, dy = y / height - 0.4;
    const r = Math.sqrt(dx * dx + dy * dy);
    const w = Math.sin(x * 0.021 * seed + y * 0.013) * 18 + Math.sin(y * 0.031 - x * 0.007) * 14;
    out[i] = Math.max(0, Math.min(255, 70 + 160 * (1 - r) + w));
    out[i + 1] = Math.max(0, Math.min(255, 60 + 90 * (y / height) + w * 0.6));
    out[i + 2] = Math.max(0, Math.min(255, 150 - 80 * (x / width) + w * 0.4));
    out[i + 3] = 255;
  }
  return out;
}

/** Procedural RGB PNG with optional tEXt chunks. */
export async function png(width, height, text = {}) {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      const dx = x - width / 2, dy = y - height / 2;
      const r = Math.sqrt(dx * dx + dy * dy) / (width / 2);
      raw[i] = Math.max(0, 255 - r * 180) | 0;
      raw[i + 1] = (90 + (y / height) * 120) | 0;
      raw[i + 2] = (200 - (x / width) * 120) | 0;
    }
  }
  const ihdr = concat([be32(width), be32(height), new Uint8Array([8, 2, 0, 0, 0])]);
  const chunks = [pngChunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(text)) chunks.push(pngChunk('tEXt', concat([encodeUtf8(k), new Uint8Array([0]), encodeUtf8(v)])));
  chunks.push(pngChunk('IDAT', await deflate(raw)));
  chunks.push(pngChunk('IEND', new Uint8Array()));
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/** Insert APP segments right after SOI (and after APP0 if present). */
export function jpegWithSegments(jpeg, segments) {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const segs = segments.map(({ marker, data }) => concat([new Uint8Array([0xff, marker]), be16(data.length + 2), data]));
  return concat([jpeg.subarray(0, at), ...segs, jpeg.subarray(at)]);
}

export function xmpSegment(xmlBody) {
  const xml = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${xmlBody}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  return { marker: 0xe1, data: concat([encodeUtf8('http://ns.adobe.com/xap/1.0/\0'), encodeUtf8(xml)]) };
}

/** Minimal little-endian EXIF block: IFD0 ASCII tags + Exif sub-IFD rationals. */
export function exifSegment(ascii, rationals = {}) {
  const tags0 = Object.entries(ascii).map(([tag, val]) => ({ tag: +tag, type: 2, data: encodeUtf8(val + '\0') }));
  const tagsE = Object.entries(rationals).map(([tag, [n, d]]) => ({ tag: +tag, type: 5, data: concat([le32(n), le32(d)]) }));
  const ifd0Count = tags0.length + 1;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifSize = 2 + tagsE.length * 12 + 4;
  const exifOff = 8 + ifd0Size;
  let dataOff = exifOff + exifSize;
  const blobs = [];
  const entry = (t) => {
    let valueField;
    if (t.data.length <= 4) { valueField = new Uint8Array(4); valueField.set(t.data); }
    else { valueField = le32(dataOff); blobs.push(t.data); dataOff += t.data.length; }
    return concat([le16(t.tag), le16(t.type), le32(t.type === 5 ? 1 : t.data.length), valueField]);
  };
  const ifd0 = concat([le16(ifd0Count), ...tags0.sort((a, b) => a.tag - b.tag).map(entry), concat([le16(0x8769), le16(4), le32(1), le32(exifOff)]), le32(0)]);
  const exif = concat([le16(tagsE.length), ...tagsE.map(entry), le32(0)]);
  const tiff = concat([new Uint8Array([0x49, 0x49, 0x2a, 0]), le32(8), ifd0, exif, ...blobs]);
  return { marker: 0xe1, data: concat([encodeUtf8('Exif\0\0'), tiff]) };
}

const pdfEsc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);

/** Single-page Helvetica PDF with an Info dictionary. */
export function pdf(lines, info = {}) {
  const content = ['BT', '/F1 11 Tf', '14 TL', '56 780 Td', ...lines.map((l) => `(${pdfEsc(l)}) Tj T*`), 'ET'].join('\n');
  const infoEntries = Object.entries(info).map(([k, v]) => `/${k} (${pdfEsc(v)})`).join(' ');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${encodeUtf8(content).length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< ${infoEntries} >>`,
  ];
  let out = '%PDF-1.7\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encodeUtf8(out);
}

const xmlEsc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/** Minimal .docx. */
export function docx(paragraphs, props = {}, links = []) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join('');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, i) => `<Relationship Id="rIdL${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(l)}" TargetMode="External"/>`).join('')}</Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${xmlEsc(props.creator || 'Alex Morgan')}</dc:creator><cp:lastModifiedBy>${xmlEsc(props.lastModifiedBy || 'Alex Morgan')}</cp:lastModifiedBy><dc:title>${xmlEsc(props.title || '')}</dc:title></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlEsc(props.application || 'Microsoft Office Word')}</Application></Properties>` },
  ]);
}

/** Minimal .xlsx with given cells. @param {{ref: string, value?: string|number, formula?: string}[]} cells */
export function xlsx(cells, sheetName = 'Forecast') {
  const strings = [];
  const rows = new Map();
  for (const c of cells) {
    const r = +c.ref.match(/\d+/)[0];
    if (!rows.has(r)) rows.set(r, []);
    let x;
    if (c.formula) x = `<c r="${c.ref}" t="str"><f>${xmlEsc(c.formula)}</f><v>${xmlEsc(String(c.value ?? ''))}</v></c>`;
    else if (typeof c.value === 'number') x = `<c r="${c.ref}"><v>${c.value}</v></c>`;
    else { strings.push(c.value); x = `<c r="${c.ref}" t="s"><v>${strings.length - 1}</v></c>`; }
    rows.get(r).push(x);
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.join('')}</row>`).join('')}</sheetData></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${xmlEsc(String(s))}</t></si>`).join('')}</sst>` },
  ]);
}
