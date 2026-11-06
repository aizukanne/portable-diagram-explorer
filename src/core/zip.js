// ZIP reader/writer over the platform's deflate-raw streams (design D1, D11).
//
// Writing is deterministic (fixed timestamps, stable order) so a saved package
// is byte-reproducible. Reading treats the archive as hostile: every rejection is
// a ZipError carrying a code, the entry concerned, why it matters and what to do.
// Which entries a project package may contain is decided by package.js.
import { crc32 } from './crc32.js';

const MiB = 1024 * 1024;
export const ZIP_LIMITS = Object.freeze({
  maxEntries: 2000,
  maxEntryBytes: 100 * MiB,
  maxTotalBytes: 512 * MiB,
  maxRatio: 100,
  ratioFloorBytes: 1 * MiB,
});

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const DOS_DATE = 0x0021; // 1980-01-01: fixed so output is reproducible
const FLAG_UTF8 = 0x0800;

export class ZipError extends Error {
  constructor(code, entry, why, fix) {
    super(`${code}${entry ? ` (${entry})` : ''}: ${why}`);
    this.name = 'ZipError';
    this.code = code;
    this.entry = entry || null;
    this.why = why;
    this.fix = fix;
  }
}

async function streamThrough(bytes, transform) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer();
  return new Uint8Array(out);
}

// Inflate, refusing to produce more than `limit` bytes (bomb protection that does
// not trust the declared size).
async function inflateBounded(bytes, limit, name) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new ZipError('Z_SIZE', name, `the entry expands to more than its declared ${limit} bytes`, 'Recreate the package with the editor; this archive was modified or damaged.');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError('Z_CORRUPT', name, `the compressed data cannot be decoded (${e.message})`, 'Recreate the package with the editor; this archive is damaged.');
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function writeZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  if (entries.length > 0xfffe) throw new ZipError('Z_TOO_MANY', null, 'too many entries for a standard ZIP', 'Reduce the number of files.');
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = e.bytes;
    const crc = crc32(raw);
    let method = 0;
    let data = raw;
    if (e.compress !== false && raw.length > 0) {
      const z = await streamThrough(raw, new CompressionStream('deflate-raw'));
      if (z.length < raw.length) { method = 8; data = z; }
    }
    if (raw.length > 0xfffffffe || offset > 0xfffffffe) throw new ZipError('Z_TOO_LARGE', e.name, 'the package exceeds 4 GiB', 'Reduce image sizes.');
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, SIG_LOCAL, true); lh.setUint16(4, 20, true); lh.setUint16(6, FLAG_UTF8, true);
    lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, DOS_DATE, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, SIG_CENTRAL, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, FLAG_UTF8, true); ch.setUint16(10, method, true); ch.setUint16(12, 0, true);
    ch.setUint16(14, DOS_DATE, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, SIG_EOCD, true);
  eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

function checkName(name) {
  const fix = 'Recreate the package with the editor, which writes only safe relative names.';
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ZipError('Z_TRAVERSAL', name, 'the entry name contains control characters', fix);
  if (name.includes('\\')) throw new ZipError('Z_TRAVERSAL', name, 'the entry name contains a backslash, which some systems treat as a folder separator', fix);
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new ZipError('Z_ABSOLUTE', name, 'the entry name is an absolute path', fix);
  const segs = name.replace(/\/$/, '').split('/');
  if (segs.some((s) => s === '..' || s === '.' || s === '')) throw new ZipError('Z_TRAVERSAL', name, 'the entry name contains ".", ".." or an empty path segment, which could write outside the package folder', fix);
}

export async function readZip(input, limits = ZIP_LIMITS) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const startsLikeZip = bytes.length >= 4 && dv.getUint32(0, true) === SIG_LOCAL;
  const notZip = () => new ZipError('Z_NOT_ZIP', null, 'the file is not a ZIP archive', 'Choose a .diagram.zip saved by Portable Diagram Explorer.');
  const truncated = (entry) => new ZipError('Z_TRUNCATED', entry || null, 'the archive is incomplete or damaged', 'Download or copy the file again; it was cut short or modified.');
  if (bytes.length < 22) throw startsLikeZip ? truncated() : notZip();

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw startsLikeZip ? truncated() : notZip();
  if (eocd >= 20 && dv.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) {
    throw new ZipError('Z_ZIP64', null, 'the archive uses ZIP64 extensions, which this version does not read', 'Save the project again with the editor, which writes standard ZIP.');
  }
  const diskNo = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const countDisk = dv.getUint16(eocd + 8, true);
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('Z_ZIP64', null, 'the archive uses ZIP64 extensions, which this version does not read', 'Save the project again with the editor, which writes standard ZIP.');
  }
  if (diskNo !== 0 || cdDisk !== 0 || countDisk !== count) {
    throw new ZipError('Z_MULTIDISK', null, 'the archive is split across several files', 'Join the parts into a single archive, or save the project again.');
  }
  if (count > limits.maxEntries) {
    throw new ZipError('Z_TOO_MANY', null, `the archive has ${count} entries; at most ${limits.maxEntries} are accepted`, 'Remove unrelated files from the archive.');
  }
  if (cdOffset + cdSize > eocd) throw truncated();

  const dec = new TextDecoder('utf-8', { fatal: true });
  const latin = new TextDecoder('latin1');
  const seen = new Set();
  const out = new Map();
  let total = 0;
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== SIG_CENTRAL) throw truncated();
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    if (p + 46 + nlen > eocd) throw truncated();
    const nameBytes = bytes.subarray(p + 46, p + 46 + nlen);
    let name;
    try { name = flags & FLAG_UTF8 ? dec.decode(nameBytes) : latin.decode(nameBytes); } catch { throw new ZipError('Z_TRAVERSAL', '(unreadable name)', 'an entry name is not valid UTF-8', 'Recreate the package with the editor.'); }
    p += 46 + nlen + xlen + clen;

    checkName(name);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new ZipError('Z_DUPLICATE', name, 'two entries have the same name (ignoring letter case), so it is ambiguous which one is meant', 'Recreate the package with the editor.');
    seen.add(key);
    if (flags & 0x0041) throw new ZipError('Z_ENCRYPTED', name, 'the entry is encrypted', 'Save an unencrypted package; the editor never encrypts.');
    if (method !== 0 && method !== 8) throw new ZipError('Z_METHOD', name, `the entry uses compression method ${method}; only stored (0) and deflate (8) are read`, 'Re-create the archive with standard deflate compression, or save it again from the editor.');
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new ZipError('Z_ZIP64', name, 'the entry uses ZIP64 sizes', 'Save the project again with the editor, which writes standard ZIP.');
    if (usize > limits.maxEntryBytes) throw new ZipError('Z_TOO_LARGE', name, `the entry is ${usize} bytes; at most ${limits.maxEntryBytes} are accepted per file`, 'Use smaller images.');
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError('Z_TOO_LARGE', name, `the archive expands to more than ${limits.maxTotalBytes} bytes`, 'Use fewer or smaller images.');
    if (usize > limits.ratioFloorBytes && usize > csize * limits.maxRatio) {
      throw new ZipError('Z_RATIO', name, `the entry claims to expand ${Math.round(usize / Math.max(1, csize))} times, more than the ${limits.maxRatio}:1 accepted`, 'This looks like a decompression bomb; do not use this file.');
    }
    if (name.endsWith('/')) { if (usize !== 0) throw truncated(name); continue; }

    if (lho + 30 > cdOffset || dv.getUint32(lho, true) !== SIG_LOCAL) throw truncated(name);
    if (dv.getUint16(lho + 8, true) !== method) throw new ZipError('Z_CORRUPT', name, 'the local and central headers disagree about the compression method', 'Recreate the package with the editor.');
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const end = start + csize;
    if (end > cdOffset) throw truncated(name);
    const data = bytes.subarray(start, end);
    let content;
    if (method === 0) {
      if (csize !== usize) throw new ZipError('Z_SIZE', name, 'a stored entry has different compressed and uncompressed sizes', 'Recreate the package with the editor.');
      content = data.slice();
    } else {
      content = await inflateBounded(data, usize, name);
    }
    if (content.length !== usize) throw new ZipError('Z_SIZE', name, `the entry expands to ${content.length} bytes but declares ${usize}`, 'Recreate the package with the editor; this archive was modified or damaged.');
    if (crc32(content) !== crc) throw new ZipError('Z_CRC', name, 'the entry\'s checksum does not match its contents, so it was damaged or altered', 'Download or copy the file again.');
    out.set(name, content);
  }
  return out;
}
