// Values the build injects as __BUILD__ (build/build.mjs). Outside a bundle
// (unit tests) there is no build, and callers get an empty object.
export function buildInfo() {
  // eslint-disable-next-line no-undef
  return typeof __BUILD__ === 'undefined' ? {} : __BUILD__;
}

// A CSP nonce is base64 or base64url text. Anything else (a quote, an angle bracket,
// a space) is not a valid nonce source, and must never be written into markup.
export const NONCE_RE = /^[A-Za-z0-9+/=_-]{1,200}$/;

// The nonce the host page gave the script that is running us (the presentation's own
// inline script), or '' when there is none or it is malformed. A host that admits
// scripts by nonce only will refuse our sandboxed frame's inline script unless that
// script carries the same nonce (issue #16).
export function hostNonce() {
  const n = buildInfo().hostNonce;
  return typeof n === 'string' && NONCE_RE.test(n) ? n : '';
}
