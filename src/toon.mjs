// A subset of TOON (https://toonformat.dev): enough to carry one card.
//   key: value                 primitive (string, number, true, false, null)
//   key[N]: a,b,c              primitive array, comma-delimited
//   key[N]:                    primitive array in list form, N lines of "  - value"
//   key[N]{f1,f2}:             tabular array, N rows of "  v1,v2"
// Strings are quoted when they would otherwise be ambiguous; quoted strings
// use \" \\ \n \r \t escapes. Nested objects are not supported.
// The decoder is lenient where an agent is likely to slip: an unquoted lone value
// ("key: a, b" or "- a, b") is one string, commas included.

export class ToonError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'ToonError';
    this.line = line;
  }
}

const KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const HEADER = /^([A-Za-z_][A-Za-z0-9_.]*)(?:\[(\d+)\](?:\{([^}]*)\})?)?:(.*)$/;

function needsQuotes(s) {
  return s === '' || s !== s.trim() || /^(true|false|null)$/.test(s) || NUMBER.test(s) || /[:,"\\[\]{}\n\r\t]/.test(s) || s.startsWith('-');
}

function quote(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function encodeValue(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new ToonError(`cannot encode ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return needsQuotes(v) ? quote(v) : v;
  throw new ToonError(`cannot encode a ${typeof v} as a primitive`);
}

const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function encode(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (!KEY.test(key)) throw new ToonError(`"${key}" is not a valid key`);
    if (!Array.isArray(value)) {
      lines.push(`${key}: ${encodeValue(value)}`);
    } else if (value.length === 0) {
      lines.push(`${key}[0]:`);
    } else if (value.every(isRow)) {
      const fields = Object.keys(value[0]);
      lines.push(`${key}[${value.length}]{${fields.join(',')}}:`);
      for (const row of value) lines.push(`  ${fields.map((f) => encodeValue(row[f] ?? null)).join(',')}`);
    } else {
      lines.push(`${key}[${value.length}]: ${value.map(encodeValue).join(',')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function primitive(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (NUMBER.test(raw)) return Number(raw);
  return raw;
}

const ESCAPES = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' };

// Reads the quoted string that starts at text[i]; returns [string, index after the closing quote].
function readQuoted(text, i, line) {
  let s = '';
  i++;
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\') {
      const next = text[i + 1];
      if (!Object.hasOwn(ESCAPES, next ?? '')) throw new ToonError(`unknown escape \\${next ?? ''}`, line);
      s += ESCAPES[next];
      i += 2;
    } else {
      s += text[i++];
    }
  }
  if (text[i] !== '"') throw new ToonError('unterminated quoted string', line);
  return [s, i + 1];
}

// A lone value ("key: value" or "- value"). Unquoted, it runs to the end of the line, commas and all.
function scalar(text, line) {
  const t = text.trim();
  if (!t.startsWith('"')) return primitive(t);
  const [s, end] = readQuoted(t, 0, line);
  if (t.slice(end).trim()) throw new ToonError('unexpected text after a quoted string', line);
  return s;
}

// Splits "a,"b, c",3" into typed values, honouring quotes.
function splitValues(text, line) {
  const values = [];
  let i = 0;
  while (true) {
    while (text[i] === ' ') i++;
    if (text[i] === '"') {
      let s;
      [s, i] = readQuoted(text, i, line);
      while (text[i] === ' ') i++;
      values.push(s);
    } else {
      const end = text.indexOf(',', i);
      const raw = (end === -1 ? text.slice(i) : text.slice(i, end)).trim();
      if (raw.includes('"')) throw new ToonError(`stray quote in ${JSON.stringify(raw)}; quote the whole value`, line);
      values.push(primitive(raw));
      i = end === -1 ? text.length : end;
    }
    if (i >= text.length) break;
    if (text[i] !== ',') throw new ToonError(`expected a comma after a value, found ${JSON.stringify(text[i])}`, line);
    i++;
  }
  return values;
}

export function decode(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = {};
  let i = 0;
  const take = (count, what, header) => {
    const rows = [];
    while (rows.length < count && i < lines.length && lines[i].startsWith('  ')) rows.push({ text: lines[i].slice(2), line: ++i });
    if (rows.length !== count) {
      throw new ToonError(`${what}[${count}] declares ${count} ${count === 1 ? 'row' : 'rows'} but ${rows.length} follow`, header);
    }
    return rows;
  };
  while (i < lines.length) {
    const lineNo = i + 1;
    const raw = lines[i++];
    if (!raw.trim()) continue;
    if (raw.startsWith(' ')) throw new ToonError('unexpected indented line (more rows than the [N] above declares?)', lineNo);
    const m = raw.match(HEADER);
    if (!m) throw new ToonError(`expected "key: value", got ${JSON.stringify(raw)}`, lineNo);
    const [, key, count, fields, rest] = m;
    if (Object.hasOwn(out, key)) throw new ToonError(`duplicate key "${key}"`, lineNo);
    if (rest && !rest.startsWith(' ')) throw new ToonError(`put a space after "${key}:"`, lineNo);
    const after = rest.trim();
    if (count === undefined) {
      if (!rest) throw new ToonError(`"${key}:" has no value (nested objects are not supported)`, lineNo);
      out[key] = scalar(after, lineNo);
      continue;
    }
    const n = Number(count);
    if (fields !== undefined) {
      if (after) throw new ToonError(`rows for ${key}[${n}] go on the following lines`, lineNo);
      const names = fields.split(',').map((f) => f.trim());
      if (names.some((f) => !KEY.test(f))) throw new ToonError(`bad field list {${fields}}`, lineNo);
      if (new Set(names).size !== names.length) throw new ToonError(`duplicate field in {${fields}}`, lineNo);
      out[key] = take(n, key, lineNo).map(({ text: row, line }) => {
        const values = splitValues(row, line);
        if (values.length !== names.length) {
          throw new ToonError(`row has ${values.length} values but ${key} has ${names.length} fields (${names.join(', ')}); quote values that contain commas`, line);
        }
        return Object.fromEntries(names.map((f, k) => [f, values[k]]));
      });
    } else if (after) {
      const values = splitValues(after, lineNo);
      if (values.length !== n) throw new ToonError(`${key}[${n}] declares ${n} values but has ${values.length}; quote values that contain commas`, lineNo);
      out[key] = values;
    } else {
      out[key] = take(n, key, lineNo).map(({ text: row, line }) => {
        if (!row.startsWith('- ')) throw new ToonError(`list items under ${key}[${n}] start with "- "`, line);
        return scalar(row.slice(2), line);
      });
    }
  }
  return out;
}
