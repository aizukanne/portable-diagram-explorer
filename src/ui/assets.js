// AssetManager: image bytes for the open project (spec §7, §10; design D12).
//
// Bytes are kept exactly as imported and never re-encoded. Dimensions are taken
// from the browser's own decode of the file through an <img> element (which
// applies EXIF orientation the same way the renderer will display it), so stored
// geometry and what is drawn always agree. SVG is the exception: a browser's
// naturalWidth for an SVG without width/height is a per-engine guess (SP-1), so an
// SVG's size comes from its own text (inspectSvg) and the decode only proves it displays. Object URLs are created lazily and
// revoked on release; the frame receives data: URLs from a small cache.
import { newId } from '../core/ids.js';
import { sniffImage } from '../core/sniff.js';
import { bytesToBase64 } from '../core/package.js';
import { makeIssue } from '../core/schema.js';
import { MAX_DECODED_PIXELS } from '../core/validate.js';
import { inspectSvg } from './svg-inspect.js';

const DATA_URL_CACHE = 3;
const SVG = 'image/svg+xml';

export class AssetManager {
  constructor() {
    this.bytes = new Map();
    this.mime = new Map();
    this.urls = new Map();
    this.dataCache = [];
  }

  has(id) { return this.bytes.has(id); }

  // Decode bytes and report their displayed size; rejects undecodable images.
  // For SVG the size comes from inspectSvg, never from naturalWidth.
  async measure(bytes, mimeType) {
    if (mimeType === SVG) {
      const r = inspectSvg(bytes);
      if (r.issues.some((i) => i.severity === 'error')) throw new Error(r.issues.find((i) => i.severity === 'error').code);
      await this.decode(bytes, mimeType);
      return { width: r.width, height: r.height };
    }
    return this.decode(bytes, mimeType);
  }

  async decode(bytes, mimeType) {
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

  // Import a user-chosen image file. Returns { asset, warnings } or { issue }.
  async importImage(name, bytes) {
    const t = sniffImage(bytes);
    if (!t) {
      const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart();
      if (/^<(?:\?xml|(?:[A-Za-z_][\w.-]*:)?svg)/i.test(head)) {
        return { issue: makeIssue('E_SVG_NOT_RECOGNISED', name, head.slice(0, 100),
          'an SVG file whose root element is <svg xmlns="http://www.w3.org/2000/svg" ...>, starting within the first 4096 bytes (any xml declaration, comments and DOCTYPE before it must fit in that)',
          'The file looks like SVG/XML but its root element was not found in the form the importer recognises: an unprefixed <svg> carrying the SVG namespace declaration in its own opening tag. Anything else is not treated as an image.',
          'Open the file in a text editor and make the root element read <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" ...> (no "svg:" prefix; xmlns inside the opening tag; no ">" before xmlns; shorten any long comment before it), or export it again as plain SVG.') };
      }
      return { issue: makeIssue('E_IMAGE_TYPE', name, name, 'a PNG, JPEG, WebP or SVG image file',
        'Only these image formats are imported; PDF, GIF and other formats are not.', 'Export the diagram as PNG, JPEG, WebP or SVG and import that file.') };
    }
    let dims;
    let warnings = [];
    if (t.mimeType === SVG) {
      const r = inspectSvg(bytes, name);
      const err = r.issues.find((i) => i.severity === 'error');
      if (err) return { issue: err };
      warnings = r.issues;
      dims = { width: r.width, height: r.height };
      try { await this.decode(bytes, t.mimeType); } catch {
        return { issue: makeIssue('E_IMAGE_DECODE', name, name, 'an SVG file this browser can display', 'The file looks like an SVG but the browser could not display it; it may be damaged.', 'Open the SVG in a browser to find the problem, or re-export it.') };
      }
    } else try { dims = await this.measure(bytes, t.mimeType); } catch {
      return { issue: makeIssue('E_IMAGE_DECODE', name, name, `a ${t.mimeType} file this browser can decode`, 'The file looks like an image but could not be decoded; it may be damaged.', 'Re-export the image and import it again.') };
    }
    if (dims.width * dims.height > MAX_DECODED_PIXELS) {
      return { issue: makeIssue('E_IMAGE_TOO_LARGE', name, `${dims.width} x ${dims.height}`, `at most ${MAX_DECODED_PIXELS / 1e6} million pixels`,
        'Decoding larger images can exhaust browser memory on the recipient\'s computer.', 'Export a smaller image, or split the diagram into detail images.') };
    }
    const id = newId('a');
    this.add(id, bytes, t.mimeType);
    return { asset: { id, mimeType: t.mimeType, width: dims.width, height: dims.height, name }, warnings };
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
        if (a.mimeType === SVG) {
          // Say precisely what is wrong with the SVG (no size, not parseable, too large), not just "damaged".
          const bad = inspectSvg(b, a.path).issues.filter((x) => x.severity === 'error');
          if (bad.length) { issues.push(...bad.map((x) => ({ ...x, path: `assets[${i}]` }))); continue; }
        }
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
