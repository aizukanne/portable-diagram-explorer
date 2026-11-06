// Values the build injects as __BUILD__ (build/build.mjs). Outside a bundle
// (unit tests) there is no build, and callers get an empty object.
export function buildInfo() {
  // eslint-disable-next-line no-undef
  return typeof __BUILD__ === 'undefined' ? {} : __BUILD__;
}
