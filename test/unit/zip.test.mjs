import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeZip, readZip, ZipError } from '../../src/core/zip.js';
import { crc32 } from '../../src/core/crc32.js';
import { rawZip } from './helpers/rawzip.mjs';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('round trip is byte-exact and writing is deterministic', async () => {
  const bin = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) & 255);
  const entries = [
    { name: 'project.json', bytes: new TextEncoder().encode('{"a":1}'.repeat(200)) },
    { name: 'assets/x.png', bytes: bin },
    { name: 'assets/empty.png', bytes: new Uint8Array(0) },
    { name: 'assets/ünïcode-名前.png', bytes: new Uint8Array([1, 2, 3]) },
  ];
  const a = await writeZip(entries);
  const b = await writeZip(entries);
  assert.deepEqual(a, b);
  const m = await readZip(a);
  for (const e of entries) assert.deepEqual(m.get(e.name), e.bytes, e.name);
});

test('compressible entries are deflated, incompressible ones stored', async () => {
  const noise = Uint8Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256));
  const text = new TextEncoder().encode('a'.repeat(4096));
  const z = await writeZip([{ name: 'n', bytes: noise }, { name: 't', bytes: text }]);
  assert.ok(z.length < noise.length + text.length);
  const m = await readZip(z);
  assert.deepEqual(m.get('n'), noise);
});

test('directory entries are skipped; a directory entry carrying data is rejected', async () => {
  const z = await writeZip([{ name: 'assets/', bytes: new Uint8Array(0) }, { name: 'assets/a.png', bytes: new Uint8Array([7]) }]);
  const m = await readZip(z);
  assert.deepEqual([...m.keys()], ['assets/a.png']);
  await assert.rejects(readZip(await rawZip({ name: 'assets/' })), (e) => e.code === 'Z_TRUNCATED');
});

const hostile = [
  ['Z_TRAVERSAL', { name: 'assets/../../evil' }],
  ['Z_TRAVERSAL', { name: 'assets\\x.png' }],
  ['Z_TRAVERSAL', { name: 'assets//x.png' }],
  ['Z_ABSOLUTE', { name: '/etc/passwd' }],
  ['Z_ABSOLUTE', { name: 'C:/Windows/x' }],
  ['Z_DUPLICATE', { duplicate: true }],
  ['Z_ENCRYPTED', { flags: 1 }],
  ['Z_METHOD', { method: 12 }],
  ['Z_ZIP64', { zip64: true }],
  ['Z_CRC', { badCrc: true }],
  ['Z_TOO_MANY', { count: 2001 }],
  ['Z_RATIO', { bomb: true }],
  ['Z_TRUNCATED', { truncate: true }],
  ['Z_NOT_ZIP', { notZip: true }],
];
for (const [code, spec] of hostile) {
  test(`rejects ${code} ${JSON.stringify(spec)}`, async () => {
    await assert.rejects(readZip(await rawZip(spec)), (e) => {
      assert.ok(e instanceof ZipError, String(e));
      assert.equal(e.code, code, e.message);
      assert.ok(e.why && e.fix);
      return true;
    });
  });
}

test('per-entry and total size limits apply from the declared sizes, before inflating', async () => {
  const z = await writeZip([{ name: 'a', bytes: new Uint8Array(2048) }]);
  await assert.rejects(readZip(z, { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 1e9, maxRatio: 100, ratioFloorBytes: 1e9 }), (e) => e.code === 'Z_TOO_LARGE');
  await assert.rejects(readZip(z, { maxEntries: 10, maxEntryBytes: 1e9, maxTotalBytes: 1024, maxRatio: 100, ratioFloorBytes: 1e9 }), (e) => e.code === 'Z_TOO_LARGE');
});
