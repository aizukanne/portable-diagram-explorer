// Child runtime: runs inside the sandboxed iframe (spec §8, design D16, D17).
//
// It renders the scene the parent sends, hit-tests, shows tooltips and forwards
// activations, viewport changes and keys. It never navigates and never resolves a
// target: the parent decides what an activation means.
import { SceneRenderer } from './renderer.js';
import { makeMessage, validateParentMessage } from '../core/protocol.js';

const channel = document.documentElement.getAttribute('data-channel');
let outSeq = 0;
let inSeq = 0;
let sceneToken = null;
let viewQueued = false;

function send(type, fields) {
  outSeq += 1;
  // The parent's origin is opaque or file-scheme; the message carries no secrets
  // beyond the channel, and is addressed to our parent window only.
  window.parent.postMessage(makeMessage(channel, outSeq, type, fields), '*');
}

const host = document.body;
const renderer = new SceneRenderer(host, {
  mode: 'present',
  onActivate: (hotspotId, mode, anchor) => {
    if (sceneToken) send('ACTIVATE_HOTSPOT', { sceneToken, hotspotId, mode, anchor });
  },
  onView: () => queueView(),
  onSelect: () => queueView(),
  onKey: (key) => send('KEY', { key }),
});

function queueView() {
  if (viewQueued || !sceneToken) return;
  viewQueued = true;
  requestAnimationFrame(() => {
    viewQueued = false;
    if (sceneToken) send('VIEWPORT_CHANGED', { sceneToken, viewport: renderer.getView(), selectedHotspotId: renderer.selectedId || null });
  });
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (!validateParentMessage(m, { channel, lastSeq: inSeq }).ok) return;
  inSeq = m.seq;
  if (m.type === 'RENDER_SCENE') {
    sceneToken = m.sceneToken;
    const token = m.sceneToken;
    // If the user is working inside the frame (keyboard Back, Enter on a hotspot),
    // keep their focus here on the new scene: the selected hotspot, else the first.
    const hadFocus = document.hasFocus();
    renderer.opts.tooltipDelayMs = m.settings.tooltipDelayMs;
    renderer.setHints(m.settings.showHotspotHints);
    renderer.setScene(m.scene, m.image.dataUrl, m.viewport, m.selectedHotspotId)
      .then(() => {
        if (sceneToken !== token) return;
        if (hadFocus && !(m.selectedHotspotId && renderer.focusHotspot(m.selectedHotspotId))) renderer.focusEdge('first');
        send('SCENE_READY', { sceneToken: token });
      })
      .catch(() => { /* the parent's render timeout reports the failure */ });
    return;
  }
  if (m.sceneToken !== sceneToken) return;
  if (m.type === 'FOCUS_HOTSPOT') {
    window.focus();
    if (!renderer.focusHotspot(m.hotspotId)) renderer.focusEdge('first');
    return;
  }
  switch (m.command) {
    case 'fit': renderer.fit(); break;
    case 'zoomIn': renderer.zoomBy(1.25); break;
    case 'zoomOut': renderer.zoomBy(0.8); break;
    case 'hideTooltip': renderer.hideTooltip(); break;
    case 'focusFirst': window.focus(); if (!renderer.focusEdge('first')) host.focus(); break;
    case 'focusLast': window.focus(); if (!renderer.focusEdge('last')) host.focus(); break;
    default: break;
  }
});

host.tabIndex = -1;
send('READY', {});
