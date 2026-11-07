// ZIP writer: per-entry raw DEFLATE (store for already-compressed media or when
// the runtime lacks deflate-raw). UTF-8 names, CRC-32, no ZIP64 (entries < 4 GB).

import { crc32, encodeUtf8, deflateRaw } from './bytes.js';

const STORE_EXT = /\.(png|jpe?g|gif|webp|avif|heic|mp[34]|m4a|mov|zip|gz|7z|rar|woff2?|pdf)$/i;

const le16 = (n) => [n & 255, (n >> 8) & 255];
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

/** DOS date/time for "now" (keeps archives deterministic within a run). */
function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * @param {{name: string, data: Uint8Array|string, store?: boolean}[]} files
 * @param {{compress?: boolean, date?: Date}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(files, { compress = true, date } = {}) {
  const { time, date: dd } = dosTime(date);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = encodeUtf8(f.name);
    let raw, crc, method = 0, body, flags = 0x800;
    if (f.passthrough) {
      // Copy an entry exactly as stored in another archive (e.g. encrypted entries).
      ({ data: body, method, crc } = f.passthrough);
      raw = { length: f.passthrough.size };
      flags |= f.passthrough.flags & 0x1;
    } else {
      raw = typeof f.data === 'string' ? encodeUtf8(f.data) : f.data;
      crc = crc32(raw);
      body = raw;
    }
    if (!f.passthrough && compress && !f.store && !STORE_EXT.test(f.name) && raw.length > 64) {
      const d = await deflateRaw(raw);
      if (d && d.length < raw.length) { body = d; method = 8; }
    }
    const header = (sig, extra) => [...le32(sig), ...extra, ...le16(flags), ...le16(method), ...le16(time), ...le16(dd), ...le32(crc), ...le32(body.length), ...le32(raw.length), ...le16(name.length)];
    const local = new Uint8Array([...header(0x04034b50, le16(20)), ...le16(0)]);
    const cen = new Uint8Array([...header(0x02014b50, [...le16(20), ...le16(20)]), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset)]);
    locals.push(local, name, body);
    central.push(cen, name);
    offset += local.length + name.length + body.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array([...le32(0x06054b50), 0, 0, 0, 0, ...le16(files.length), ...le16(files.length), ...le32(cdSize), ...le32(offset), 0, 0]);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
