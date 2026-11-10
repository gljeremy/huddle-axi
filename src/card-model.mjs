// A card as plain data, and its two encodings: TOON for the agent, restricted HTML for the file.
// The browser runtime builds the same shape from the DOM (toModel in runtime.js).
//
//   id, kind, status?, severity?, progress?      card attributes
//   title                                         <h3> (every kind except html)
//   value, display                                <data value="…">display</data>
//   caption                                       <small>
//   body[]                                        <p> each
//   bullets[]                                     <ul><li>
//   options[]{label,detail,votes,chosen}          <ol><li data-votes data-chosen>label<small>detail</small>
//   meta[]{key,value}                             <dl><dt>key</dt><dd>value</dd>
//   html                                          kind html only: the card's inner markup
// Text fields are inline HTML: b, strong, em, i, code, a and br are allowed, and a literal < is &lt;.
import { KINDS, RULES } from './rules.mjs';
import { ToonError, decode, encode } from './toon.mjs';

export class CardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CardError';
  }
}

const TEXT = ['title', 'value', 'display', 'caption', 'html'];
const LISTS = ['body', 'bullets'];
const KEYS = new Set(['id', 'kind', 'status', 'severity', 'progress', ...TEXT, ...LISTS, 'options', 'meta']);
const ID = new RegExp(RULES.cardAttrs['data-card']);

const asText = (v, where) => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new CardError(`${where} must be text`);
};

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Checks and normalizes a card object (from TOON or from the browser).
export function normalizeCard(input) {
  const unknown = Object.keys(input).filter((k) => !KEYS.has(k));
  if (unknown.length) throw new CardError(`unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  const card = {};
  card.id = asText(input.id ?? '', 'id');
  if (!ID.test(card.id)) throw new CardError(`id "${card.id}" is not a valid card id`);
  card.kind = asText(input.kind ?? '', 'kind');
  if (!KINDS.includes(card.kind)) throw new CardError(`kind must be one of ${KINDS.join(', ')}`);
  for (const [key, allowed] of [['status', ['open', 'decided']], ['severity', ['high', 'medium', 'low']]]) {
    if (input[key] == null) continue;
    if (!allowed.includes(input[key])) throw new CardError(`${key} must be ${allowed.join(' or ')}`);
    card[key] = input[key];
  }
  if (input.progress != null) {
    if (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > 100) throw new CardError('progress must be a whole number from 0 to 100');
    card.progress = input.progress;
  }
  if (card.kind === 'html') {
    const extra = [...TEXT, ...LISTS, 'options', 'meta'].filter((k) => k !== 'html' && input[k] != null);
    if (extra.length) throw new CardError(`an html card carries only html, not ${extra.join(', ')}`);
    card.html = asText(input.html ?? '', 'html');
    return card;
  }
  if (input.html != null) throw new CardError('only html cards have an html field');
  for (const key of ['title', 'value', 'display', 'caption']) {
    if (input[key] != null) card[key] = asText(input[key], key);
  }
  if (!card.title?.trim()) throw new CardError('a card needs a title');
  for (const key of LISTS) {
    if (input[key] == null) continue;
    if (!Array.isArray(input[key])) throw new CardError(`${key} must be a list`);
    card[key] = input[key].map((v, i) => asText(v, `${key}[${i}]`));
  }
  if (input.options != null) {
    if (!Array.isArray(input.options)) throw new CardError('options must be a list');
    card.options = input.options.map((o, i) => {
      if (o === null || typeof o !== 'object') throw new CardError(`options[${i}] must have label, detail, votes and chosen`);
      const votes = o.votes ?? null;
      if (votes !== null && (!Number.isInteger(votes) || votes < 0 || votes > 9999)) throw new CardError(`options[${i}].votes must be a whole number or null`);
      if (o.chosen != null && typeof o.chosen !== 'boolean') throw new CardError(`options[${i}].chosen must be true or false`);
      return { label: asText(o.label ?? '', `options[${i}].label`), detail: asText(o.detail ?? '', `options[${i}].detail`), votes, chosen: o.chosen === true };
    });
  }
  if (input.meta != null) {
    if (!Array.isArray(input.meta)) throw new CardError('meta must be a list');
    card.meta = input.meta.map((m, i) => {
      if (m === null || typeof m !== 'object') throw new CardError(`meta[${i}] must have key and value`);
      return { key: asText(m.key ?? '', `meta[${i}].key`), value: asText(m.value ?? '', `meta[${i}].value`) };
    });
  }
  return card;
}

export function cardToToon(input) {
  const c = normalizeCard(input);
  return encode({
    id: c.id,
    kind: c.kind,
    status: c.status,
    severity: c.severity,
    progress: c.progress,
    title: c.title,
    value: c.value,
    display: c.display,
    caption: c.caption,
    body: c.body,
    bullets: c.bullets,
    options: c.options,
    meta: c.meta,
    html: c.html,
  });
}

// Parses a card the agent wrote. Throws ToonError for syntax, CardError for content.
export function toonToCard(text) {
  return normalizeCard(decode(text));
}

export function cardToHtml(input) {
  const c = normalizeCard(input);
  const attrs = [`data-card="${c.id}"`, `data-kind="${c.kind}"`];
  if (c.status) attrs.push(`data-status="${c.status}"`);
  if (c.severity) attrs.push(`data-severity="${c.severity}"`);
  if (c.progress != null) attrs.push(`data-progress="${c.progress}"`);
  const out = [`<section ${attrs.join(' ')}>`];
  if (c.kind === 'html') {
    out.push(c.html);
  } else {
    out.push(`<h3>${c.title}</h3>`);
    if (c.value != null || c.display != null) {
      out.push(`<data${c.value == null ? '' : ` value="${escapeAttr(c.value)}"`}>${c.display ?? c.value}</data>`);
    }
    if (c.caption) out.push(`<small>${c.caption}</small>`);
    for (const p of c.body ?? []) out.push(`<p>${p}</p>`);
    if (c.bullets?.length) out.push(`<ul>\n${c.bullets.map((b) => `<li>${b}</li>`).join('\n')}\n</ul>`);
    if (c.options?.length) {
      const items = c.options.map((o) => {
        const votes = o.votes == null ? '' : ` data-votes="${o.votes}"`;
        return `<li${votes}${o.chosen ? ' data-chosen' : ''}>${o.label}${o.detail ? `<small>${o.detail}</small>` : ''}</li>`;
      });
      out.push(`<ol>\n${items.join('\n')}\n</ol>`);
    }
    if (c.meta?.length) out.push(`<dl>${c.meta.map((m) => `<dt>${m.key}</dt><dd>${m.value}</dd>`).join('')}</dl>`);
  }
  out.push('</section>');
  return out.join('\n');
}

export { ToonError };
