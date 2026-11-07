// AssetManager: image bytes for the open project (spec §7, §10; design D12).
//
// Bytes are kept exactly as imported and never re-encoded. Dimensions are taken
// from the browser's own decode of the file through an <img> element (which
// applies EXIF orientation the same way the renderer will display it), so stored
// geometry and what is drawn always agree. Object URLs are created lazily and
// revoked on release; the frame receives data: URLs from a small cache.
import { newId } from '../core/ids.js';
import { sniffImage } from '../core/sniff.js';
import { bytesToBase64 } from '../core/package.js';
import { makeIssue } from '../core/schema.js';
import { MAX_DECODED_PIXELS } from '../core/validate.js';

const DATA_URL_CACHE = 3;

export class AssetManager {
  constructor() {
    this.bytes = new Map();
    this.mime = new Map();
    this.urls = new Map();
    this.dataCache = [];
  }

  has(id) { return this.bytes.has(id); }

  // Decode bytes and report their displayed size; rejects undecodable images.
  async measure(bytes, mimeType) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Import a user-chosen image file. Returns { asset } or { issue }.
  async importImage(name, bytes) {
    const t = sniffImage(bytes);
    if (!t) {
      return { issue: makeIssue('E_IMAGE_TYPE', name, name, 'a PNG, JPEG or WebP image file',
        'Version 1 shows raster images only; SVG, PDF and other formats are not imported.', 'Export the diagram as PNG, JPEG or WebP and import that file.') };
    }
    let dims;
    try { dims = await this.measure(bytes, t.mimeType); } catch {
      return { issue: makeIssue('E_IMAGE_DECODE', name, name, `a ${t.mimeType} file this browser can decode`, 'The file looks like an image but could not be decoded; it may be damaged.', 'Re-export the image and import it again.') };
    }
    if (dims.width * dims.height > MAX_DECODED_PIXELS) {
      return { issue: makeIssue('E_IMAGE_TOO_LARGE', name, `${dims.width} x ${dims.height}`, `at most ${MAX_DECODED_PIXELS / 1e6} million pixels`,
        'Decoding larger images can exhaust browser memory on the recipient\'s computer.', 'Export a smaller image, or split the diagram into detail images.') };
    }
    const id = newId('a');
    this.add(id, bytes, t.mimeType);
    return { asset: { id, mimeType: t.mimeType, width: dims.width, height: dims.height, name } };
  }

  add(id, bytes, mimeType) {
    this.release(id);
    this.bytes.set(id, bytes);
    this.mime.set(id, mimeType);
  }

  // Check every image of an opened project decodes to the size the project
  // states; geometry is normalized against that size. Returns issues.
  async verifyProject(project) {
    const issues = [];
    for (const [i, a] of project.assets.entries()) {
      const b = this.bytes.get(a.id);
      try {
        const d = await this.measure(b, a.mimeType);
        if (d.width !== a.width || d.height !== a.height) {
          issues.push(makeIssue('E_ASSET_DIMENSIONS', `assets[${i}]`, `${d.width} x ${d.height} (decoded)`, `${a.width} x ${a.height}, as project.json states`,
            'Hotspot positions are fractions of the stated size; a different image size would misplace them.',
            `Replace the file ${a.path} with the original image, or correct width/height in project.json to ${d.width} and ${d.height} and review alignment.`));
        }
      } catch {
        issues.push(makeIssue('E_IMAGE_DECODE', `assets[${i}]`, a.path, `a decodable ${a.mimeType} image`, 'The image could not be decoded; it may be damaged.', `Replace ${a.path} with the original image file.`));
      }
    }
    return issues;
  }

  url(id) {
    if (!this.urls.has(id)) {
      const b = this.bytes.get(id);
      if (!b) throw new Error(`no image bytes for asset ${id}`);
      this.urls.set(id, URL.createObjectURL(new Blob([b], { type: this.mime.get(id) })));
    }
    return this.urls.get(id);
  }

  dataUrl(id) {
    const hit = this.dataCache.find((e) => e.id === id);
    if (hit) return hit.url;
    const b = this.bytes.get(id);
    if (!b) throw new Error(`no image bytes for asset ${id}`);
    const url = `data:${this.mime.get(id)};base64,${bytesToBase64(b)}`;
    this.dataCache.unshift({ id, url });
    this.dataCache.length = Math.min(this.dataCache.length, DATA_URL_CACHE);
    return url;
  }

  release(id) {
    const u = this.urls.get(id);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(id);
    this.dataCache = this.dataCache.filter((e) => e.id !== id);
  }

  clear() {
    for (const id of [...this.urls.keys()]) this.release(id);
    this.bytes.clear();
    this.mime.clear();
    this.dataCache = [];
  }
}
