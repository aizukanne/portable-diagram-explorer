// The validated export envelope (spec §12, design D13). Exceeding it is a
// warning: the export still works, but it is outside what has been tested.

export const ENVELOPE = Object.freeze({
  diagrams: 50,
  hotspots: 1000,
  hotspotsPerScene: 100,
  imageBytes: 50 * 1024 * 1024,
});

export function referencedAssetIds(project) {
  return new Set(project.diagrams.map((d) => d.assetId));
}

export function measureEnvelope(project, assetBytes) {
  const used = referencedAssetIds(project);
  let imageBytes = 0;
  for (const id of used) imageBytes += assetBytes.get(id) ? assetBytes.get(id).length : 0;
  const hotspots = project.diagrams.reduce((n, d) => n + d.hotspots.length, 0);
  const busiest = project.diagrams.reduce((m, d) => (d.hotspots.length > m.n ? { n: d.hotspots.length, title: d.title } : m), { n: 0, title: '' });
  const m = { diagrams: project.diagrams.length, hotspots, maxPerScene: busiest.n, imageBytes, warnings: [] };
  const why = 'Projects beyond the tested envelope may open slowly or exhaust memory on the recipient\'s computer.';
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
  if (m.diagrams > ENVELOPE.diagrams) m.warnings.push({ code: 'W_ENVELOPE_DIAGRAMS', severity: 'warning', path: 'diagrams', received: `${m.diagrams} diagrams`, expected: `at most ${ENVELOPE.diagrams}`, why, fix: 'Split the project, or test the export on the recipient\'s kind of computer.' });
  if (m.hotspots > ENVELOPE.hotspots) m.warnings.push({ code: 'W_ENVELOPE_HOTSPOTS', severity: 'warning', path: 'diagrams', received: `${m.hotspots} hotspots`, expected: `at most ${ENVELOPE.hotspots} in total`, why, fix: 'Split the project, or test the export on the recipient\'s kind of computer.' });
  if (m.maxPerScene > ENVELOPE.hotspotsPerScene) m.warnings.push({ code: 'W_ENVELOPE_SCENE', severity: 'warning', path: 'diagrams', received: `${m.maxPerScene} hotspots on "${busiest.title}"`, expected: `at most ${ENVELOPE.hotspotsPerScene} on one diagram`, why, fix: 'Move detail into child diagrams.' });
  if (m.imageBytes > ENVELOPE.imageBytes) m.warnings.push({ code: 'W_ENVELOPE_BYTES', severity: 'warning', path: 'assets', received: mb(m.imageBytes), expected: `at most ${mb(ENVELOPE.imageBytes)} of images`, why: `${why} The presentation file will be about a third larger than the images because they are embedded as text.`, fix: 'Export smaller or more compressed images (JPEG/WebP for screenshots).' });
  return m;
}
