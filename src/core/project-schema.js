// The canonical project schema (spec §9, design D5). This module is the single
// source; schema/project.schema.json is generated from it by the build and a unit
// test keeps the two identical. `description` texts double as the "why" of every
// validation issue, so they are written for the person fixing the file.

const ID = {
  type: 'string',
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$',
  examples: ['d-overview'],
  description: 'An opaque, stable identifier: 1–64 letters, digits, "-" or "_", starting with a letter or digit. It never encodes parentage or a filename.',
};
const FRACTION = (what) => ({
  type: 'number', minimum: 0, maximum: 1, examples: [0.25],
  description: `${what}, as a fraction of the image size (0 = left/top edge, 1 = right/bottom edge).`,
});
const SIZE = (what) => ({
  type: 'number', exclusiveMinimum: 0, maximum: 1, examples: [0.18],
  description: `${what}, as a positive fraction of the image size; position plus size may not exceed 1.`,
});

export const PROJECT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Portable Diagram Explorer project',
  description: 'Canonical project data: diagrams over imported raster images, clickable rectangular hotspots and text annotations.',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'projectId', 'title', 'rootDiagramId', 'assets', 'diagrams'],
  properties: {
    schemaVersion: { type: 'integer', const: 1, examples: [1], description: 'Version of this file format. This application reads version 1.' },
    projectId: ID,
    title: { type: 'string', minLength: 1, maxLength: 200, examples: ['Customer Platform'], description: 'Project title, shown in the presentation and used for file names.' },
    rootDiagramId: { ...ID, description: 'ID of the overview diagram the presentation opens on. It must name a diagram in "diagrams".' },
    metadata: {
      type: 'object', additionalProperties: false,
      description: 'Optional descriptive metadata. Never used as an identity key.',
      properties: {
        author: { type: 'string', maxLength: 200, examples: ['Architecture team'], description: 'Optional author name.' },
        createdAt: { type: 'string', maxLength: 40, pattern: '^\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z$', examples: ['2026-11-06T12:00:00Z'], description: 'Optional UTC timestamp.' },
        modifiedAt: { type: 'string', maxLength: 40, pattern: '^\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z$', examples: ['2026-11-06T12:00:00Z'], description: 'Optional UTC timestamp.' },
      },
    },
    assets: {
      type: 'array', maxItems: 500,
      description: 'Image files used by diagrams. Several diagrams may share one asset.',
      items: { $ref: '#/$defs/asset' },
    },
    diagrams: {
      type: 'array', minItems: 1, maxItems: 500,
      description: 'The diagrams. Navigation between them is a graph: cross-links and cycles are allowed.',
      items: { $ref: '#/$defs/diagram' },
    },
    settings: {
      type: 'object', additionalProperties: false,
      description: 'Presentation settings.',
      properties: {
        tooltipDelayMs: { type: 'integer', minimum: 0, maximum: 5000, examples: [350], description: 'Delay before a hover tooltip appears, in milliseconds.' },
        showHotspotHints: { type: 'boolean', examples: [true], description: 'Whether hotspot outlines are visible in presentation mode.' },
      },
    },
  },
  $defs: {
    asset: {
      type: 'object', additionalProperties: false,
      required: ['id', 'path', 'mimeType', 'width', 'height'],
      description: 'One imported image file, stored unchanged.',
      properties: {
        id: ID,
        path: { type: 'string', pattern: '^assets/[a-z0-9][a-z0-9._-]{0,120}$', examples: ['assets/a-overview-overview.png'], description: 'Package-relative path of the image file: "assets/" followed by lowercase letters, digits, ".", "_" or "-". No absolute or parent paths.' },
        mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'], examples: ['image/png'], description: 'Image type. Version 1 accepts PNG, JPEG and WebP only.' },
        width: { type: 'integer', minimum: 1, maximum: 100000, examples: [1920], description: 'Displayed width in pixels after orientation is applied.' },
        height: { type: 'integer', minimum: 1, maximum: 100000, examples: [1080], description: 'Displayed height in pixels after orientation is applied.' },
      },
    },
    diagram: {
      type: 'object', additionalProperties: false,
      required: ['id', 'title', 'assetId', 'hotspots', 'annotations'],
      description: 'One diagram: an image plus its hotspots and annotations.',
      properties: {
        id: ID,
        title: { type: 'string', minLength: 1, maxLength: 200, examples: ['Platform overview'], description: 'Diagram title, shown in breadcrumbs and the modal header.' },
        assetId: { ...ID, description: 'ID of the image asset this diagram displays. It must name an entry in "assets".' },
        description: { type: 'string', maxLength: 20000, examples: ['Main systems and their connections.'], description: 'Optional plain-text description of the diagram.' },
        alignmentReviewRequired: { type: 'boolean', examples: [false], description: 'Set when the image was replaced with different dimensions; the author must review hotspot alignment before export.' },
        hotspots: { type: 'array', maxItems: 1000, items: { $ref: '#/$defs/hotspot' }, description: 'Clickable regions on this diagram.' },
        annotations: { type: 'array', maxItems: 500, items: { $ref: '#/$defs/annotation' }, description: 'Visible text notes placed on this diagram.' },
      },
    },
    hotspot: {
      type: 'object', additionalProperties: false,
      required: ['id', 'label', 'tooltip', 'rect', 'zIndex', 'actions'],
      description: 'A rectangular clickable region over a component.',
      properties: {
        id: ID,
        label: { type: 'string', minLength: 1, maxLength: 120, examples: ['Identity service'], description: 'Accessible name of the component, read by screen readers and shown in menus.' },
        tooltip: { type: 'string', maxLength: 500, examples: ['Authentication and account association'], description: 'Short text shown on hover and keyboard focus.' },
        rect: {
          type: 'object', additionalProperties: false,
          required: ['x', 'y', 'width', 'height'],
          description: 'Region in normalized image coordinates.',
          properties: { x: FRACTION('Left edge'), y: FRACTION('Top edge'), width: SIZE('Width'), height: SIZE('Height') },
        },
        zIndex: { type: 'integer', minimum: 0, maximum: 100000, examples: [1], description: 'Stacking order; where hotspots overlap, the highest receives the click.' },
        defaultActionId: { type: ['string', 'null'], maxLength: 64, examples: [null], description: 'ID of the action a click performs. Null or absent means a click shows the action menu.' },
        actions: { type: 'array', maxItems: 20, items: { $ref: '#/$defs/action' }, description: 'What the component offers, in menu order.' },
      },
    },
    action: {
      description: 'One menu choice: open a diagram, or show a text description.',
      oneOf: [{ $ref: '#/$defs/diagramAction' }, { $ref: '#/$defs/detailsAction' }],
    },
    diagramAction: {
      type: 'object', additionalProperties: false,
      required: ['id', 'label', 'type', 'targetDiagramId'],
      description: 'Opens another diagram in the drill-down modal.',
      properties: {
        id: ID,
        label: { type: 'string', minLength: 1, maxLength: 120, examples: ['Open HLD'], description: 'Menu label.' },
        type: { type: 'string', const: 'diagram', examples: ['diagram'], description: 'Action type. Version 1 supports "diagram" and "details" only.' },
        targetDiagramId: { ...ID, description: 'ID of the diagram to open. It must name a diagram in "diagrams".' },
      },
    },
    detailsAction: {
      type: 'object', additionalProperties: false,
      required: ['id', 'label', 'type', 'text'],
      description: 'Shows plain text in the details panel.',
      properties: {
        id: ID,
        label: { type: 'string', minLength: 1, maxLength: 120, examples: ['Read description'], description: 'Menu label.' },
        type: { type: 'string', const: 'details', examples: ['details'], description: 'Action type. Version 1 supports "diagram" and "details" only.' },
        text: { type: 'string', minLength: 1, maxLength: 20000, examples: ['Authenticates users.'], description: 'Plain text shown in the details panel; line breaks are kept.' },
      },
    },
    annotation: {
      type: 'object', additionalProperties: false,
      required: ['id', 'text', 'x', 'y', 'width'],
      description: 'Visible text placed on the diagram, separate from tooltips.',
      properties: {
        id: ID,
        text: { type: 'string', minLength: 1, maxLength: 2000, examples: ['Account IDs come from the internal system.'], description: 'Plain text; line breaks are kept.' },
        x: FRACTION('Left edge'), y: FRACTION('Top edge'), width: SIZE('Text box width'),
      },
    },
  },
};
