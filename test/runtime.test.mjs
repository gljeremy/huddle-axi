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

  test('adds and removes cards', async () => {
    const result = await browser.call(() => {
      huddle.add('<section data-card="c20" data-kind="idea"><h3>Guided demo data</h3></section>', { lane: 'ideas' });
      const added = huddle.cards().find((c) => c.id === 'c20');
      let duplicate;
      try {
        huddle.add('<section data-card="c20" data-kind="idea"><h3>again</h3></section>');
      } catch (err) {
        duplicate = err.name;
      }
      huddle.remove('c13');
      return { added, duplicate, ids: huddle.cards().map((c) => c.id), ops: huddle.context().revisions.map((r) => r.op) };
    });
    assert.deepEqual(result.added, { id: 'c20', kind: 'idea', lane: 'ideas', title: 'Guided demo data' });
    assert.equal(result.duplicate, 'HuddleError');
    assert.equal(result.ids.includes('c13'), false);
    assert.equal(result.ids.length, SAMPLE_IDS.length);
    assert.deepEqual(result.ops, ['add', 'remove']);
  });
});

describe('facilitator notes', () => {
  beforeEach(() => browser.open(sampleUrl));

  test('a note typed on a card goes into the context and raises an event', async () => {
    const result = await browser.call(() => {
      const events = [];
      window.addEventListener('huddle:comment', (e) => events.push(e.detail));
      const card = document.querySelector('[data-card="c7"]');
      card.querySelector('.huddle-note-btn').click();
      const box = card.querySelector('.huddle-note textarea');
      box.value = 'Sales eng wants the admin settings listed first';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return {
        events,
        thread: huddle.context().threads.c7,
        shown: document.querySelector('[data-card="c7"] .huddle-thread')?.textContent ?? '',
        dirty: huddle.dirty,
      };
    });
    assert.deepEqual(result.events.map((e) => [e.card, e.text, e.who]), [['c7', 'Sales eng wants the admin settings listed first', 'facilitator']]);
    assert.equal(result.thread.length, 1);
    assert.equal(result.thread[0].text, 'Sales eng wants the admin settings listed first');
    assert.match(result.shown, /Sales eng wants the admin settings listed first/);
    assert.equal(result.dirty, true);
  });
});

describe('saving', () => {
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
