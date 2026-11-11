  // ---------- meeting tools ----------
  // Not a module: huddle-axi inserts this file into runtime.js, inside the runtime's closure,
  // where runtime.js says HUDDLE_MEETING. It adds the no-model quick actions, present mode
  // and the exports, all built on patch, add, move and undo.

  const SEVERITIES = ['high', 'medium', 'low'];
  const ACTION_STATES = ['not started', 'in progress', 'done'];
  const PROGRESS_STEP = 10;
  const MAX_VOTES = 9999;
  const ZOOM = { start: 28, min: 20, max: 44, step: 4 };

  // A clean copy of the card, as it is stored, to change with plain code.
  function copyOf(id) {
    const html = get(id);
    if (html == null) throw new HuddleError(`there is no card #${id}`);
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild;
  }

  function edit(id, note, change) {
    const card = copyOf(id);
    change(card);
    return patch(card.outerHTML, { by: 'facilitator', op: 'quick', note });
  }

  const optionsOf = (card) => [...(card.querySelector(':scope > ol')?.children ?? [])];

  function option(card, index) {
    const li = optionsOf(card)[index];
    if (!li) throw new HuddleError(`#${card.dataset.card} has no option ${Number(index) + 1}`);
    return li;
  }

  // The <dd> for a detail row such as "status", added at the end of the details if missing.
  function detail(card, key) {
    const dl = card.querySelector(':scope > dl') ?? card.appendChild(document.createElement('dl'));
    const dt = [...dl.children].find((n) => n.localName === 'dt' && n.textContent.trim().toLowerCase() === key);
    if (dt?.nextElementSibling?.localName === 'dd') return dt.nextElementSibling;
    const dd = document.createElement('dd');
    dl.append(Object.assign(document.createElement('dt'), { textContent: key }), dd);
    return dd;
  }

  const siblingCard = (el, step) => {
    let n = el[step];
    while (n && !n.matches('[data-card]')) n = n[step];
    return n;
  };

  function liveCard(id) {
    const el = cardEl(id);
    if (!el) throw new HuddleError(`there is no card #${id}`);
    return el;
  }

  const cycle = (list, current) => list[(list.indexOf(current) + 1) % list.length];

  const quick = Object.freeze({
    vote(id, index, delta = 1) {
      return edit(id, delta > 0 ? 'vote +1' : 'vote -1', (card) => {
        const li = option(card, index);
        li.dataset.votes = String(Math.min(MAX_VOTES, Math.max(0, (Number(li.dataset.votes) || 0) + Math.sign(delta))));
      });
    },
    // Choosing an option decides the card; choosing the chosen option again reopens it.
    choose(id, index) {
      return edit(id, 'choose', (card) => {
        const li = option(card, index);
        const was = li.hasAttribute('data-chosen');
        for (const o of optionsOf(card)) o.removeAttribute('data-chosen');
        if (was) card.dataset.status = 'open';
        else {
          li.setAttribute('data-chosen', '');
          card.dataset.status = 'decided';
        }
      });
    },
    decide(id) {
      return edit(id, 'decide', (card) => {
        card.dataset.status = card.dataset.status === 'decided' ? 'open' : 'decided';
      });
    },
    addOption(id, label) {
      const text = String(label ?? '').trim();
      if (!text) throw new HuddleError('an option needs a label');
      return edit(id, 'add option', (card) => {
        let ol = card.querySelector(':scope > ol');
        if (!ol) {
          ol = document.createElement('ol');
          const dl = card.querySelector(':scope > dl');
          if (dl) dl.before(ol);
          else card.append(ol);
        }
        const li = Object.assign(document.createElement('li'), { textContent: text });
        li.dataset.votes = '0';
        ol.append(li);
      });
    },
    severity(id) {
      return edit(id, 'severity', (card) => {
        card.dataset.severity = cycle(SEVERITIES, card.dataset.severity);
      });
    },
    progress(id, delta = PROGRESS_STEP) {
      return edit(id, 'progress', (card) => {
        card.dataset.progress = String(Math.min(100, Math.max(0, (Number(card.dataset.progress) || 0) + delta)));
      });
    },
    actionStatus(id) {
      return edit(id, 'status', (card) => {
        const dd = detail(card, 'status');
        dd.textContent = cycle(ACTION_STATES, dd.textContent.trim().toLowerCase());
      });
    },
    // Each bullet becomes its own card of the same kind, right after the card it came from.
    split(id) {
      const card = copyOf(id);
      const ul = card.querySelector(':scope > ul');
      const items = ul && card.dataset.kind !== 'html' ? [...ul.children] : [];
      if (items.length < 2) throw new HuddleError(`#${id} needs at least two bullets to split`);
      ul.remove();
      patch(card.outerHTML, { by: 'facilitator', op: 'quick', note: 'split' });
      const made = [];
      let after = id;
      for (const li of items) {
        const section = document.createElement('section');
        section.dataset.card = newId();
        section.dataset.kind = card.dataset.kind;
        section.append(Object.assign(document.createElement('h3'), { innerHTML: li.innerHTML }));
        after = add(section.outerHTML, { after, note: `split from #${id}` });
        made.push(after);
      }
      return made;
    },
    up(id) {
      const prev = siblingCard(liveCard(id), 'previousElementSibling');
      return prev ? move(id, { before: prev.dataset.card }) : id;
    },
    down(id) {
      const el = liveCard(id);
      const next = siblingCard(el, 'nextElementSibling');
      if (!next) return id;
      const after = siblingCard(next, 'nextElementSibling');
      return after ? move(id, { before: after.dataset.card }) : move(id, { lane: el.closest('[data-lane]').dataset.lane });
    },
    moveTo(id, lane) {
      return move(id, { lane });
    },
    undo,
  });

  // ---------- card controls (chrome, never saved) ----------

  function control(label, action, title) {
    const b = chrome('button', '', label);
    b.type = 'button';
    b.dataset.quick = action;
    if (title) b.title = title;
    return b;
  }

  function decorateQuick(el) {
    const { kind, card: id } = el.dataset;
    const bar = chrome('div', 'huddle-quick');
    bar.append(control('↑', 'up', 'Move up'), control('↓', 'down', 'Move down'));
    const here = el.closest('[data-lane]')?.dataset.lane;
    const others = lanes().filter((lane) => lane.id !== here);
    if (others.length) {
      const select = chrome('select', '');
      select.dataset.quick = 'move-to';
      select.title = 'Move to another lane';
      select.append(new Option('Move to…', ''), ...others.map((lane) => new Option(lane.title, lane.id)));
      bar.append(select);
    }
    if (kind === 'decision') {
      bar.append(control(el.dataset.status === 'decided' ? 'Reopen' : 'Decide', 'decide'), control('+Option', 'add-option', 'Add an option'));
    }
    if (kind === 'risk') bar.append(control(`Severity: ${el.dataset.severity ?? 'none'}`, 'severity', 'Next severity'));
    if (kind === 'metric') bar.append(control(`−${PROGRESS_STEP}`, 'progress-down', 'Less progress'), control(`+${PROGRESS_STEP}`, 'progress-up', 'More progress'));
    if (kind === 'action') {
      const dt = [...el.querySelectorAll(':scope > dl > dt')].find((n) => n.textContent.trim().toLowerCase() === 'status');
      bar.append(control(`Status: ${dt?.nextElementSibling?.textContent.trim() || 'none'}`, 'status', 'Next status'));
    }
    if (kind !== 'html' && el.querySelectorAll(':scope > ul > li').length >= 2) bar.append(control('Split', 'split', 'Turn each bullet into its own card'));
    if (context.history[id]?.length) bar.append(control('Undo', 'undo', 'Undo the last change to this card'));
    el.append(bar);

    if (kind === 'html') return;
    optionsOf(el).forEach((li, index) => {
      const box = chrome('span', 'huddle-opt');
      for (const [label, action, title] of [['−', 'vote-down', 'One vote less'], ['+', 'vote-up', 'One vote more'], ['✓', 'choose', 'Choose this option']]) {
        const b = control(label, action, title);
        b.dataset.index = String(index);
        box.append(b);
      }
      li.append(box);
    });
    if (kind === 'decision') {
      const adding = chrome('div', 'huddle-option-input');
      adding.append(Object.assign(document.createElement('input'), { placeholder: 'New option. Enter to add, Esc to cancel.' }));
      el.append(adding);
    }
  }

  function runQuick(card, action, index) {
    const id = card.dataset.card;
    switch (action) {
      case 'up': return quick.up(id);
      case 'down': return quick.down(id);
      case 'decide': return quick.decide(id);
      case 'severity': return quick.severity(id);
      case 'progress-up': return quick.progress(id, PROGRESS_STEP);
      case 'progress-down': return quick.progress(id, -PROGRESS_STEP);
      case 'status': return quick.actionStatus(id);
      case 'split': return quick.split(id);
      case 'undo': return quick.undo(id);
      case 'vote-up': return quick.vote(id, index, 1);
      case 'vote-down': return quick.vote(id, index, -1);
      case 'choose': return quick.choose(id, index);
      case 'add-option':
        card.classList.add('huddle-adding');
        card.querySelector('.huddle-option-input input')?.focus();
        return id;
      default: throw new HuddleError(`unknown quick action ${action}`);
    }
  }

  const reportQuick = (fn) => {
    try {
      fn();
    } catch (err) {
      renderToolbar(err.message);
    }
  };

  board.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-quick]');
    if (button) reportQuick(() => runQuick(button.closest('[data-card]'), button.dataset.quick, Number(button.dataset.index)));
  });
  board.addEventListener('change', (e) => {
    if (!e.target.matches('select[data-quick="move-to"]') || !e.target.value) return;
    const { value } = e.target;
    reportQuick(() => quick.moveTo(e.target.closest('[data-card]').dataset.card, value));
  });
  board.addEventListener('keydown', (e) => {
    if (!e.target.matches('.huddle-option-input input')) return;
    const card = e.target.closest('[data-card]');
    if (e.key === 'Escape') card.classList.remove('huddle-adding');
    else if (e.key === 'Enter' && e.target.value.trim()) {
      e.preventDefault();
      reportQuick(() => quick.addOption(card.dataset.card, e.target.value));
    }
  });

  // ---------- present mode: projector-size type ----------

  let presenting = false;
  let zoom = ZOOM.start;
  // A chrome <style>, so the zoom is never written into the file.
  const presentStyle = chrome('style', '');
  const zoomOut = chrome('button', 'huddle-zoom', 'A−');
  const zoomIn = chrome('button', 'huddle-zoom', 'A+');
  const presentButton = chrome('button', 'huddle-present', 'Present');
  zoomOut.title = 'Smaller type';
  zoomIn.title = 'Larger type';

  function present(on = !presenting, size = zoom) {
    presenting = Boolean(on);
    zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, Number(size) || ZOOM.start));
    presentStyle.textContent = `:root { --huddle-type: ${zoom}px; }`;
    if (presenting) document.head.append(presentStyle);
    else presentStyle.remove();
    toolbar.toggleAttribute('data-present', presenting);
    presentButton.textContent = presenting ? 'Exit present' : 'Present';
    return presenting;
  }

  presentButton.addEventListener('click', () => present());
  zoomOut.addEventListener('click', () => present(true, zoom - ZOOM.step));
  zoomIn.addEventListener('click', () => present(true, zoom + ZOOM.step));

  // ---------- export ----------

  const plain = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html ?? '';
    return t.content.textContent.replace(/\s+/g, ' ').trim();
  };
  const today = () => new Date().toLocaleDateString('en-CA');
  const SECTIONS = [['decision', 'Decisions'], ['action', 'Actions'], ['risk', 'Risks'], ['metric', 'Metrics'], ['goal', 'Goals'], ['idea', 'Ideas'], ['note', 'Notes'], ['html', 'Other cards']];

  function cardNotes(el) {
    const id = el.dataset.card;
    const c = clean(el.cloneNode(true));
    const fields = (selector) => [...c.querySelectorAll(selector)];
    const title = plain(c.querySelector(':scope > h3')?.innerHTML) || `#${id}`;
    const tags = [el.dataset.status, el.dataset.severity && `${el.dataset.severity} severity`, el.dataset.progress != null && `${el.dataset.progress}% progress`].filter(Boolean);
    let head = `- **${title}**`;
    const display = fields(':scope > data').map((n) => plain(n.innerHTML)).filter(Boolean).join(' ');
    if (display) head += `: ${display}`;
    if (tags.length) head += ` (${tags.join(', ')})`;
    const text = fields(':scope > small, :scope > p').map((n) => plain(n.innerHTML)).filter(Boolean).join(' ');
    if (text) head += ` — ${text}`;
    if (el.dataset.kind === 'html') head += ' — see the board for this card';
    const lines = [head];
    for (const li of fields(':scope > ol > li')) {
      const copy = li.cloneNode(true);
      const detail = copy.querySelector(':scope > small:last-child');
      detail?.remove();
      const count = li.hasAttribute('data-votes') ? Number(li.dataset.votes) : null;
      const votes = count == null ? '' : ` (${count} ${count === 1 ? 'vote' : 'votes'})`;
      lines.push(`  - [${li.hasAttribute('data-chosen') ? 'x' : ' '}] ${plain(copy.innerHTML)}${detail ? ` — ${plain(detail.innerHTML)}` : ''}${votes}`);
    }
    for (const b of fields(':scope > ul > li')) lines.push(`  - ${plain(b.innerHTML)}`);
    const meta = fields(':scope > dl > dt').map((dt) => {
      const dd = dt.nextElementSibling;
      return `${plain(dt.innerHTML)}: ${dd?.localName === 'dd' ? plain(dd.innerHTML) : ''}`;
    });
    if (meta.length) lines.push(`  - ${meta.join(' · ')}`);
    for (const n of context.threads[id] ?? []) lines.push(`  - Note from ${n.who}: ${n.text}`);
    return lines;
  }

  // The meeting as Markdown: every card grouped by kind, with its notes.
  function exportNotes() {
    const lines = [`# ${context.title || document.title}`];
    if (context.brief) lines.push('', context.brief);
    lines.push('', `Exported ${today()}.`);
    for (const [kind, heading] of SECTIONS) {
      const els = allCards().filter((el) => el.dataset.kind === kind);
      if (!els.length) continue;
      lines.push('', `## ${heading}`, '');
      for (const el of els) lines.push(...cardNotes(el));
    }
    return `${lines.join('\n')}\n`;
  }

  // The board as it looks now, with its notes, but no runtime, controls or context block.
  function exportSnapshot() {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll('script, style[data-huddle-chrome], .huddle-toolbar, .huddle-note-btn, .huddle-note, .huddle-quick, .huddle-opt, .huddle-option-input').forEach((n) => n.remove());
    for (const card of root.querySelectorAll('[data-card]')) {
      card.removeAttribute('class');
      card.removeAttribute('style');
    }
    root.querySelectorAll('.huddle-changed').forEach(unmark);
    const stamp = Object.assign(document.createElement('p'), { textContent: `Read-only snapshot, ${today()}.` });
    stamp.setAttribute('data-huddle-snapshot', '');
    root.querySelector('[data-huddle-header]')?.append(stamp);
    return `<!doctype html>\n${root.outerHTML}\n`;
  }

  const exportButton = chrome('button', 'huddle-export', 'Export');
  const exportMenu = chrome('div', 'huddle-menu');
  exportMenu.hidden = true;
  const notesItem = chrome('button', '', 'Meeting notes (.md)');
  const snapshotItem = chrome('button', '', 'Read-only snapshot (.html)');
  exportMenu.append(notesItem, snapshotItem);
  const baseName = () => fileName().replace(/\.html?$/i, '');
  exportButton.addEventListener('click', () => {
    exportMenu.hidden = !exportMenu.hidden;
  });
  notesItem.addEventListener('click', () => {
    exportMenu.hidden = true;
    download(exportNotes(), `${baseName()}-notes.md`, 'text/markdown');
    renderToolbar('notes exported');
  });
  snapshotItem.addEventListener('click', () => {
    exportMenu.hidden = true;
    download(exportSnapshot(), `${baseName()}-snapshot.html`, 'text/html');
    renderToolbar('snapshot exported');
  });

  toolbar.insertBefore(zoomOut, saveButton);
  toolbar.insertBefore(zoomIn, saveButton);
  toolbar.insertBefore(presentButton, saveButton);
  toolbar.insertBefore(exportButton, saveButton);
  toolbar.append(exportMenu);
