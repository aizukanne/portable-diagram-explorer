// Portability spike (spec §14 step 1). Builds one self-contained HTML file that
// exercises every browser capability the design depends on, under the strict
// content policy the real build will use. Run: node spike/build-spike.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

// 1x1 red PNG and 2x1 blue PNG, so dimension reporting is checkable.
const PNG_RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const frameStyle = 'html,body{margin:0;height:100%;background:#fff}img{display:block}';
const frameScript = `
(function(){
  var CH = document.documentElement.getAttribute('data-channel');
  var res = {};
  function send(m){ m.channel = CH; parent.postMessage(m, '*'); }
  addEventListener('message', function(e){
    if (e.source !== parent) { res.foreignRejected = true; return; }
    var m = e.data || {};
    if (m.channel !== CH) { send({type:'REJECTED', reason:'channel'}); return; }
    if (m.type === 'RENDER_SCENE') {
      var img = document.getElementById('img');
      img.onload = function(){ send({type:'SCENE_READY', seq:m.seq, w:img.naturalWidth, h:img.naturalHeight,
        origin: String(self.origin), canFetch: typeof fetch}); };
      img.onerror = function(){ send({type:'SCENE_ERROR', seq:m.seq}); };
      img.src = m.dataUrl;
    }
    if (m.type === 'PROBE_NETWORK') {
      var t = new Image();
      t.onload = function(){ send({type:'NET', loaded:true}); };
      t.onerror = function(){ send({type:'NET', loaded:false}); };
      t.src = 'https://example.com/x.png';
    }
  });
  document.addEventListener('click', function(){ send({type:'ACTIVATE_HOTSPOT', hotspotId:'h1'}); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') send({type:'REQUEST_BACK'}); });
  send({type:'READY'});
})();`;

const frameHtml = (channel) => `<!doctype html><html data-channel="${channel}"><head><meta charset="utf-8"><style>${frameStyle}</style></head><body><img id="img" alt="scene"><script>${frameScript}</script></body></html>`;

const parentStyle = 'body{font:14px sans-serif}iframe{width:300px;height:200px;border:1px solid #888}';
const parentScript = `
(function(){
  var R = window.__spike = { done:false };
  var FRAME_TEMPLATE = ${JSON.stringify(frameHtml('__CHANNEL__')).replace(/</g, '\\u003c')};
  var bytes = Uint8Array.from(atob(${JSON.stringify(PNG_RED)}), function(c){ return c.charCodeAt(0); });
  var chan = Array.from(crypto.getRandomValues(new Uint8Array(16)), function(b){ return b.toString(16).padStart(2,'0'); }).join('');
  R.inert = 'inert' in HTMLElement.prototype;
  R.compression = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  R.origin = String(location.origin);
  // Blob URL image in the parent (root renderer path).
  var pimg = new Image();
  pimg.onload = function(){ R.parentBlobImage = pimg.naturalWidth === 1; };
  pimg.onerror = function(){ R.parentBlobImage = false; };
  pimg.src = URL.createObjectURL(new Blob([bytes], {type:'image/png'}));
  // deflate-raw round trip (ZIP codec path).
  (async function(){
    try {
      var input = new TextEncoder().encode('hello hello hello hello');
      var c = await new Response(new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
      var d = await new Response(new Blob([c]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      R.deflateRoundTrip = new TextDecoder().decode(d) === 'hello hello hello hello';
    } catch (e) { R.deflateRoundTrip = 'error: ' + e.message; }
  })();
  var f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.title = 'Diagram';
  f.srcdoc = FRAME_TEMPLATE.replace('__CHANNEL__', chan);
  var seq = 0;
  addEventListener('message', function(e){
    if (e.source !== f.contentWindow) { R.untrusted = (R.untrusted||0)+1; return; }
    var m = e.data || {};
    if (m.channel !== chan) { R.badChannel = true; return; }
    R.eventOrigin = e.origin;
    if (m.type === 'READY') {
      R.ready = true;
      seq++;
      f.contentWindow.postMessage({type:'RENDER_SCENE', channel:chan, seq:seq, dataUrl:'data:image/png;base64,${PNG_RED}'}, '*');
      f.contentWindow.postMessage({type:'RENDER_SCENE', channel:'wrong', seq:99, dataUrl:''}, '*');
    } else if (m.type === 'SCENE_READY') {
      R.sceneReady = {w:m.w, h:m.h, frameOrigin:m.origin};
      f.contentWindow.postMessage({type:'PROBE_NETWORK', channel:chan}, '*');
    } else if (m.type === 'REJECTED') { R.childRejectedWrongChannel = true;
    } else if (m.type === 'NET') { R.frameNetworkBlocked = !m.loaded;
    } else if (m.type === 'ACTIVATE_HOTSPOT') { R.activated = m.hotspotId;
    } else if (m.type === 'REQUEST_BACK') { R.escapeForwarded = true; }
  });
  document.addEventListener('securitypolicyviolation', function(e){
    (R.cspViolations = R.cspViolations || []).push(e.violatedDirective + ' ' + (e.blockedURI||''));
  });
  document.body.appendChild(f);
  document.getElementById('dl').addEventListener('click', function(){
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['spike download'], {type:'text/plain'}));
    a.download = 'spike.txt'; document.body.appendChild(a); a.click(); a.remove();
  });
  // Parent network probe: must be blocked by CSP.
  var nimg = new Image();
  nimg.onload = function(){ R.parentNetworkBlocked = false; };
  nimg.onerror = function(){ R.parentNetworkBlocked = true; };
  nimg.src = 'https://example.com/y.png';
})();`;

const csp = [
  "default-src 'none'",
  `script-src ${sha(parentScript)} ${sha(frameScript)}`,
  `style-src ${sha(parentStyle)} ${sha(frameStyle)}`,
  'img-src data: blob:',
].join('; ');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>PDE portability spike</title><style>${parentStyle}</style></head>
<body><h1>Spike</h1><button id="dl" type="button">Download</button>
<script>${parentScript}</script></body></html>`;

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/spike.html', import.meta.url), html);
console.log('wrote spike/out/spike.html', html.length, 'bytes');
