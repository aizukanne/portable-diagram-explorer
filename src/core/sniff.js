// Image typing from magic bytes (design D12). Declared extensions and MIME types
// are never trusted: the bytes decide.

export const IMAGE_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  return null;
}

// What kind of file the user picked, from its first bytes.
export function sniffFileKind(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return 'zip';
  if (sniffImage(bytes)) return 'image';
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0x7b) return 'json';
  if (bytes[i] === 0x3c) return 'html';
  return 'unknown';
}

// A filename-safe slug: lowercase ASCII letters, digits and single hyphens.
export function slug(name, max = 40) {
  const base = String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const s = base.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return s || 'untitled';
}
