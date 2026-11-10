// The card rules: one source for the runtime's validator and the protocol text
// that travels inside every board for whichever agent edits it next.

export const KINDS = ['goal', 'decision', 'risk', 'metric', 'idea', 'action', 'note', 'html'];

export const RULES = {
  kinds: KINDS,
  // Attributes allowed on a card's <section>, with the pattern each value must match.
  cardAttrs: {
    'data-card': '^[a-z][a-z0-9-]{0,31}$',
    'data-kind': `^(${KINDS.join('|')})$`,
    'data-status': '^(open|decided)$',
    'data-severity': '^(high|medium|low)$',
    'data-progress': '^(100|[1-9]?[0-9])$',
  },
  // Tags allowed inside every card except kind "html", with the attributes each may carry.
  tags: {
    h3: [], p: [], ul: [], ol: [], li: ['data-votes', 'data-chosen'],
    small: [], b: [], strong: [], em: [], i: [], code: [], br: [],
    dl: [], dt: [], dd: [], data: ['value'], a: ['href'],
  },
  attrPatterns: {
    'data-votes': '^[0-9]{1,4}$',
    'data-chosen': '^$',
    value: '^.{0,64}$',
    href: '^(https?:|mailto:|#)',
  },
  // Kind "html" is the escape hatch: any markup except these tags, on* handlers and unsafe URLs.
  blockedInHtml: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'style', 'template', 'form', 'input', 'button', 'textarea', 'select', 'noscript'],
};

export function protocolText() {
  const tags = Object.entries(RULES.tags)
    .map(([tag, attrs]) => (attrs.length ? `${tag} (${attrs.join(', ')})` : tag))
    .join(', ');
  return [
    'This file is a huddle-axi board: one portable HTML file with its runtime, cards and context inlined.',
    'Cards are <section data-card="<id>" data-kind="<kind>"> elements inside <div data-lane> groups.',
    'To change a card, replace that one <section> and nothing else. Keep its data-card id.',
    `Kinds: ${KINDS.join(', ')}.`,
    'Section attributes: data-card, data-kind, data-status (open|decided), data-severity (high|medium|low), data-progress (0-100).',
    `Inside every kind except html: exactly one h3 title as the first element, then only these tags: ${tags}. No class or style attributes. href must be http, https, mailto or #.`,
    'Kind html is the escape hatch for diagrams and one-offs: any markup except script, iframe, object, embed, form controls and style blocks, with no on* attributes and no javascript: URLs.',
    'Context "threads" holds the facilitator\'s notes per card id. "revisions" logs every card change.',
    'Never edit the <style> or <script> blocks marked data-huddle-runtime.',
  ].join('\n');
}
