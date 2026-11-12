// E_SVG_NOT_RECOGNISED: a file that looks like SVG/XML but fails the sniff is refused loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetManager } from '../../src/ui/assets.js';

const enc = (s) => new TextEncoder().encode(s);
const cases = [
  ['no xmlns', '<svg width="10" height="10"/>'],
  ['prefixed root', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="10" height="10"/>'],
  ['xml declaration then unrecognised root', '<?xml version="1.0"?>\n<doc/>'],
  ['preamble longer than 4 KiB', `<?xml version="1.0"?><!-- ${'x'.repeat(5000)} --><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`],
  ['comment before a root without xmlns', '<!-- exported by a tool -->\n<svg width="10" height="10"/>'],
  ['comment and DOCTYPE before a root without xmlns', '<!-- c --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="10" height="10"/>'],
  ['> inside an attribute before xmlns', '<svg title="a>b" xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],
];
for (const [name, text] of cases) {
  test(`looks like SVG but is not recognised: ${name}`, async () => {
    const r = await new AssetManager().importImage('drawing.svg', enc(text));
    assert.equal(r.issue.code, 'E_SVG_NOT_RECOGNISED');
    assert.match(r.issue.received, /^"</);
    assert.match(r.issue.expected, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(r.issue.expected, /4096/);
    assert.match(r.issue.fix, /no "svg:" prefix/);
  });
}

test('other unrecognised files are still E_IMAGE_TYPE', async () => {
  const m = new AssetManager();
  assert.equal((await m.importImage('x.gif', enc('GIF89a......'))).issue.code, 'E_IMAGE_TYPE');
  assert.equal((await m.importImage('page.html', enc('<!DOCTYPE html><html><body><svg width="1" height="1"></svg></body></html>'))).issue.code, 'E_IMAGE_TYPE');
  assert.equal((await m.importImage('page2.html', enc('<!-- c --><!DOCTYPE html><html><body></body></html>'))).issue.code, 'E_IMAGE_TYPE');
  assert.equal((await m.importImage('x.txt', enc('hello world, plain text'))).issue.code, 'E_IMAGE_TYPE');
});
