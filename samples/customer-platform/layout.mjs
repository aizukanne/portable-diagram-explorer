// Single source for the sample project (design D23): each diagram's boxes produce
// both its SVG drawing (rendered once to a committed PNG) and its hotspot rects in
// project.json, so the clickable regions match the picture by construction.

const PALETTE = {
  edge: { fill: '#e0f2fe', stroke: '#0369a1' },
  core: { fill: '#ede9fe', stroke: '#6d28d9' },
  data: { fill: '#dcfce7', stroke: '#15803d' },
  ext: { fill: '#fef3c7', stroke: '#b45309' },
  note: { fill: '#f1f5f9', stroke: '#475569' },
};

// Boxes are in pixels of the diagram's image. `hotspot` turns a box into a hotspot.
export const DIAGRAMS = [
  {
    id: 'd-overview', file: 'overview', title: 'Customer Platform overview', width: 1920, height: 1080,
    description: 'The customer-facing platform: how requests enter, which services handle them, and where data lives.\nClick a component to drill down.',
    heading: 'Customer Platform — system overview',
    boxes: [
      { key: 'web', x: 120, y: 200, w: 320, h: 150, kind: 'edge', label: 'Web & mobile apps', sub: 'React SPA, iOS, Android' },
      { key: 'gw', x: 620, y: 200, w: 320, h: 150, kind: 'edge', label: 'API gateway', sub: 'TLS, rate limits, routing' },
      { key: 'id', x: 1120, y: 120, w: 340, h: 170, kind: 'core', label: 'Identity service', sub: 'Login, tokens, accounts',
        hotspot: { id: 'h-identity', tooltip: 'Authentication and account association', defaultActionId: 'act-id-hld', actions: [
          { id: 'act-id-hld', label: 'Open HLD', type: 'diagram', targetDiagramId: 'd-identity' },
          { id: 'act-id-lld', label: 'Open LLD (account association)', type: 'diagram', targetDiagramId: 'd-account-lld' },
          { id: 'act-id-read', label: 'Read description', type: 'details', text: 'Authenticates users, issues short-lived tokens, and resolves which customer accounts a user may act on.\n\nOwner: Identity team. Availability target: 99.95%.' },
        ] } },
      { key: 'bill', x: 1120, y: 380, w: 340, h: 170, kind: 'core', label: 'Billing service', sub: 'Invoices, payments',
        hotspot: { id: 'h-billing', tooltip: 'Invoices and payment collection', defaultActionId: null, actions: [
          { id: 'act-bill-read', label: 'Read description', type: 'details', text: 'Generates monthly invoices and collects payments through the payment provider.\nNo detailed design is published yet.' },
          { id: 'act-bill-data', label: 'Open data platform', type: 'diagram', targetDiagramId: 'd-data' },
        ] } },
      { key: 'data', x: 1120, y: 660, w: 340, h: 200, kind: 'data', label: 'Data platform', sub: 'Postgres, object store, events',
        hotspot: { id: 'h-data', tooltip: 'Shared storage and event streams', defaultActionId: 'act-data-open', actions: [
          { id: 'act-data-open', label: 'Open data platform', type: 'diagram', targetDiagramId: 'd-data' },
        ] } },
      { key: 'pay', x: 1580, y: 380, w: 280, h: 170, kind: 'ext', label: 'Payment provider', sub: 'external' },
      { key: 'idp', x: 1580, y: 120, w: 280, h: 170, kind: 'ext', label: 'Corporate IdP', sub: 'external, OIDC' },
    ],
    arrows: [['web', 'gw'], ['gw', 'id'], ['gw', 'bill'], ['id', 'idp'], ['bill', 'pay'], ['bill', 'data']],
    notes: [{ id: 'n-overview', text: 'All traffic enters through the API gateway.\nInternal calls use mutual TLS.', x: 0.06, y: 0.72, width: 0.3 }],
  },
  {
    id: 'd-identity', file: 'identity-hld', title: 'Identity service HLD', width: 1600, height: 1000,
    description: 'High-level design of the identity service: login, token issue and account association.',
    heading: 'Identity service — high-level design',
    boxes: [
      { key: 'login', x: 100, y: 160, w: 300, h: 150, kind: 'edge', label: 'Login flow', sub: 'OIDC with corporate IdP',
        hotspot: { id: 'h-login', tooltip: 'How users sign in', defaultActionId: 'act-login-read', actions: [
          { id: 'act-login-read', label: 'Read description', type: 'details', text: 'Users sign in through the corporate identity provider (OpenID Connect).\nThe service never stores passwords.' },
        ] } },
      { key: 'token', x: 560, y: 160, w: 300, h: 150, kind: 'core', label: 'Token service', sub: '15-minute access tokens',
        hotspot: { id: 'h-token', tooltip: 'Issues and validates access tokens', defaultActionId: 'act-token-read', actions: [
          { id: 'act-token-read', label: 'Read description', type: 'details', text: 'Issues signed access tokens valid for 15 minutes and refresh tokens valid for 8 hours.' },
        ] } },
      { key: 'assoc', x: 540, y: 470, w: 340, h: 170, kind: 'core', label: 'Account association', sub: 'user ↔ customer accounts',
        hotspot: { id: 'h-assoc', tooltip: 'Open the detailed association design', defaultActionId: 'act-assoc-lld', actions: [
          { id: 'act-assoc-lld', label: 'Open LLD', type: 'diagram', targetDiagramId: 'd-account-lld' },
          { id: 'act-assoc-read', label: 'Read description', type: 'details', text: 'Resolves which customer accounts a signed-in user may act on.' },
        ] } },
      { key: 'dir', x: 1060, y: 470, w: 300, h: 170, kind: 'data', label: 'Directory store', sub: 'on the data platform',
        hotspot: { id: 'h-dir', tooltip: 'Where identity data is stored', defaultActionId: 'act-dir-data', actions: [
          { id: 'act-dir-data', label: 'Open data platform', type: 'diagram', targetDiagramId: 'd-data' },
        ] } },
      { key: 'idp', x: 1060, y: 160, w: 300, h: 150, kind: 'ext', label: 'Corporate IdP', sub: 'external' },
    ],
    arrows: [['login', 'token'], ['login', 'idp'], ['token', 'assoc'], ['assoc', 'dir']],
    notes: [{ id: 'n-identity', text: 'Account IDs come from the billing system of record.', x: 0.06, y: 0.8, width: 0.4 }],
  },
  {
    id: 'd-account-lld', file: 'account-lld', title: 'Account association LLD', width: 1600, height: 1000,
    description: 'Low-level design: tables and the lookup used on every request.',
    heading: 'Account association — low-level design',
    boxes: [
      { key: 'users', x: 120, y: 180, w: 360, h: 260, kind: 'data', label: 'users', sub: 'user_id • subject • email',
        hotspot: { id: 'h-users', tooltip: 'One row per signed-in person', defaultActionId: 'act-users-read', actions: [
          { id: 'act-users-read', label: 'Read description', type: 'details', text: 'Columns:\n  user_id   uuid, primary key\n  subject   text, IdP subject, unique\n  email     text' },
        ] } },
      { key: 'links', x: 620, y: 180, w: 360, h: 260, kind: 'data', label: 'account_links', sub: 'user_id • account_id • role',
        hotspot: { id: 'h-links', tooltip: 'Which accounts each user may act on', defaultActionId: 'act-links-read', actions: [
          { id: 'act-links-read', label: 'Read description', type: 'details', text: 'Columns:\n  user_id     uuid → users\n  account_id  text → billing accounts\n  role        viewer | operator | owner' },
        ] } },
      { key: 'acct', x: 1120, y: 180, w: 360, h: 260, kind: 'ext', label: 'billing.accounts', sub: 'system of record' },
      { key: 'cache', x: 620, y: 600, w: 360, h: 180, kind: 'core', label: 'Lookup cache', sub: '60 s TTL, per user',
        hotspot: { id: 'h-cache', tooltip: 'Back to the service overview', defaultActionId: 'act-cache-back', actions: [
          { id: 'act-cache-back', label: 'Open Identity HLD', type: 'diagram', targetDiagramId: 'd-identity' },
        ] } },
    ],
    arrows: [['users', 'links'], ['links', 'acct'], ['links', 'cache']],
    notes: [],
  },
  {
    id: 'd-data', file: 'data-platform', title: 'Data platform', width: 1600, height: 900,
    description: 'Shared storage used by several services; reachable from more than one diagram.',
    heading: 'Data platform — shared services',
    boxes: [
      { key: 'pg', x: 120, y: 200, w: 380, h: 200, kind: 'data', label: 'PostgreSQL cluster', sub: 'primary + 2 replicas',
        hotspot: { id: 'h-pg', tooltip: 'Relational data', defaultActionId: 'act-pg-read', actions: [
          { id: 'act-pg-read', label: 'Read description', type: 'details', text: 'Primary with two streaming replicas. Point-in-time recovery for 14 days.' },
        ] } },
      { key: 'obj', x: 620, y: 200, w: 380, h: 200, kind: 'data', label: 'Object store', sub: 'documents, exports' },
      { key: 'ev', x: 1120, y: 200, w: 380, h: 200, kind: 'data', label: 'Event stream', sub: 'account and billing events' },
    ],
    arrows: [['pg', 'obj'], ['obj', 'ev']],
    notes: [{ id: 'n-data', text: 'Backups run nightly and are restored weekly as a test.', x: 0.08, y: 0.68, width: 0.45 }],
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function svgFor(d) {
  const byKey = Object.fromEntries(d.boxes.map((b) => [b.key, b]));
  const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const edgePoint = (b, toward) => {
    const [cx, cy] = centre(b);
    const dx = toward[0] - cx; const dy = toward[1] - cy;
    const sx = (b.w / 2) / Math.max(1e-9, Math.abs(dx)); const sy = (b.h / 2) / Math.max(1e-9, Math.abs(dy));
    const s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  };
  const arrows = d.arrows.map(([a, b]) => {
    const A = byKey[a]; const B = byKey[b];
    const p = edgePoint(A, centre(B)); const q = edgePoint(B, centre(A));
    return `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="#64748b" stroke-width="3" marker-end="url(#arrow)"/>`;
  }).join('\n');
  const boxes = d.boxes.map((b) => {
    const c = PALETTE[b.kind];
    const [cx, cy] = centre(b);
    return `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${c.fill}" stroke="${c.stroke}" stroke-width="3"/>
<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="30" font-weight="700" fill="#0f172a">${esc(b.label)}</text>
<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="21" fill="#334155">${esc(b.sub || '')}</text></g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}" font-family="DejaVu Sans, Arial, sans-serif">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="0" y="0" width="${d.width}" height="78" fill="#0f172a"/>
<text x="40" y="51" font-size="32" font-weight="700" fill="#ffffff">${esc(d.heading)}</text>
${arrows}
${boxes}
</svg>`;
}

export function projectJson() {
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    schemaVersion: 1,
    projectId: 'p-customer-platform',
    title: 'Customer Platform',
    rootDiagramId: 'd-overview',
    metadata: { author: 'Portable Diagram Explorer sample' },
    assets: DIAGRAMS.map((d) => ({ id: `a-${d.file}`, path: `assets/a-${d.file}-${d.file}.png`, mimeType: 'image/png', width: d.width, height: d.height })),
    diagrams: DIAGRAMS.map((d) => ({
      id: d.id, title: d.title, assetId: `a-${d.file}`, description: d.description,
      hotspots: d.boxes.filter((b) => b.hotspot).map((b, i) => ({
        id: b.hotspot.id, label: b.label, tooltip: b.hotspot.tooltip,
        rect: { x: r6(b.x / d.width), y: r6(b.y / d.height), width: r6(b.w / d.width), height: r6(b.h / d.height) },
        zIndex: i + 1, defaultActionId: b.hotspot.defaultActionId, actions: b.hotspot.actions,
      })),
      annotations: d.notes,
    })),
    settings: { tooltipDelayMs: 350, showHotspotHints: true },
  };
}
