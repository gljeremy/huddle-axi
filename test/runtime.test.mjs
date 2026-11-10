// End-to-end tests of the board runtime in a real headless browser.
// Boards are made with the real CLI and opened from disk, the way a facilitator opens them.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from './helpers/chrome.mjs';
import { SAMPLE } from '../src/sample.mjs';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const SAMPLE_IDS = SAMPLE.lanes.flatMap((lane) => lane.cards.map((html) => html.match(/data-card="([^"]+)"/)[1]));

let browser;
let dir;
let sampleUrl;

function newBoard(name, ...flags) {
  const file = join(dir, name);
  execFileSync(process.execPath, [CLI, 'new', file, '--force', ...flags]);
  return pathToFileURL(file).href;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'huddle-boards-'));
  sampleUrl = newBoard('sample.html', '--sample');
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

describe('a new board', () => {
  test('opens with every sample card, in order, and no rule problems', async () => {
    await browser.open(sampleUrl);
    const state = await browser.call(() => ({
      ids: huddle.cards().map((c) => c.id),
      problems: huddle.problems,
      dirty: huddle.dirty,
      toolbars: document.querySelectorAll('.huddle-toolbar').length,
    }));
    assert.deepEqual(state.ids, SAMPLE_IDS);
    assert.deepEqual(state.problems, []);
    assert.equal(state.dirty, false);
    assert.equal(state.toolbars, 1);
    assert.deepEqual(browser.errors, []);
  });

  test('the starter board opens with its single card', async () => {
    await browser.open(newBoard('starter.html', '--title', 'Retro'));
    const state = await browser.call(() => ({ cards: huddle.cards(), title: document.title, problems: huddle.problems }));
    assert.equal(state.title, 'Retro');
    assert.deepEqual(state.cards.map((c) => c.id), ['c1']);
    assert.deepEqual(state.problems, []);
  });
});

describe('patching a card', () => {
  beforeEach(() => browser.open(sampleUrl));

  test('swaps only that card, in place, without reloading the page', async () => {
    const result = await browser.call(() => {
      window.__pageMarker = 'still here';
      for (const el of document.querySelectorAll('[data-card]')) el.__identity = el.dataset.card;
      const untouched = huddle.get('c1');
      const before = document.querySelector('[data-card="c5"]');
      huddle.patch(`<section data-card="c5" data-kind="decision" data-status="decided">
        <h3>Setup data: progressive wizard</h3>
        <p>Three short steps. CSV import becomes a shortcut inside step 1.</p>
        <ol><li data-votes="5" data-chosen>Progressive wizard</li></ol>
      </section>`);
      const after = document.querySelector('[data-card="c5"]');
      return {
        marker: window.__pageMarker,
        sameNode: before === after,
        everyNodeKept: [...document.querySelectorAll('[data-card]')].every((el) => el.__identity === el.dataset.card),
        title: after.querySelector('h3').textContent,
        status: after.dataset.status,
        glowing: after.classList.contains('huddle-fresh'),
        othersUnchanged: huddle.get('c1') === untouched,
        dirty: huddle.dirty,
        revisions: huddle.context().revisions.map((r) => [r.card, r.op, r.by]),
      };
    });
    assert.equal(result.marker, 'still here', 'the page reloaded');
    assert.equal(result.sameNode, true);
    assert.equal(result.everyNodeKept, true, 'some card node was recreated');
    assert.equal(result.title, 'Setup data: progressive wizard');
    assert.equal(result.status, 'decided');
    assert.equal(result.glowing, true);
    assert.equal(result.othersUnchanged, true);
    assert.equal(result.dirty, true);
    assert.deepEqual(result.revisions, [['c5', 'patch', 'agent']]);
  });

  test('rejects markup outside the card rules and leaves the card as it was', async () => {
    const bad = {
      'script tag': '<section data-card="c5" data-kind="decision"><h3>x</h3><script>alert(1)</script></section>',
      'event handler': '<section data-card="c5" data-kind="decision"><h3 onclick="alert(1)">x</h3></section>',
      'unlisted tag': '<section data-card="c5" data-kind="decision"><h3>x</h3><div>y</div></section>',
      'inherited constructor tag': '<section data-card="c5" data-kind="note"><h3>Title</h3><constructor>Body</constructor></section>',
      'inherited proto tag': '<section data-card="c5" data-kind="note"><h3>Title</h3><__proto__>Body</__proto__></section>',
      'inherited constructor section attribute': '<section data-card="c5" data-kind="note" constructor="x"><h3>Title</h3></section>',
      'inherited proto section attribute': '<section data-card="c5" data-kind="note" __proto__="x"><h3>Title</h3></section>',
      'style attribute': '<section data-card="c5" data-kind="decision"><h3>x</h3><p style="color:red">y</p></section>',
      'class on the card': '<section data-card="c5" data-kind="decision" class="big"><h3>x</h3></section>',
      'unknown kind': '<section data-card="c5" data-kind="poll"><h3>x</h3></section>',
      'no title': '<section data-card="c5" data-kind="decision"><p>y</p></section>',
      'two titles': '<section data-card="c5" data-kind="decision"><h3>x</h3><h3>y</h3></section>',
      'loose text': '<section data-card="c5" data-kind="decision"><h3>x</h3>loose</section>',
      'javascript link': '<section data-card="c5" data-kind="decision"><h3>x</h3><p><a href="javascript:alert(1)">y</a></p></section>',
      'two sections': '<section data-card="c5" data-kind="note"><h3>x</h3></section><section data-card="c6" data-kind="note"><h3>y</h3></section>',
      'unknown card': '<section data-card="zz" data-kind="note"><h3>x</h3></section>',
    };
    const results = await browser.call((cases) => {
      const before = huddle.get('c5');
      const out = {};
      for (const [name, html] of Object.entries(cases)) {
        try {
          huddle.patch(html);
          out[name] = 'accepted';
        } catch (err) {
          out[name] = err.name;
        }
      }
      return { out, unchanged: huddle.get('c5') === before, dirty: huddle.dirty, revisions: huddle.context().revisions.length };
    }, bad);
    for (const name of Object.keys(bad)) assert.equal(results.out[name], 'HuddleError', `${name} was not rejected`);
    assert.equal(results.unchanged, true);
    assert.equal(results.dirty, false);
    assert.equal(results.revisions, 0);
  });

  test('html cards take diagrams but still refuse scripts and handlers', async () => {
    const results = await browser.call(() => {
      const attempt = (html) => {
        try {
          huddle.patch(html);
          return 'accepted';
        } catch (err) {
          return err.name;
        }
      };
      return {
        svg: attempt('<section data-card="c16" data-kind="html"><svg viewBox="0 0 10 10"><rect width="10" height="10" style="fill:gold"/></svg></section>'),
        script: attempt('<section data-card="c16" data-kind="html"><script>alert(1)</script></section>'),
        onerror: attempt('<section data-card="c16" data-kind="html"><img src="https://example.com/x.png" onerror="alert(1)"></section>'),
        iframe: attempt('<section data-card="c16" data-kind="html"><iframe src="https://example.com"></iframe></section>'),
        rect: !!document.querySelector('[data-card="c16"] rect'),
      };
    });
    assert.equal(results.svg, 'accepted');
    assert.equal(results.script, 'HuddleError');
    assert.equal(results.onerror, 'HuddleError');
    assert.equal(results.iframe, 'HuddleError');
    assert.equal(results.rect, true, 'the accepted diagram is not on the page');
  });

  test('html cards reject indirect and relative resource URLs without changing the card', async () => {
    const bad = [
      '<svg><a href="#"><text>Open</text><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
      '<img srcset="neighbour.png 1x">',
      '<img src="neighbour.png">',
      '<a href="javascript:alert(1)">Open</a>',
      '<svg><image xlink:href="neighbour.svg"/></svg>',
      '<svg xml:base="neighbour.svg"><image href="#x"/></svg>',
      '<svg><a href="#"><animate attributeName="href" values="#;javascript:alert(1)"/></a></svg>',
      '<p style="background-image:url(neighbour.png)">x</p>',
      '<p style="background-image:image-set(\'neighbour.png\' 1x)">x</p>',
      String.raw`<p style="background-image:u\72l(neighbour.png)">x</p>`,
      '<p style="background-image:u/**/rl(neighbour.png)">x</p>',
      ...['fill', 'stroke', 'filter', 'clip-path', 'mask', 'cursor', 'marker-start', 'marker-mid', 'marker-end']
        .map((attr) => `<svg><rect ${attr}="url(neighbour.svg#x)"/></svg>`),
      '<a href="#" ping="neighbour">Open</a>',
      '<table background="neighbour.png"><tr><td>x</td></tr></table>',
    ];
    const result = await browser.call((cases) => {
      const before = huddle.get('c16');
      const outcomes = cases.map((html) => {
        try {
          huddle.patch(`<section data-card="c16" data-kind="html">${html}</section>`);
          return 'accepted';
        } catch (err) {
          return err.name;
        }
      });
      return { outcomes, unchanged: huddle.get('c16') === before, dirty: huddle.dirty, revisions: huddle.context().revisions };
    }, bad);
    bad.forEach((html, i) => assert.equal(result.outcomes[i], 'HuddleError', html));
    assert.equal(result.unchanged, true);
    assert.equal(result.dirty, false);
    assert.deepEqual(result.revisions, []);
  });

  test('rejects legacy parsing tags before mutation and preserves a working saved board', async () => {
    const result = await browser.call(() => {
      const before = huddle.get('c16');
      const outcomes = ['plaintext', 'xmp', 'listing', 'noembed', 'noframes'].map((tag) => {
        try {
          huddle.patch(`<section data-card="c16" data-kind="html"><${tag}>Example</${tag}></section>`);
          return 'accepted';
        } catch (err) {
          return err.name;
        }
      });
      return {
        outcomes, unchanged: huddle.get('c16') === before,
        dirty: huddle.dirty, revisions: huddle.context().revisions, saved: huddle.serialize(),
      };
    });
    assert.deepEqual(result.outcomes, Array(5).fill('HuddleError'));
    assert.equal(result.unchanged, true);
    assert.equal(result.dirty, false);
    assert.deepEqual(result.revisions, []);
    const file = join(dir, 'rejected-parsing-tags.html');
    writeFileSync(file, result.saved);
    await browser.open(pathToFileURL(file).href);
    const reopened = await browser.call(() => {
      const ids = huddle.cards().map((c) => c.id);
      huddle.patch('<section data-card="c16" data-kind="html"><pre>Example</pre></section>');
      huddle.comment('c16', 'Still editable');
      return {
        ids, problems: huddle.problems,
        text: document.querySelector('[data-card="c16"] pre').textContent,
        notes: huddle.context().threads.c16.map((n) => n.text),
      };
    });
    assert.deepEqual(reopened.ids, SAMPLE_IDS);
    assert.deepEqual(reopened.problems, []);
    assert.equal(reopened.text, 'Example');
    assert.deepEqual(reopened.notes, ['Still editable']);
    assert.deepEqual(browser.errors, []);
  });

  test('reserves descendant card markers and names across all card kinds and depths', async () => {
    const result = await browser.call(() => {
      const before = huddle.get('c1');
      const target = document.querySelector('[data-card="c5"]');
      const outcomes = [];
      for (const kind of ['goal', 'decision', 'risk', 'metric', 'idea', 'action', 'note', 'html']) {
        for (const attr of ['data-card="c5"', 'data-huddle-chrome', 'name="diagram"']) {
          for (const content of [`<p ${attr}>Important</p>`, `<ul><li><b ${attr}>Important</b></li></ul>`]) {
            try {
              huddle.patch(`<section data-card="c1" data-kind="${kind}"><h3>Diagram node</h3>${content}</section>`);
              outcomes.push({ kind, attr, content, status: 'accepted' });
            } catch (err) {
              outcomes.push({ kind, attr, content, status: err.name });
            }
          }
        }
      }
      const rejected = {
        unchanged: huddle.get('c1') === before, dirty: huddle.dirty,
        revisions: huddle.context().revisions, ids: huddle.cards().map((c) => c.id),
      };
      huddle.patch('<section data-card="c5" data-kind="decision"><h3>Real decision</h3></section>');
      huddle.comment('c5', 'Real note');
      return {
        outcomes, rejected, sameTarget: target === document.querySelector('[data-card="c5"]'),
        title: target.querySelector('h3').textContent,
        notes: target.querySelector('.huddle-thread').textContent,
        ids: huddle.cards().map((c) => c.id),
      };
    });
    for (const outcome of result.outcomes) assert.equal(outcome.status, 'HuddleError', JSON.stringify(outcome));
    assert.equal(result.rejected.unchanged, true);
    assert.equal(result.rejected.dirty, false);
    assert.deepEqual(result.rejected.revisions, []);
    assert.deepEqual(result.rejected.ids, SAMPLE_IDS);
    assert.equal(result.sameTarget, true);
    assert.equal(result.title, 'Real decision');
    assert.match(result.notes, /Real note/);
    assert.deepEqual(result.ids, SAMPLE_IDS);
  });

  test('rejects Document-clobbering image names before mutation and preserves save/reopen', async () => {
    for (const name of ['querySelector', 'createElement', 'documentElement', 'addEventListener', 'body', 'huddle', 'showSaveFilePicker', '']) {
      await browser.open(sampleUrl);
      const result = await browser.call((name) => {
        const card = document.querySelector('[data-card="c16"]');
        const before = huddle.get('c16');
        let status;
        try {
          huddle.patch(`<section data-card="c16" data-kind="html"><img name="${name}" alt="Diagram"></section>`);
          status = 'accepted';
        } catch (err) {
          status = err.name;
        }
        return {
          status, unchanged: huddle.get('c16') === before,
          sameNode: card === document.querySelector('[data-card="c16"]'),
          dirty: huddle.dirty, revisions: huddle.context().revisions, saved: huddle.serialize(),
        };
      }, name);
      assert.equal(result.status, 'HuddleError', name);
      assert.equal(result.unchanged, true, name);
      assert.equal(result.sameNode, true, name);
      assert.equal(result.dirty, false, name);
      assert.deepEqual(result.revisions, [], name);
      const file = join(dir, 'rejected-document-name.html');
      writeFileSync(file, result.saved);
      await browser.open(pathToFileURL(file).href);
      const reopened = await browser.call(() => {
        huddle.patch('<section data-card="c16" data-kind="html"><div id="querySelector">Diagram</div></section>');
        huddle.comment('c16', 'Still editable');
        return {
          ids: huddle.cards().map((c) => c.id), problems: huddle.problems,
          text: document.querySelector('[data-card="c16"] [id="querySelector"]').textContent,
          notes: huddle.context().threads.c16.map((n) => n.text),
          toolbars: document.querySelectorAll('.huddle-toolbar').length,
        };
      });
      assert.deepEqual(reopened.ids, SAMPLE_IDS);
      assert.deepEqual(reopened.problems, []);
      assert.equal(reopened.text, 'Diagram');
      assert.deepEqual(reopened.notes, ['Still editable']);
      assert.equal(reopened.toolbars, 1);
      assert.deepEqual(browser.errors, []);
    }
  });

  test('ordinary HTML data attributes and content survive decoration and save/reopen', async () => {
    const saved = await browser.call(() => {
      huddle.patch('<section data-card="c16" data-kind="html"><div data-diagram="node"><p>Important</p></div></section>');
      huddle.comment('c16', 'Keep this diagram');
      return huddle.serialize();
    });
    const file = join(dir, 'html-data-attributes.html');
    writeFileSync(file, saved);
    await browser.open(pathToFileURL(file).href);
    const result = await browser.call(() => ({
      text: document.querySelector('[data-card="c16"] [data-diagram="node"] p').textContent,
      notes: document.querySelector('[data-card="c16"] .huddle-thread').textContent,
      chrome: document.querySelectorAll('[data-card="c16"] .huddle-tag').length,
      ids: huddle.cards().map((c) => c.id), problems: huddle.problems,
    }));
    assert.equal(result.text, 'Important');
    assert.match(result.notes, /Keep this diagram/);
    assert.equal(result.chrome, 1);
    assert.deepEqual(result.ids, SAMPLE_IDS);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(browser.errors, []);
  });

  test('html cards retain the permitted direct URL schemes and inline diagram styling', async () => {
    const result = await browser.call(() => {
      huddle.patch(`<section data-card="c16" data-kind="html">
        <a href="http://example.com">HTTP</a><a href="https://example.com">HTTPS</a>
        <a href="mailto:team@example.com">Mail</a><a href="#local">Local</a>
        <img src="data:image/png;base64,iVBORw0KGgo=">
        <svg><rect style="fill:gold" width="10" height="10"/></svg>
      </section>`);
      const card = document.querySelector('[data-card="c16"]');
      return { urls: [...card.querySelectorAll('a')].map((a) => a.getAttribute('href')), fill: card.querySelector('rect').style.fill };
    });
    assert.deepEqual(result.urls, ['http://example.com', 'https://example.com', 'mailto:team@example.com', '#local']);
    assert.equal(result.fill, 'gold');
  });
});

describe('facilitator notes', () => {
  beforeEach(() => browser.open(sampleUrl));

  test('a note typed on a card goes into the context and is displayed', async () => {
    const result = await browser.call(() => {
      const card = document.querySelector('[data-card="c7"]');
      card.querySelector('.huddle-note-btn').click();
      const box = card.querySelector('.huddle-note textarea');
      box.value = 'Sales eng wants the admin settings listed first';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return {
        thread: huddle.context().threads.c7,
        shown: document.querySelector('[data-card="c7"] .huddle-thread')?.textContent ?? '',
        dirty: huddle.dirty,
      };
    });
    assert.equal(result.thread.length, 1);
    assert.equal(result.thread[0].text, 'Sales eng wants the admin settings listed first');
    assert.match(result.shown, /Sales eng wants the admin settings listed first/);
    assert.equal(result.dirty, true);
  });

  test('a valid constructor card ID supports notes, patching and save round-trips', async () => {
    const initial = await browser.call(() => {
      document.querySelector('[data-card="c7"]').dataset.card = 'constructor';
      return huddle.serialize();
    });
    const file = join(dir, 'constructor.html');
    writeFileSync(file, initial);
    await browser.open(pathToFileURL(file).href);
    const saved = await browser.call(() => {
      huddle.comment('constructor', 'First note');
      huddle.patch('<section data-card="constructor" data-kind="note"><h3>Special ID</h3></section>');
      huddle.comment('constructor', 'Second note');
      return huddle.serialize();
    });
    writeFileSync(file, saved);
    await browser.open(pathToFileURL(file).href);
    const result = await browser.call(() => ({
      notes: huddle.context().threads.constructor.map((n) => n.text),
      shown: document.querySelector('[data-card="constructor"] .huddle-thread').textContent,
      problems: huddle.problems,
    }));
    assert.deepEqual(result.notes, ['First note', 'Second note']);
    assert.match(result.shown, /First note/);
    assert.match(result.shown, /Second note/);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(browser.errors, []);
  });
});

describe('saving', () => {
  test('diagram IDs matching huddle survive save/reopen with a working API', async () => {
    const diagrams = [
      '<div id="huddle">Diagram</div>',
      '<div id="huddle">First node</div><div id="huddle">Second node</div>',
    ];
    for (const [index, diagram] of diagrams.entries()) {
      await browser.open(sampleUrl);
      const saved = await browser.call((diagram) => {
        huddle.patch(`<section data-card="c16" data-kind="html">${diagram}</section>`);
        huddle.comment('c16', 'Before reopening');
        return huddle.serialize();
      }, diagram);
      const file = join(dir, `named-huddle-${index}.html`);
      writeFileSync(file, saved);
      await browser.open(pathToFileURL(file).href);
      const reopened = await browser.call(() => {
        huddle.patch('<section data-card="c5" data-kind="decision"><h3>Still patchable</h3></section>');
        huddle.comment('c16', 'After reopening');
        return {
          ids: huddle.cards().map((c) => c.id),
          title: document.querySelector('[data-card="c5"] h3').textContent,
          notes: huddle.context().threads.c16.map((n) => n.text),
          diagramNodes: document.querySelectorAll('[data-card="c16"] [id="huddle"]').length,
          toolbars: document.querySelectorAll('.huddle-toolbar').length,
          buttons: document.querySelectorAll('.huddle-save').length,
          problems: huddle.problems,
        };
      });
      assert.deepEqual(reopened.ids, SAMPLE_IDS);
      assert.equal(reopened.title, 'Still patchable');
      assert.deepEqual(reopened.notes, ['Before reopening', 'After reopening']);
      assert.equal(reopened.diagramNodes, index === 1 ? 2 : 1);
      assert.equal(reopened.toolbars, 1);
      assert.equal(reopened.buttons, 1);
      assert.deepEqual(reopened.problems, []);
      assert.deepEqual(browser.errors, []);
    }
  });

  test('named showSaveFilePicker elements and collections still use the download fallback', async () => {
    const diagrams = [
      '<div id="showSaveFilePicker">Diagram</div>',
      '<div id="showSaveFilePicker">First node</div><div id="showSaveFilePicker">Second node</div>',
    ];
    for (const [index, diagram] of diagrams.entries()) {
      await browser.open(sampleUrl);
      const result = await browser.call(async (diagram) => {
        delete window.showSaveFilePicker;
        huddle.patch(`<section data-card="c16" data-kind="html">${diagram}</section>`);
        huddle.comment('c16', 'Download me');
        const named = window.showSaveFilePicker;
        const namedNodes = named instanceof Element ? 1 : named.length;
        let blob;
        let clicked = 0;
        URL.createObjectURL = (value) => { blob = value; return 'blob:download'; };
        URL.revokeObjectURL = () => {};
        HTMLAnchorElement.prototype.click = () => { clicked++; };
        const status = await huddle.save();
        const doc = new DOMParser().parseFromString(await blob.text(), 'text/html');
        return {
          namedNodes, status, clicked, dirty: huddle.dirty,
          notes: JSON.parse(doc.querySelector('[data-huddle-context]').textContent).threads.c16.map((n) => n.text),
          diagramNodes: doc.querySelectorAll('[data-card="c16"] [id="showSaveFilePicker"]').length,
        };
      }, diagram);
      assert.equal(result.namedNodes, index === 1 ? 2 : 1);
      assert.equal(result.status, 'downloaded');
      assert.equal(result.clicked, 1);
      assert.equal(result.dirty, false);
      assert.deepEqual(result.notes, ['Download me']);
      assert.equal(result.diagramNodes, index === 1 ? 2 : 1);
    }
  });

  test('mutations during each asynchronous save stage remain unsaved', async () => {
    for (const stage of ['picker', 'create', 'write', 'close']) {
      await browser.open(sampleUrl);
      const result = await browser.call(async (stage) => {
        let release;
        let reached;
        const gate = new Promise((resolve) => { release = resolve; });
        const entered = new Promise((resolve) => { reached = resolve; });
        const pause = async (name) => { if (name === stage) { reached(); await gate; } };
        let written;
        window.showSaveFilePicker = async () => {
          await pause('picker');
          return { createWritable: async () => {
            await pause('create');
            return {
              write: async (text) => { written = text; await pause('write'); },
              close: async () => { await pause('close'); },
            };
          } };
        };
        huddle.comment('c7', 'Before save');
        const pending = huddle.save();
        await entered;
        huddle.comment('c7', 'During save');
        release();
        const status = await pending;
        const unload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(unload);
        const doc = new DOMParser().parseFromString(written, 'text/html');
        const persisted = JSON.parse(doc.querySelector('[data-huddle-context]').textContent);
        const stale = {
          status, dirty: huddle.dirty, warns: unload.defaultPrevented,
          toolbar: document.querySelector('.huddle-state').textContent,
          notes: persisted.threads.c7.map((n) => n.text),
        };
        await huddle.save();
        const cleanUnload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanUnload);
        const savedDoc = new DOMParser().parseFromString(written, 'text/html');
        return {
          stale, dirty: huddle.dirty, warns: cleanUnload.defaultPrevented,
          notes: JSON.parse(savedDoc.querySelector('[data-huddle-context]').textContent).threads.c7.map((n) => n.text),
        };
      }, stage);
      assert.deepEqual(result.stale.notes, ['Before save'], stage);
      assert.equal(result.stale.status, 'saved', stage);
      assert.equal(result.stale.dirty, true, stage);
      assert.equal(result.stale.warns, true, stage);
      assert.match(result.stale.toolbar, /unsaved changes/, stage);
      assert.deepEqual(result.notes, ['Before save', 'During save'], stage);
      assert.equal(result.dirty, false, stage);
      assert.equal(result.warns, false, stage);
    }
  });

  test('overlapping saves write in order and persist the newest snapshot last', async () => {
    await browser.open(sampleUrl);
    const result = await browser.call(async () => {
      let release;
      let reached;
      const gate = new Promise((resolve) => { release = resolve; });
      const entered = new Promise((resolve) => { reached = resolve; });
      const writes = [];
      const order = [];
      let count = 0;
      window.showSaveFilePicker = async () => ({ createWritable: async () => {
        const id = ++count;
        order.push(`create${id}`);
        return {
          write: async (text) => {
            if (id === 1) { reached(); await gate; }
            writes.push(text);
            order.push(`write${id}`);
          },
          close: async () => { order.push(`close${id}`); },
        };
      } });
      huddle.comment('c7', 'First');
      const first = huddle.save();
      await entered;
      huddle.comment('c7', 'Second');
      const second = huddle.save();
      await Promise.resolve();
      const queued = count;
      release();
      const statuses = await Promise.all([first, second]);
      return {
        queued, statuses, order, dirty: huddle.dirty,
        notes: writes.map((text) => {
          const doc = new DOMParser().parseFromString(text, 'text/html');
          return JSON.parse(doc.querySelector('[data-huddle-context]').textContent).threads.c7.map((n) => n.text);
        }),
      };
    });
    assert.equal(result.queued, 1);
    assert.deepEqual(result.statuses, ['saved', 'saved']);
    assert.deepEqual(result.order, ['create1', 'write1', 'close1', 'create2', 'write2', 'close2']);
    assert.deepEqual(result.notes, [['First'], ['First', 'Second']]);
    assert.equal(result.dirty, false);
  });

  test('cancelled and failed saves keep changes dirty and allow a later save', async () => {
    await browser.open(sampleUrl);
    const result = await browser.call(async () => {
      huddle.comment('c7', 'Keep me');
      window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
      const cancelled = await huddle.save();
      const afterCancel = huddle.dirty;
      window.showSaveFilePicker = async () => ({ createWritable: async () => { throw new Error('Disk unavailable'); } });
      const failed = huddle.save().catch((err) => err.message);
      const queued = huddle.save().catch((err) => err.message);
      const errors = await Promise.all([failed, queued]);
      const afterFailure = huddle.dirty;
      window.showSaveFilePicker = undefined;
      HTMLAnchorElement.prototype.click = () => {};
      const downloaded = await huddle.save();
      return { cancelled, afterCancel, errors, afterFailure, downloaded, dirty: huddle.dirty };
    });
    assert.equal(result.cancelled, 'cancelled');
    assert.equal(result.afterCancel, true);
    assert.deepEqual(result.errors, ['Disk unavailable', 'Disk unavailable']);
    assert.equal(result.afterFailure, true);
    assert.equal(result.downloaded, 'downloaded');
    assert.equal(result.dirty, false);
  });

  test('download fallback does not clear a mutation made while handing off the snapshot', async () => {
    await browser.open(sampleUrl);
    const result = await browser.call(async () => {
      window.showSaveFilePicker = undefined;
      let blob;
      URL.createObjectURL = (value) => { blob = value; return 'blob:download'; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = () => { huddle.comment('c7', 'After snapshot'); };
      huddle.comment('c7', 'Before snapshot');
      const status = await huddle.save();
      const doc = new DOMParser().parseFromString(await blob.text(), 'text/html');
      return {
        status, dirty: huddle.dirty,
        notes: JSON.parse(doc.querySelector('[data-huddle-context]').textContent).threads.c7.map((n) => n.text),
        toolbar: document.querySelector('.huddle-state').textContent,
      };
    });
    assert.equal(result.status, 'downloaded');
    assert.deepEqual(result.notes, ['Before snapshot']);
    assert.equal(result.dirty, true);
    assert.match(result.toolbar, /unsaved changes/);
  });

  test('the saved file reopens as the same board, with notes and changes, and still works', async () => {
    await browser.open(sampleUrl);
    const saved = await browser.call(() => {
      huddle.patch('<section data-card="c5" data-kind="decision" data-status="decided"><h3>Setup data: progressive wizard</h3></section>');
      huddle.comment('c7', 'Check with Sales eng');
      return huddle.serialize();
    });
    const file = join(dir, 'saved.html');
    writeFileSync(file, saved);
    await browser.open(pathToFileURL(file).href);

    const reopened = await browser.call(() => {
      const ctx = huddle.context();
      return {
        ids: huddle.cards().map((c) => c.id),
        c5: huddle.cards().find((c) => c.id === 'c5').title,
        notes: ctx.threads.c7.map((n) => n.text),
        revisions: ctx.revisions.map((r) => [r.card, r.op]),
        protocol: typeof ctx.protocol === 'string' && ctx.protocol.length > 0,
        problems: huddle.problems,
        dirty: huddle.dirty,
        toolbars: document.querySelectorAll('.huddle-toolbar').length,
        tagsPerCard: [...document.querySelectorAll('[data-card]')].map((el) => el.querySelectorAll('.huddle-tag').length),
        glowing: document.querySelectorAll('.huddle-fresh').length,
      };
    });
    assert.deepEqual(reopened.ids, SAMPLE_IDS);
    assert.equal(reopened.c5, 'Setup data: progressive wizard');
    assert.deepEqual(reopened.notes, ['Check with Sales eng']);
    assert.deepEqual(reopened.revisions, [['c5', 'patch']]);
    assert.equal(reopened.protocol, true);
    assert.deepEqual(reopened.problems, []);
    assert.equal(reopened.dirty, false);
    assert.equal(reopened.toolbars, 1, 'runtime chrome was saved into the file');
    assert.ok(reopened.tagsPerCard.every((n) => n === 1), 'card chrome was saved into the file');
    assert.equal(reopened.glowing, 0);

    const patchedAgain = await browser.call(() => {
      huddle.patch('<section data-card="c6" data-kind="decision"><h3>Empty account: demo data</h3></section>');
      return huddle.cards().find((c) => c.id === 'c6').title;
    });
    assert.equal(patchedAgain, 'Empty account: demo data');
    assert.deepEqual(browser.errors, []);
  });
});
