// Builds deliberately malformed ZIP archives for the reader's rejection tests.
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../../src/core/crc32.js';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

export async function rawZip(spec = {}) {
  if (spec.notZip) return new Uint8Array(Buffer.from('this is plainly not an archive, just text that is long enough'));
  const entries = [];
  const count = spec.count || 1;
  for (let i = 0; i < count; i++) {
    const name = i === 0 && spec.name ? spec.name : (count > 1 ? `assets/f${i}.bin` : 'project.json');
    let raw = Buffer.from('{"x":1}');
    if (spec.bomb) raw = Buffer.alloc(2 * 1024 * 1024);
    entries.push({ name, raw });
  }
  if (spec.duplicate) entries.push({ name: 'PROJECT.json', raw: Buffer.from('{}') });
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const method = spec.method ?? (spec.bomb ? 8 : 0);
    const data = method === 8 ? deflateRawSync(e.raw) : e.raw;
    let crc = crc32(e.raw);
    if (spec.badCrc) crc ^= 1;
    const flags = 0x0800 | (spec.flags || 0);
    const csize = spec.zip64 ? 0xffffffff : data.length;
    const usize = spec.zip64 ? 0xffffffff : e.raw.length;
    const lh = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc), u32(csize), u32(usize), u16(name.length), u16(0), name, data]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc), u32(csize), u32(usize), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    local.push(lh);
    offset += lh.length;
  }
  const cd = Buffer.concat(central);
  const n = entries.length;
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(n), u16(n), u32(cd.length), u32(offset), u16(0)]);
  let all = Buffer.concat([...local, cd, eocd]);
  if (spec.truncate) all = all.subarray(0, all.length - 30);
  return new Uint8Array(all);
}
