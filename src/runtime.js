// huddle-axi board runtime. Inlined into every board file at build time.
// Swaps one card in place (no reload), keeps the context block, and saves the file.
(() => {
  'use strict';
  if (typeof window.huddle?.patch === 'function') return;

  const RULES = /*HUDDLE_RULES*/ null;
  const VERSION = /*HUDDLE_VERSION*/ '0.0.0';
  const FRESH_MS = 2500;
  const BUSY_MS = 120_000;
  const AUTOSAVE_MS = 300;
  const MAX_REVISIONS = 200;
  // Served by `huddle-axi open`: notes go to the agent, patches arrive over SSE, saves go through the server.
  const live = location.protocol === 'http:' && /^\/b\/[a-f0-9]{32}\/$/.test(location.pathname);

  class HuddleError extends Error {
    constructor(message) {
      super(message);
      this.name = 'HuddleError';
    }
  }

  const board = document.querySelector('[data-huddle-board]');
  const contextEl = document.querySelector('script[data-huddle-context]');
  if (!RULES || !board || !contextEl) {
    console.error('huddle: this page is missing its rules, board or context block');
    return;
  }

  let context;
  try {
    context = JSON.parse(contextEl.textContent || '{}');
  } catch (err) {
    console.error('huddle: the context block is not valid JSON', err);
    context = {};
  }
  context.threads = Object.assign(Object.create(null), context.threads);
  context.revisions ||= [];

  const cardAttr = Object.fromEntries(Object.entries(RULES.cardAttrs).map(([k, v]) => [k, new RegExp(v)]));
  const attrPattern = Object.fromEntries(Object.entries(RULES.attrPatterns).map(([k, v]) => [k, new RegExp(v, 'i')]));
  const blocked = new Set(RULES.blockedInHtml);
  const urlAttrs = new Set(['href', 'src', 'xlink:href', 'xml:base', 'action', 'formaction', 'poster', 'background', 'cite', 'longdesc', 'usemap']);
  const urlLists = new Set(['srcset', 'imagesrcset', 'ping']);
  const cssAttrs = new Set(['style', 'fill', 'stroke', 'filter', 'clip-path', 'mask', 'cursor', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'color-profile', 'shape-inside', 'shape-subtract', 'offset-path']);

  let dirty = false;
  let generation = 0;
  let saving = null;
  let problems = [];
  let fileHandle = null;
  let autosaveTimer;
  let connection = live ? 'connecting' : null;
  const freshTimers = new WeakMap();
  const busyTimers = new WeakMap();

  const cardEl = (id) => board.querySelector(`[data-card="${CSS.escape(id)}"]`);
  const allCards = () => [...board.querySelectorAll('[data-card]')];

  // ---------- validation ----------

  function parseSection(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    const nodes = [...t.content.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
    if (nodes.length !== 1 || nodes[0].localName !== 'section') {
      throw new HuddleError('a card must be exactly one <section data-card="…" data-kind="…"> element');
    }
    const section = nodes[0];
    for (const { name, value } of section.attributes) {
      if (!Object.hasOwn(cardAttr, name)) throw new HuddleError(`card attribute ${name} is not allowed`);
      if (!cardAttr[name].test(value)) throw new HuddleError(`card attribute ${name}="${value}" is not valid`);
    }
    if (!section.hasAttribute('data-card')) throw new HuddleError('a card needs a data-card id');
    if (!section.hasAttribute('data-kind')) throw new HuddleError('a card needs a data-kind');
    checkContent(section);
    return section;
  }

  function checkContent(section) {
    const kind = section.dataset.kind;
    const id = section.dataset.card;
    for (const el of section.querySelectorAll('*')) {
      const tag = el.localName.toLowerCase();
      for (const name of RULES.reservedDescendantAttrs) {
        if (el.hasAttribute(name)) throw new HuddleError(`${name} is reserved on card descendants (#${id})`);
      }
      if (kind === 'html') {
        if (blocked.has(tag)) throw new HuddleError(`<${tag}> is not allowed, even in an html card (#${id})`);
        for (const { name, value } of el.attributes) {
          const n = name.toLowerCase();
          if (n.startsWith('on')) throw new HuddleError(`${name} handlers are not allowed (#${id})`);
          if (n === 'srcdoc' || urlLists.has(n)) throw new HuddleError(`${name} is not allowed (#${id})`);
          if (cssAttrs.has(n) && /\\|\/\*|(?:url|image|image-set|-webkit-image-set|src)\s*\(/i.test(value)) {
            throw new HuddleError(`CSS resources are not allowed (#${id})`);
          }
          if (urlAttrs.has(n) && !attrPattern.href.test(value.trim()) && !/^data:image\//i.test(value.trim())) {
            throw new HuddleError(`${name}="${value}" is not a safe URL (#${id})`);
          }
        }
        continue;
      }
      if (!Object.hasOwn(RULES.tags, tag)) throw new HuddleError(`<${tag}> is not allowed in a ${kind} card (#${id})`);
      const allowed = RULES.tags[tag];
      for (const { name, value } of el.attributes) {
        if (!allowed.includes(name)) throw new HuddleError(`<${tag} ${name}> is not allowed in a ${kind} card (#${id})`);
        if (Object.hasOwn(attrPattern, name) && !attrPattern[name].test(value)) throw new HuddleError(`<${tag} ${name}="${value}"> is not valid (#${id})`);
      }
    }
    if (kind === 'html') return;
    for (const n of section.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) throw new HuddleError(`wrap loose text in <p> (#${id})`);
    }
    const first = section.firstElementChild;
    if (!first || first.localName !== 'h3' || section.querySelectorAll('h3').length !== 1) {
      throw new HuddleError(`a ${kind} card needs exactly one <h3> title as its first element (#${id})`);
    }
  }

  // ---------- runtime chrome (never saved) ----------

  function chrome(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    el.dataset.huddleChrome = '';
    if (text != null) el.textContent = text;
    return el;
  }

  function decorate(el) {
    el.querySelectorAll(':scope [data-huddle-chrome]').forEach((n) => n.remove());
    const { kind, status, severity, progress } = el.dataset;
    el.prepend(chrome('div', 'huddle-tag', [kind, status === 'decided' && 'decided', severity].filter(Boolean).join(' · ')));
    if (kind === 'metric' && progress != null) {
      const bar = chrome('div', 'huddle-bar');
      const fill = document.createElement('i');
      fill.style.width = `${Number(progress)}%`;
      bar.append(fill);
      const anchor = el.querySelector(':scope > data') || el.querySelector(':scope > h3');
      anchor.after(bar);
    }
    const notes = context.threads[el.dataset.card] || [];
    if (notes.length) {
      const thread = chrome('div', 'huddle-thread');
      for (const note of notes) {
        const row = document.createElement('div');
        row.append(Object.assign(document.createElement('b'), { textContent: `${note.who}:` }), ` ${note.text}`);
        thread.append(row);
      }
      el.append(thread);
    }
    el.append(chrome('button', 'huddle-note-btn', 'Note'));
    const box = chrome('div', 'huddle-note');
    box.append(Object.assign(document.createElement('textarea'), { placeholder: 'Note for the agent. Enter to add, Esc to cancel.' }));
    el.append(box);
  }

  function flash(el) {
    clearTimeout(freshTimers.get(el));
    el.classList.add('huddle-fresh');
    freshTimers.set(el, setTimeout(() => el.classList.remove('huddle-fresh'), FRESH_MS));
  }

  // The agent picked up a note on this card. A patch replaces the card's attributes, which ends it.
  function busy(el) {
    clearTimeout(busyTimers.get(el));
    el.classList.add('huddle-busy');
    busyTimers.set(el, setTimeout(() => el.classList.remove('huddle-busy'), BUSY_MS));
  }

  // Strips chrome and transient state, leaving the card exactly as it is stored.
  function clean(root) {
    root.querySelectorAll('[data-huddle-chrome]').forEach((n) => n.remove());
    const cards = root.matches?.('[data-card]') ? [root] : [];
    for (const card of [...cards, ...root.querySelectorAll('[data-card]')]) {
      card.removeAttribute('class');
      card.removeAttribute('style');
    }
    return root;
  }

  // The card as plain data (the shape in src/card-model.mjs), or null when its markup
  // does not fit that shape and has to travel as HTML instead.
  function toModel(el) {
    const c = clean(el.cloneNode(true));
    const { card: id, kind, status, severity, progress } = c.dataset;
    const m = { id, kind };
    if (status) m.status = status;
    if (severity) m.severity = severity;
    if (progress != null) m.progress = Number(progress);
    if (kind === 'html') return { ...m, html: c.innerHTML.trim() };
    const kids = [...c.children];
    let i = 0;
    const inner = (n) => n.innerHTML.trim();
    const bare = (n) => n.attributes.length === 0;
    const only = (n, names) => n.getAttributeNames().every((a) => names.includes(a));
    const blankText = (n) => n.nodeType !== Node.TEXT_NODE || !n.textContent.trim();
    const children = (n, tags) => [...n.childNodes].every((k) => (k.nodeType === Node.ELEMENT_NODE ? tags.includes(k.localName) && bare(k) : blankText(k)));
    const take = (tag, ok = bare) => (kids[i]?.localName === tag && ok(kids[i]) ? kids[i++] : null);

    const h3 = take('h3');
    if (!h3) return null;
    m.title = inner(h3);
    const data = take('data', (n) => only(n, ['value']));
    if (data) {
      if (data.hasAttribute('value')) m.value = data.getAttribute('value');
      m.display = inner(data);
    }
    const small = take('small');
    if (small) m.caption = inner(small);
    for (let p; (p = take('p')); ) (m.body ||= []).push(inner(p));
    const ul = take('ul', (n) => bare(n) && children(n, ['li']));
    if (ul) m.bullets = [...ul.children].map(inner);
    const lis = (n) => [...n.childNodes].every((k) => (k.nodeType === Node.ELEMENT_NODE ? k.localName === 'li' && only(k, ['data-votes', 'data-chosen']) : blankText(k)));
    const ol = take('ol', (n) => bare(n) && lis(n));
    if (ol) {
      m.options = [...ol.children].map((li) => {
        const copy = li.cloneNode(true);
        const last = copy.lastElementChild;
        let detail = '';
        if (last?.localName === 'small' && bare(last) && !last.nextSibling?.textContent.trim()) {
          detail = inner(last);
          last.remove();
        }
        return { label: inner(copy), detail, votes: li.hasAttribute('data-votes') ? Number(li.dataset.votes) : null, chosen: li.hasAttribute('data-chosen') };
      });
    }
    const dl = take('dl', (n) => bare(n) && children(n, ['dt', 'dd']) && [...n.children].every((k, j) => k.localName === (j % 2 ? 'dd' : 'dt')) && n.children.length % 2 === 0);
    if (dl) {
      const pairs = [...dl.children];
      m.meta = [];
      for (let j = 0; j < pairs.length; j += 2) m.meta.push({ key: inner(pairs[j]), value: inner(pairs[j + 1]) });
    }
    return i === kids.length ? m : null;
  }

  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    return out;
  }

  const toolbar = chrome('div', 'huddle-toolbar');
  const toolbarState = chrome('span', 'huddle-state');
  const saveButton = chrome('button', 'huddle-save', 'Save');
  toolbar.append(toolbarState, saveButton);

  function renderToolbar(note) {
    toolbar.toggleAttribute('data-dirty', dirty);
    const parts = [connection && `live (${connection})`, `${allCards().length} cards`, note || (dirty ? 'unsaved changes' : 'no unsaved changes')];
    toolbarState.textContent = parts.filter(Boolean).join(' · ');
  }

  function markDirty() {
    generation++;
    dirty = true;
    renderToolbar();
    if (live) {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => save().catch((err) => renderToolbar(`save failed: ${err.message}`)), AUTOSAVE_MS);
    }
  }

  function record(card, op, by, note) {
    context.revisions.push({ card, op, by, at: new Date().toISOString(), ...(note ? { note } : {}) });
    if (context.revisions.length > MAX_REVISIONS) context.revisions.splice(0, context.revisions.length - MAX_REVISIONS);
  }

  // ---------- public API ----------

  function patch(html, { by = 'agent', note } = {}) {
    const next = parseSection(html);
    const id = next.dataset.card;
    const el = cardEl(id);
    if (!el) throw new HuddleError(`there is no card #${id}`);
    for (const name of el.getAttributeNames()) el.removeAttribute(name);
    for (const { name, value } of next.attributes) el.setAttribute(name, value);
    el.replaceChildren(...next.childNodes);
    decorate(el);
    flash(el);
    record(id, 'patch', by, note);
    markDirty();
    return id;
  }

  function comment(id, text, who = 'facilitator') {
    const el = cardEl(id);
    if (!el) throw new HuddleError(`there is no card #${id}`);
    const body = String(text).trim();
    if (!body) throw new HuddleError('a note cannot be empty');
    const thread = (context.threads[id] ||= []);
    const earlier = thread.map((n) => ({ who: n.who, text: n.text }));
    thread.push({ who, text: body, at: new Date().toISOString() });
    decorate(el);
    markDirty();
    if (live) {
      post('./note', { card: id, text: body, model: toModel(el), html: get(id), thread: earlier, title: context.title ?? '', brief: context.brief ?? '' })
        .then(() => renderToolbar('note sent to the agent'), (err) => renderToolbar(`note not sent: ${err.message}`));
    }
  }

  function get(id) {
    const el = cardEl(id);
    return el ? clean(el.cloneNode(true)).outerHTML : null;
  }

  function cards() {
    return allCards().map((el) => ({
      id: el.dataset.card,
      kind: el.dataset.kind,
      lane: el.closest('[data-lane]')?.dataset.lane ?? null,
      title: el.querySelector(':scope > h3')?.textContent.trim() ?? '',
    }));
  }

  function serialize() {
    const root = clean(document.documentElement.cloneNode(true));
    const block = root.querySelector('script[data-huddle-context]');
    block.textContent = `\n${JSON.stringify(context, null, 2).replace(/</g, '\\u003c')}\n`;
    return `<!doctype html>\n${root.outerHTML}\n`;
  }

  function fileName() {
    const last = decodeURIComponent(location.pathname.split('/').pop() || '');
    return /\.html?$/i.test(last) ? last : 'board.html';
  }

  function save() {
    clearTimeout(autosaveTimer);
    const pending = saving ? saving.then(writeSave, writeSave) : writeSave();
    saving = pending;
    const finished = () => { if (saving === pending) saving = null; };
    pending.then(finished, finished);
    return pending;
  }

  async function writeSave() {
    const savedGeneration = generation;
    const text = serialize();
    let result;
    if (live) {
      await post('./save', { html: text });
      result = 'saved';
    } else if (typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle ||= await window.showSaveFilePicker({
          suggestedName: fileName(),
          types: [{ description: 'Huddle board', accept: { 'text/html': ['.html'] } }],
        });
        const out = await fileHandle.createWritable();
        await out.write(text);
        await out.close();
      } catch (err) {
        if (err.name === 'AbortError') return 'cancelled';
        throw err;
      }
      result = 'saved';
    } else {
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([text], { type: 'text/html' })),
        download: fileName(),
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      result = 'downloaded';
    }
    dirty = generation !== savedGeneration;
    renderToolbar(dirty ? undefined : result);
    return result;
  }

  // ---------- wiring ----------

  board.addEventListener('click', (e) => {
    const button = e.target.closest('.huddle-note-btn');
    if (!button) return;
    const card = button.closest('[data-card]');
    card.classList.toggle('huddle-noting');
    if (card.classList.contains('huddle-noting')) card.querySelector('.huddle-note textarea').focus();
  });

  board.addEventListener('keydown', (e) => {
    if (!e.target.matches('.huddle-note textarea')) return;
    const card = e.target.closest('[data-card]');
    if (e.key === 'Escape') {
      card.classList.remove('huddle-noting');
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.target.value.trim()) comment(card.dataset.card, e.target.value);
    }
  });

  saveButton.addEventListener('click', () => save().catch((err) => renderToolbar(`save failed: ${err.message}`)));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveButton.click();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  for (const el of allCards()) {
    try {
      parseSection(el.outerHTML);
    } catch (err) {
      problems.push({ card: el.dataset.card ?? null, message: err.message });
    }
    decorate(el);
  }
  if (problems.length) console.warn('huddle: some cards break the card rules', problems);
  document.body.append(toolbar);
  renderToolbar();

  if (live) {
    const events = new EventSource('./events');
    events.onopen = () => {
      connection = 'connected';
      renderToolbar();
    };
    events.onerror = () => {
      connection = 'reconnecting';
      renderToolbar();
    };
    events.addEventListener('claimed', (e) => {
      const el = cardEl(JSON.parse(e.data).card);
      if (el) busy(el);
    });
    // Apply, write the file, then answer, so the agent's patch call returns only once the change is on disk.
    events.addEventListener('patch', async (e) => {
      const { reqId, html, note } = JSON.parse(e.data);
      let ack;
      try {
        const card = patch(html, { by: 'agent', note });
        let saved = false;
        try {
          saved = (await save()) === 'saved';
        } catch (err) {
          renderToolbar(`save failed: ${err.message}`);
        }
        ack = { reqId, ok: true, card, saved };
      } catch (err) {
        ack = { reqId, ok: false, error: err.message };
      }
      post('./ack', ack).catch((err) => console.error('huddle: could not answer the agent', err));
    });
  }

  window.huddle = Object.freeze({
    version: VERSION,
    HuddleError,
    cards,
    live,
    get,
    model: (id) => {
      const el = cardEl(id);
      return el ? toModel(el) : null;
    },
    patch,
    comment,
    serialize,
    save,
    context: () => structuredClone(context),
    get dirty() {
      return dirty;
    },
    get problems() {
      return problems.map((p) => ({ ...p }));
    },
  });
})();
