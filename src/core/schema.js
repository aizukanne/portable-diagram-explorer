// A deliberately small JSON Schema (2020-12 subset) interpreter (design D5).
//
// Supported keywords are listed in KEYWORDS. A schema using any other keyword is a
// programming error and throws when compiled, so a rule can never be written into
// the schema and silently not enforced. Every failure becomes an Issue that names
// the path, the value received, the accepted form with an example, and why.

const KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'examples',
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'const',
  'minimum', 'maximum', 'exclusiveMinimum', 'minLength', 'maxLength', 'pattern',
  'items', 'minItems', 'maxItems', 'oneOf',
]);

export function makeIssue(code, path, received, expected, why, fix, severity = 'error') {
  return { code, severity, path, received: preview(received), expected, why, fix };
}

export function preview(v) {
  if (v === undefined) return '(absent)';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  let s;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

export function assertSchemaKeywords(schema, where = '#') {
  if (schema === null || typeof schema !== 'object') return;
  if (Array.isArray(schema)) { schema.forEach((s, i) => assertSchemaKeywords(s, `${where}/${i}`)); return; }
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k)) throw new Error(`schema keyword "${k}" at ${where} is not supported by the validator`);
  }
  for (const k of ['properties', '$defs']) {
    if (schema[k]) for (const [n, s] of Object.entries(schema[k])) assertSchemaKeywords(s, `${where}/${k}/${n}`);
  }
  if (schema.items) assertSchemaKeywords(schema.items, `${where}/items`);
  if (schema.oneOf) schema.oneOf.forEach((s, i) => assertSchemaKeywords(s, `${where}/oneOf/${i}`));
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(t, v) {
  const actual = typeOf(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (t === 'integer') return actual === 'integer';
  return actual === t;
}

function example(s) {
  return s.examples && s.examples.length ? ` For example: ${JSON.stringify(s.examples[0])}.` : '';
}

function join(path, key) {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function resolve(root, s) {
  if (!s.$ref) return s;
  const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
  if (!m || !root.$defs || !root.$defs[m[1]]) throw new Error(`unresolvable $ref ${s.$ref}`);
  return root.$defs[m[1]];
}

export function validateSchema(root, value) {
  assertSchemaKeywords(root);
  const issues = [];
  walk(root, root, value, '', issues);
  return issues;
}

function walk(root, schemaIn, v, path, issues) {
  const s = resolve(root, schemaIn);
  const why = s.description || 'Required by the project format.';
  const at = path || '(project)';

  if (s.oneOf) {
    const branches = s.oneOf.map((b) => resolve(root, b));
    // Discriminate on a `type` const when every branch declares one: this gives
    // the author the error from the branch they meant, not from all of them.
    const consts = branches.map((b) => b.properties && b.properties.type && b.properties.type.const);
    if (consts.every((c) => typeof c === 'string') && v && typeof v === 'object' && !Array.isArray(v)) {
      const i = consts.indexOf(v.type);
      if (i < 0) {
        issues.push(makeIssue('E_SCHEMA_ENUM', join(path, 'type'), v.type,
          `one of ${consts.map((c) => JSON.stringify(c)).join(', ')}`,
          branches[0].properties.type.description,
          `Set "type" to ${consts.map((c) => JSON.stringify(c)).join(' or ')}. Other action types are not supported and are never interpreted.`));
        return;
      }
      walk(root, branches[i], v, path, issues);
      return;
    }
    const passing = branches.filter((b) => { const t = []; walk(root, b, v, path, t); return t.length === 0; });
    if (passing.length !== 1) {
      issues.push(makeIssue('E_SCHEMA_TYPE', at, v, 'exactly one of the allowed shapes', why, 'Match exactly one allowed shape.'));
    }
    return;
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(t, v))) {
      const finiteNote = typeof v === 'number' && !Number.isFinite(v) ? ' (only finite numbers are allowed)' : '';
      issues.push(makeIssue('E_SCHEMA_TYPE', at, v, `${types.join(' or ')}${finiteNote}.${example(s)}`, why,
        `Replace the value with a ${types.join(' or ')}.${example(s)}`));
      return;
    }
  }
  if (s.const !== undefined && v !== s.const) {
    issues.push(makeIssue('E_SCHEMA_ENUM', at, v, JSON.stringify(s.const), why, `Set the value to ${JSON.stringify(s.const)}.`));
  }
  if (s.enum && !s.enum.includes(v)) {
    issues.push(makeIssue('E_SCHEMA_ENUM', at, v, `one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`, why,
      `Use one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}.`));
  }
  if (typeof v === 'number') {
    const lo = s.minimum !== undefined ? `>= ${s.minimum}` : s.exclusiveMinimum !== undefined ? `> ${s.exclusiveMinimum}` : null;
    const hi = s.maximum !== undefined ? `<= ${s.maximum}` : null;
    const bad = (s.minimum !== undefined && v < s.minimum) || (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) || (s.maximum !== undefined && v > s.maximum);
    if (bad) {
      const range = [lo, hi].filter(Boolean).join(' and ');
      issues.push(makeIssue('E_SCHEMA_RANGE', at, v, `a number ${range}.${example(s)}`, why, `Change the value to a number ${range}.${example(s)}`));
    }
  }
  if (typeof v === 'string') {
    if ((s.minLength !== undefined && v.length < s.minLength) || (s.maxLength !== undefined && v.length > s.maxLength)) {
      const range = s.minLength && s.maxLength !== undefined ? `${s.minLength}–${s.maxLength} characters`
        : s.maxLength !== undefined ? `at most ${s.maxLength} characters` : `at least ${s.minLength} character(s)`;
      issues.push(makeIssue('E_SCHEMA_LENGTH', at, v, `${range} (received ${v.length}).${example(s)}`, why,
        v.length < (s.minLength || 0) ? `Enter a value.${example(s)}` : `Shorten the text to ${s.maxLength} characters or fewer.`));
    }
    if (s.pattern && !new RegExp(s.pattern).test(v)) {
      issues.push(makeIssue('E_SCHEMA_PATTERN', at, v, `text matching ${s.pattern}.${example(s)}`, why, `Rewrite the value in the accepted form.${example(s)}`));
    }
  }
  if (Array.isArray(v)) {
    if ((s.minItems !== undefined && v.length < s.minItems) || (s.maxItems !== undefined && v.length > s.maxItems)) {
      issues.push(makeIssue('E_SCHEMA_COUNT', at, `${v.length} item(s)`,
        `${s.minItems !== undefined ? `at least ${s.minItems}` : ''}${s.minItems !== undefined && s.maxItems !== undefined ? ' and ' : ''}${s.maxItems !== undefined ? `at most ${s.maxItems}` : ''} item(s)`,
        why, v.length < (s.minItems || 0) ? 'Add the missing item(s).' : `Remove items until there are at most ${s.maxItems}.`));
    }
    if (s.items) v.forEach((item, i) => walk(root, s.items, item, join(path, i), issues));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const props = s.properties || {};
    for (const r of s.required || []) {
      if (!(r in v)) {
        const ps = resolve(root, props[r] || {});
        issues.push(makeIssue('E_SCHEMA_REQUIRED', join(path, r), undefined, `a value.${example(ps)}`,
          ps.description || why, `Add "${r}".${example(ps)}`));
      }
    }
    for (const [k, val] of Object.entries(v)) {
      if (props[k]) walk(root, props[k], val, join(path, k), issues);
      else if (s.additionalProperties === false) {
        issues.push(makeIssue('E_SCHEMA_UNKNOWN', join(path, k), val, `only ${Object.keys(props).map((p) => `"${p}"`).join(', ')}`,
          'Unknown properties are rejected so that nothing in a project file is silently ignored or interpreted.',
          `Remove "${k}", or check its spelling against the allowed names.`));
      }
    }
  }
}
