// Spike SP-1 generator: writes the drawings the measurement uses into this folder.
// grid-5k.svg / grid-100k.svg carry width+height; grid-vb.svg carries viewBox only.
// edge.svg is a tiny high-contrast drawing used for the sharpness measurement.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const W = 2000, H = 1600;

function grid(cols, rows, sizeAttrs) {
  const cw = W / cols, ch = H / rows;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs}>`, `<rect width="${W}" height="${H}" fill="#fff"/>`];
  let n = 1; // the background rect
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = +(c * cw).toFixed(2), y = +(r * ch).toFixed(2);
    out.push(`<rect x="${x}" y="${y}" width="${+(cw - 1).toFixed(2)}" height="${+(ch - 1).toFixed(2)}" fill="${(r + c) % 2 ? '#cfe3ff' : '#ffe3b3'}" stroke="#334" stroke-width=".3"/>`);
    out.push(`<text x="${+(x + 1).toFixed(2)}" y="${+(y + ch * 0.7).toFixed(2)}" font-size="${+(ch * 0.5).toFixed(2)}" font-family="sans-serif">${(r * cols + c) % 1000}</text>`);
    n += 2;
  }
  out.push('</svg>');
  return { svg: out.join('\n'), count: n };
}

const files = {
  'grid-5k.svg': grid(50, 50, `width="${W}" height="${H}"`),          // 2*2500 + 1 = 5,001 elements
  'grid-100k.svg': grid(250, 200, `width="${W}" height="${H}"`),      // 2*50000 + 1 = 100,001 elements
  'grid-500.svg': grid(25, 10, `width="${W}" height="${H}"`),         // 501 elements
  'grid-1k.svg': grid(25, 20, `width="${W}" height="${H}"`),          // 1,001
  'grid-2k.svg': grid(50, 20, `width="${W}" height="${H}"`),          // 2,001
  'grid-20k.svg': grid(100, 100, `width="${W}" height="${H}"`),       // 20,001
  'grid-vb.svg': grid(50, 50, `viewBox="0 0 ${W} ${H}"`),             // viewBox only
};
files['edge.svg'] = {
  count: 3,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fff"/><rect x="100" y="100" width="100" height="100" fill="#000"/><path d="M220 60 L380 240" stroke="#000" stroke-width="2" fill="none"/></svg>`,
};
// edge-big.svg: 2000x1600 with a hard-edged 500x400 black rectangle (left edge at x=1000, y 800..1200).
files['edge-big.svg'] = {
  count: 2,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1600"><rect width="2000" height="1600" fill="#fff"/><rect x="1000" y="800" width="500" height="400" fill="#000"/></svg>`,
};
for (const [name, { svg, count }] of Object.entries(files)) {
  writeFileSync(path.join(dir, name), svg);
  console.log(name, count, 'elements', svg.length, 'bytes');
}
