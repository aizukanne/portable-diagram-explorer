// Safe embedding of data inside HTML documents (design MR-2, D7).
//
// A string placed inside an inline script element ends that element at the first
// closing script tag it contains, whatever the surrounding JavaScript syntax says.
// Every value we embed therefore escapes the characters that can terminate or
// re-interpret the host element. JSON.parse reverses the escapes exactly.

export function jsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Find the JSON script block with the given id in a document's text and
// return the raw element body, or null. Nothing is executed. In the browser the
// caller should prefer DOMParser (see extractJsonBlockDom); this scanner exists so
// Node-side code (build, tests) shares the exact contract.
export function extractJsonBlock(htmlText, id) {
  const open = '<' + 'script type="application/json" id="' + id + '">';
  const start = htmlText.indexOf(open);
  if (start < 0) return null;
  if (htmlText.indexOf(open, start + open.length) >= 0) return null; // ambiguous: two blocks
  const bodyStart = start + open.length;
  const end = htmlText.indexOf('<' + '/script>', bodyStart);
  if (end < 0) return null;
  return htmlText.slice(bodyStart, end);
}

// Browser variant: parse the text into an inert document (scripts never run in a
// DOMParser document) and read the element's text.
export function extractJsonBlockDom(htmlText, id) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const nodes = doc.querySelectorAll('script[type="application/json"]');
  let found = null;
  for (const n of nodes) {
    if (n.id !== id) continue;
    if (found !== null) return null;
    found = n.textContent;
  }
  return found;
}
